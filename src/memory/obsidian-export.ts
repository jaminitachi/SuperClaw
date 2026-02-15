import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

// ---------- Types ----------

export interface ObsidianExportOptions {
  vaultPath: string;
  mode: 'full' | 'incremental';
  include: ('knowledge' | 'entities' | 'conversations' | 'learnings')[];
}

export interface ExportResult {
  success: boolean;
  knowledgeExported: number;
  entitiesExported: number;
  sessionsExported: number;
  learningsExported: number;
  categoriesFound: string[];
  entityTypesFound: string[];
  error?: string;
}

interface KnowledgeRow {
  id: number;
  category: string;
  subject: string;
  content: string;
  confidence: number;
  access_count: number;
  created_at: string;
  updated_at: string;
}

interface EntityRow {
  id: number;
  name: string;
  type: string;
  properties: string | null;
  created_at: string;
}

interface RelationRow {
  relation_type: string;
  target_name: string;
  target_type: string;
  direction: 'outgoing' | 'incoming';
}

interface ConversationRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  project: string | null;
  tags: string | null;
  created_at: string;
}

interface SyncState {
  lastSync: string;
}

interface LearningRow {
  id: number;
  category: string;
  content: string;
  session_id: string | null;
  iteration: number;
  project: string | null;
  tags: string | null;
  created_at: string;
}

// ---------- Helpers ----------

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function injectWikilinks(text: string, entityNames: string[]): string {
  if (entityNames.length === 0) return text;

  // Sort by length descending so longer names match first
  const sorted = [...entityNames].sort((a, b) => b.length - a.length);

  let result = text;
  for (const name of sorted) {
    // Skip very short names (<=2 chars) to avoid false positives
    if (name.length <= 2) continue;

    // Match whole words only, avoid double-linking already linked text
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<!\\[\\[)\\b(${escaped})\\b(?!\\]\\])`, 'g');
    result = result.replace(pattern, `[[$1]]`);
  }

  return result;
}

function formatFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`  ${k}: "${v}"`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ---------- Exporter ----------

export class ObsidianExporter {
  private db: Database.Database;
  private syncStatePath: string;

  constructor(db: Database.Database, dataDir: string) {
    this.db = db;
    this.syncStatePath = join(dataDir, 'obsidian-sync-state.json');
  }

  async export(options: ObsidianExportOptions): Promise<ExportResult> {
    const { vaultPath, mode, include } = options;

    const result: ExportResult = {
      success: false,
      knowledgeExported: 0,
      entitiesExported: 0,
      sessionsExported: 0,
      learningsExported: 0,
      categoriesFound: [],
      entityTypesFound: [],
    };

    try {
      // Ensure vault directories
      ensureDir(join(vaultPath, 'Knowledge'));
      ensureDir(join(vaultPath, 'Entities'));
      ensureDir(join(vaultPath, 'Sessions'));
      ensureDir(join(vaultPath, 'Learnings'));
      ensureDir(join(vaultPath, '_Index'));

      const lastSync = mode === 'incremental' ? this.loadSyncState() : null;

      // Collect all entity names for wikilink injection
      const allEntityNames = (
        this.db.prepare('SELECT name FROM entities').all() as { name: string }[]
      ).map((e) => e.name);

      if (include.includes('knowledge')) {
        result.knowledgeExported = this.exportKnowledge(vaultPath, lastSync, allEntityNames);
      }

      if (include.includes('entities')) {
        result.entitiesExported = this.exportEntities(vaultPath, lastSync, allEntityNames);
      }

      if (include.includes('conversations')) {
        result.sessionsExported = this.exportConversations(vaultPath, lastSync);
      }

      if (include.includes('learnings')) {
        result.learningsExported = this.exportLearnings(vaultPath, lastSync);
      }

      // Gather stats for result
      result.categoriesFound = (
        this.db.prepare('SELECT DISTINCT category FROM knowledge ORDER BY category').all() as { category: string }[]
      ).map((r) => r.category);

      result.entityTypesFound = (
        this.db.prepare('SELECT DISTINCT type FROM entities ORDER BY type').all() as { type: string }[]
      ).map((r) => r.type);

      // Generate index files
      this.generateIndexFiles(vaultPath);

      // Save sync state
      this.saveSyncState();

      result.success = true;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }

    return result;
  }

  // ---------- Knowledge Export ----------

  private exportKnowledge(vaultPath: string, lastSync: string | null, entityNames: string[]): number {
    let sql = 'SELECT * FROM knowledge';
    const params: unknown[] = [];

    if (lastSync) {
      sql += ' WHERE updated_at > ?';
      params.push(lastSync);
    }

    sql += ' ORDER BY category, subject';

    const rows = this.db.prepare(sql).all(...params) as KnowledgeRow[];

    // Collect all knowledge subjects for Related Knowledge linking
    const allKnowledge = this.db.prepare('SELECT id, category, subject, confidence FROM knowledge ORDER BY category, subject').all() as KnowledgeRow[];

    for (const row of rows) {
      const categoryDir = join(vaultPath, 'Knowledge', sanitizeFilename(row.category));
      ensureDir(categoryDir);

      const filename = sanitizeFilename(row.subject) + '.md';
      const filePath = join(categoryDir, filename);

      // Build related knowledge: same category, different entry
      const related = allKnowledge
        .filter((k) => k.category === row.category && k.id !== row.id)
        .map((k) => `- [[${sanitizeFilename(k.subject)}]] (confidence: ${k.confidence})`);

      // Inject wikilinks into content
      const linkedContent = injectWikilinks(row.content, entityNames);

      // Build tags from category + content keywords
      const tags = [row.category];

      const frontmatter = formatFrontmatter({
        id: row.id,
        category: row.category,
        confidence: row.confidence,
        access_count: row.access_count,
        created: row.created_at,
        updated: row.updated_at,
        tags,
        aliases: [row.subject],
      });

      const sections: string[] = [
        frontmatter,
        '',
        `# ${row.subject}`,
        '',
        linkedContent,
      ];

      if (related.length > 0) {
        sections.push('', '## Related Knowledge', '', ...related);
      }

      writeFileSync(filePath, sections.join('\n') + '\n', 'utf-8');
    }

    return rows.length;
  }

  // ---------- Entity Export ----------

  private exportEntities(vaultPath: string, lastSync: string | null, _entityNames: string[]): number {
    let sql = 'SELECT * FROM entities';
    const params: unknown[] = [];

    // entities table in schema.ts has updated_at, but memory-server.ts inline schema does not.
    // Check if updated_at column exists before filtering.
    const hasUpdatedAt = this.columnExists('entities', 'updated_at');

    if (lastSync && hasUpdatedAt) {
      sql += ' WHERE updated_at > ?';
      params.push(lastSync);
    }

    sql += ' ORDER BY type, name';

    const rows = this.db.prepare(sql).all(...params) as EntityRow[];

    for (const row of rows) {
      const typeDir = join(vaultPath, 'Entities', sanitizeFilename(row.type));
      ensureDir(typeDir);

      const filename = sanitizeFilename(row.name) + '.md';
      const filePath = join(typeDir, filename);

      // Parse properties
      let props: Record<string, unknown> = {};
      if (row.properties) {
        try {
          props = JSON.parse(row.properties);
        } catch {
          // properties might not be valid JSON
        }
      }

      // Get relations for this entity
      const relations = this.getEntityRelations(row.id);

      // Find related knowledge that mentions this entity
      const relatedKnowledge = this.findRelatedKnowledge(row.name);

      const frontmatter = formatFrontmatter({
        type: row.type,
        properties: Object.keys(props).length > 0 ? props : undefined,
        created: row.created_at,
      });

      const sections: string[] = [
        frontmatter,
        '',
        `# ${row.name}`,
      ];

      // Properties table
      if (Object.keys(props).length > 0) {
        sections.push('', '## Properties', '', '| Key | Value |', '|-----|-------|');
        for (const [key, value] of Object.entries(props)) {
          sections.push(`| ${key} | ${value} |`);
        }
      }

      // Relations
      if (relations.length > 0) {
        sections.push('', '## Relations', '');
        for (const rel of relations) {
          const targetFile = sanitizeFilename(rel.target_name);
          if (rel.direction === 'outgoing') {
            sections.push(`- **${rel.relation_type}** -> [[${targetFile}]] (${rel.target_type})`);
          } else {
            sections.push(`- **${rel.relation_type}** <- [[${targetFile}]] (${rel.target_type})`);
          }
        }
      }

      // Related knowledge
      if (relatedKnowledge.length > 0) {
        sections.push('', '## Related Knowledge', '');
        for (const k of relatedKnowledge) {
          sections.push(`- [[${sanitizeFilename(k.subject)}]] - ${k.category}`);
        }
      }

      writeFileSync(filePath, sections.join('\n') + '\n', 'utf-8');
    }

    return rows.length;
  }

  // ---------- Learning Export ----------

  private exportLearnings(vaultPath: string, lastSync: string | null): number {
    let sql = 'SELECT * FROM learnings';
    const params: unknown[] = [];

    if (lastSync) {
      sql += ' WHERE created_at > ?';
      params.push(lastSync);
    }

    sql += ' ORDER BY category, created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as LearningRow[];

    for (const row of rows) {
      const categoryDir = join(vaultPath, 'Learnings', sanitizeFilename(row.category));
      ensureDir(categoryDir);

      const filename = `${row.id}-${sanitizeFilename(row.content.slice(0, 50))}.md`;
      const filePath = join(categoryDir, filename);

      const frontmatter = formatFrontmatter({
        id: row.id,
        category: row.category,
        iteration: row.iteration,
        session_id: row.session_id,
        project: row.project,
        tags: row.tags ? row.tags.split(',').map((t) => t.trim()) : undefined,
        created: row.created_at,
      });

      const sections: string[] = [
        frontmatter,
        '',
        `# Learning #${row.id}`,
        '',
        row.content,
      ];

      writeFileSync(filePath, sections.join('\n') + '\n', 'utf-8');
    }

    return rows.length;
  }

  // ---------- Conversation Export ----------

  private exportConversations(vaultPath: string, lastSync: string | null): number {
    let sql = 'SELECT * FROM conversations';
    const params: unknown[] = [];

    if (lastSync) {
      sql += ' WHERE created_at > ?';
      params.push(lastSync);
    }

    sql += ' ORDER BY session_id, created_at';

    const rows = this.db.prepare(sql).all(...params) as ConversationRow[];

    if (rows.length === 0) return 0;

    // Group by session_id
    const sessions = new Map<string, ConversationRow[]>();
    for (const row of rows) {
      const existing = sessions.get(row.session_id) ?? [];
      existing.push(row);
      sessions.set(row.session_id, existing);
    }

    let sessionCount = 0;
    for (const [sessionId, entries] of sessions) {
      const firstEntry = entries[0];
      const datePrefix = firstEntry.created_at
        ? firstEntry.created_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const filename = `${datePrefix}-${sanitizeFilename(sessionId)}.md`;
      const filePath = join(vaultPath, 'Sessions', filename);

      const frontmatter = formatFrontmatter({
        session_id: sessionId,
        project: firstEntry.project,
        date: datePrefix,
        entries: entries.length,
      });

      const sections: string[] = [
        frontmatter,
        '',
        `# Session ${sessionId}`,
        '',
        '## Timeline',
        '',
      ];

      for (const entry of entries) {
        const time = entry.created_at ? entry.created_at.slice(11, 16) : '??:??';
        const calloutType = entry.role === 'user' ? 'note' : 'abstract';
        sections.push(`> [!${calloutType}] ${entry.role} (${time})`);

        // Indent content lines for callout block
        const contentLines = entry.content.split('\n');
        for (const line of contentLines) {
          sections.push(`> ${line}`);
        }
        sections.push('');
      }

      writeFileSync(filePath, sections.join('\n') + '\n', 'utf-8');
      sessionCount++;
    }

    return sessionCount;
  }

  // ---------- Index / MOC Generation ----------

  private generateIndexFiles(vaultPath: string): void {
    this.generateKnowledgeIndex(vaultPath);
    this.generateEntityIndex(vaultPath);
    this.generateLearningsIndex(vaultPath);
    this.generateGraphStats(vaultPath);
  }

  private generateKnowledgeIndex(vaultPath: string): void {
    const rows = this.db.prepare(
      'SELECT id, category, subject, confidence FROM knowledge ORDER BY category, subject'
    ).all() as KnowledgeRow[];

    // Group by category
    const byCategory = new Map<string, KnowledgeRow[]>();
    for (const row of rows) {
      const existing = byCategory.get(row.category) ?? [];
      existing.push(row);
      byCategory.set(row.category, existing);
    }

    const sections: string[] = [
      '# Knowledge Map',
      '',
      '## By Category',
      '',
    ];

    for (const [category, entries] of byCategory) {
      sections.push(`### ${category} (${entries.length} entries)`);
      for (const entry of entries) {
        sections.push(`- [[${sanitizeFilename(entry.subject)}]] (confidence: ${entry.confidence})`);
      }
      sections.push('');
    }

    writeFileSync(join(vaultPath, '_Index', 'All Knowledge.md'), sections.join('\n') + '\n', 'utf-8');
  }

  private generateEntityIndex(vaultPath: string): void {
    const entities = this.db.prepare(
      'SELECT * FROM entities ORDER BY type, name'
    ).all() as EntityRow[];

    // Count relations per entity
    const relationCounts = new Map<number, number>();
    const counts = this.db.prepare(`
      SELECT entity_id, COUNT(*) as cnt FROM (
        SELECT from_entity as entity_id FROM relations
        UNION ALL
        SELECT to_entity as entity_id FROM relations
      ) GROUP BY entity_id
    `).all() as { entity_id: number; cnt: number }[];

    for (const c of counts) {
      relationCounts.set(c.entity_id, c.cnt);
    }

    // Group by type
    const byType = new Map<string, EntityRow[]>();
    for (const ent of entities) {
      const existing = byType.get(ent.type) ?? [];
      existing.push(ent);
      byType.set(ent.type, existing);
    }

    const sections: string[] = [
      '# Entity Map',
      '',
      '## By Type',
      '',
    ];

    for (const [type, ents] of byType) {
      sections.push(`### ${type} (${ents.length})`);
      for (const ent of ents) {
        const relCount = relationCounts.get(ent.id) ?? 0;
        sections.push(`- [[${sanitizeFilename(ent.name)}]] - ${relCount} relations`);
      }
      sections.push('');
    }

    writeFileSync(join(vaultPath, '_Index', 'All Entities.md'), sections.join('\n') + '\n', 'utf-8');
  }

  private generateLearningsIndex(vaultPath: string): void {
    const rows = this.db.prepare(
      'SELECT id, category, content, iteration, created_at FROM learnings ORDER BY category, created_at DESC'
    ).all() as LearningRow[];

    // Group by category
    const byCategory = new Map<string, LearningRow[]>();
    for (const row of rows) {
      const existing = byCategory.get(row.category) ?? [];
      existing.push(row);
      byCategory.set(row.category, existing);
    }

    const sections: string[] = [
      '# All Learnings',
      '',
      '## By Category',
      '',
    ];

    for (const [category, entries] of byCategory) {
      sections.push(`### ${category} (${entries.length} entries)`);
      for (const entry of entries) {
        const preview = entry.content.slice(0, 80);
        sections.push(`- [[${entry.id}-${sanitizeFilename(preview)}|#${entry.id}]]: ${preview}... (iter: ${entry.iteration})`);
      }
      sections.push('');
    }

    writeFileSync(join(vaultPath, '_Index', 'All Learnings.md'), sections.join('\n') + '\n', 'utf-8');
  }

  private generateGraphStats(vaultPath: string): void {
    const knowledgeCount = (this.db.prepare('SELECT COUNT(*) as count FROM knowledge').get() as any).count;
    const entityCount = (this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as any).count;
    const relationCount = (this.db.prepare('SELECT COUNT(*) as count FROM relations').get() as any).count;
    const sessionCount = (this.db.prepare('SELECT COUNT(DISTINCT session_id) as count FROM conversations').get() as any).count;
    const categoryCount = (this.db.prepare('SELECT COUNT(DISTINCT category) as count FROM knowledge').get() as any).count;

    const entityTypes = this.db.prepare(
      'SELECT type, COUNT(*) as count FROM entities GROUP BY type ORDER BY count DESC'
    ).all() as { type: string; count: number }[];

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const sections: string[] = [
      '# Knowledge Graph Stats',
      '',
      `Last synced: ${now}`,
      '',
      '| Metric | Count |',
      '|--------|-------|',
      `| Knowledge entries | ${knowledgeCount} |`,
      `| Entities | ${entityCount} |`,
      `| Relations | ${relationCount} |`,
      `| Sessions logged | ${sessionCount} |`,
      `| Categories | ${categoryCount} |`,
      '',
      '## Entity Type Distribution',
    ];

    for (const et of entityTypes) {
      sections.push(`- ${et.type}: ${et.count}`);
    }

    writeFileSync(join(vaultPath, '_Index', 'Graph Stats.md'), sections.join('\n') + '\n', 'utf-8');
  }

  // ---------- Helpers ----------

  private getEntityRelations(entityId: number): RelationRow[] {
    const outgoing = this.db.prepare(`
      SELECT r.relation_type, e.name as target_name, e.type as target_type
      FROM relations r
      JOIN entities e ON e.id = r.to_entity
      WHERE r.from_entity = ?
    `).all(entityId) as { relation_type: string; target_name: string; target_type: string }[];

    const incoming = this.db.prepare(`
      SELECT r.relation_type, e.name as target_name, e.type as target_type
      FROM relations r
      JOIN entities e ON e.id = r.from_entity
      WHERE r.to_entity = ?
    `).all(entityId) as { relation_type: string; target_name: string; target_type: string }[];

    return [
      ...outgoing.map((r) => ({ ...r, direction: 'outgoing' as const })),
      ...incoming.map((r) => ({ ...r, direction: 'incoming' as const })),
    ];
  }

  private findRelatedKnowledge(entityName: string): { subject: string; category: string }[] {
    // Search knowledge content/subject for mentions of this entity
    try {
      const rows = this.db.prepare(`
        SELECT DISTINCT k.subject, k.category
        FROM knowledge k
        WHERE k.content LIKE ? OR k.subject LIKE ?
        LIMIT 10
      `).all(`%${entityName}%`, `%${entityName}%`) as { subject: string; category: string }[];
      return rows;
    } catch {
      return [];
    }
  }

  private columnExists(table: string, column: string): boolean {
    try {
      const info = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      return info.some((col) => col.name === column);
    } catch {
      return false;
    }
  }

  private loadSyncState(): string | null {
    try {
      if (existsSync(this.syncStatePath)) {
        const data = JSON.parse(readFileSync(this.syncStatePath, 'utf-8')) as SyncState;
        return data.lastSync ?? null;
      }
    } catch {
      // Corrupted file, treat as no prior sync
    }
    return null;
  }

  private saveSyncState(): void {
    const state: SyncState = {
      lastSync: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    writeFileSync(this.syncStatePath, JSON.stringify(state, null, 2), 'utf-8');
  }
}
