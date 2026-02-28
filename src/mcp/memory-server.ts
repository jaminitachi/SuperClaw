import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { SessionBridge } from '../memory/session-bridge.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DB_PATH = process.env.SC_MEMORY_DB ?? join(homedir(), 'superclaw', 'data', 'memory.db');

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const sessionBridge = new SessionBridge(db);

// Load config for defaults
let scConfig: Record<string, any> = {};
try {
  const configPath = join(homedir(), 'superclaw', 'superclaw.json');
  if (existsSync(configPath)) {
    scConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  }
} catch { /* config is optional */ }

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    project TEXT,
    tags TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    access_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    properties TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entity INTEGER NOT NULL REFERENCES entities(id),
    to_entity INTEGER NOT NULL REFERENCES entities(id),
    relation_type TEXT NOT NULL,
    properties TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS skill_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_name TEXT NOT NULL,
    invocation_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    avg_duration_ms REAL,
    last_used TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL CHECK(category IN ('conventions', 'successes', 'failures', 'gotchas', 'commands', 'decisions', 'issues')),
    content TEXT NOT NULL,
    session_id TEXT,
    iteration INTEGER DEFAULT 0,
    project TEXT,
    tags TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS verification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_description TEXT NOT NULL,
    claimed_result TEXT,
    verified_result TEXT,
    verified_by TEXT DEFAULT 'atlas',
    passed INTEGER DEFAULT 0,
    evidence TEXT,
    session_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    subject, content, category,
    content='knowledge',
    content_rowid='id'
  );

  -- Triggers to keep FTS in sync
  CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
    INSERT INTO knowledge_fts(rowid, subject, content, category)
    VALUES (new.id, new.subject, new.content, new.category);
  END;

  CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, subject, content, category)
    VALUES ('delete', old.id, old.subject, old.content, old.category);
  END;

  CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, subject, content, category)
    VALUES ('delete', old.id, old.subject, old.content, old.category);
    INSERT INTO knowledge_fts(rowid, subject, content, category)
    VALUES (new.id, new.subject, new.content, new.category);
  END;
`);

const server = new McpServer({
  name: 'sc-memory',
  version: '1.0.0',
});

// --- Store ---

server.tool(
  'sc_memory_store',
  'Store a piece of knowledge in persistent memory with category and confidence',
  {
    category: z.string().describe('Knowledge category (e.g., "architecture", "preference", "error-fix", "decision")'),
    subject: z.string().describe('Brief subject/title'),
    content: z.string().describe('Detailed content to remember'),
    confidence: z.number().optional().describe('Confidence level 0-1 (default: 0.5)'),
  },
  async ({ category, subject, content, confidence }) => {
    const stmt = db.prepare(
      'INSERT INTO knowledge (category, subject, content, confidence) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(category, subject, content, confidence ?? 0.5);
    return {
      content: [{ type: 'text', text: `Stored knowledge #${result.lastInsertRowid}: [${category}] ${subject}` }],
    };
  }
);

// --- Search ---

server.tool(
  'sc_memory_search',
  'Search persistent memory using full-text search',
  {
    query: z.string().describe('Search query (supports FTS5 syntax)'),
    limit: z.number().optional().describe('Max results (default: 10)'),
    category: z.string().optional().describe('Filter by category'),
  },
  async ({ query, limit, category }) => {
    let sql = `
      SELECT k.id, k.category, k.subject, k.content, k.confidence, k.access_count, k.updated_at,
             rank
      FROM knowledge_fts fts
      JOIN knowledge k ON k.id = fts.rowid
      WHERE knowledge_fts MATCH ?
    `;
    const params: unknown[] = [query];

    if (category) {
      sql += ' AND k.category = ?';
      params.push(category);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit ?? 10);

    const rows = db.prepare(sql).all(...params) as any[];

    // Update access counts
    const updateStmt = db.prepare('UPDATE knowledge SET access_count = access_count + 1 WHERE id = ?');
    for (const row of rows) {
      updateStmt.run(row.id);
    }

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'No results found.' }] };
    }

    const text = rows.map((r) =>
      `[#${r.id}] [${r.category}] ${r.subject} (confidence: ${r.confidence}, accessed: ${r.access_count}x)\n${r.content}`
    ).join('\n\n---\n\n');

    return { content: [{ type: 'text', text: text }] };
  }
);

// --- Recall ---

server.tool(
  'sc_memory_recall',
  'Recall a specific memory entry by ID or get recent entries by category',
  {
    id: z.number().optional().describe('Specific memory ID'),
    category: z.string().optional().describe('Category to recall from'),
    limit: z.number().optional().describe('Max results (default: 5)'),
  },
  async ({ id, category, limit }) => {
    let rows: any[];

    if (id) {
      rows = db.prepare('SELECT * FROM knowledge WHERE id = ?').all(id) as any[];
    } else if (category) {
      rows = db.prepare(
        'SELECT * FROM knowledge WHERE category = ? ORDER BY updated_at DESC LIMIT ?'
      ).all(category, limit ?? 5) as any[];
    } else {
      rows = db.prepare(
        'SELECT * FROM knowledge ORDER BY updated_at DESC LIMIT ?'
      ).all(limit ?? 5) as any[];
    }

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'No memories found.' }] };
    }

    const text = rows.map((r) =>
      `[#${r.id}] [${r.category}] ${r.subject}\nConfidence: ${r.confidence} | Accessed: ${r.access_count}x | Updated: ${r.updated_at}\n${r.content}`
    ).join('\n\n---\n\n');

    return { content: [{ type: 'text', text: text }] };
  }
);

// --- Delete ---

server.tool(
  'sc_memory_delete',
  'Delete a memory entry by ID and table type',
  {
    table: z.enum(['knowledge', 'entities', 'learnings', 'conversations']).describe('Which table to delete from'),
    id: z.number().describe('The ID of the entry to delete'),
  },
  async ({ table, id }) => {
    try {
      const validTables = ['knowledge', 'entities', 'learnings', 'conversations'];
      if (!validTables.includes(table)) {
        return { content: [{ type: 'text', text: `Invalid table: ${table}` }], isError: true };
      }
      const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      if (result.changes === 0) {
        return { content: [{ type: 'text', text: `No entry found with id ${id} in ${table}` }] };
      }
      return { content: [{ type: 'text', text: `Deleted entry #${id} from ${table}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Delete error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// --- Graph Query ---

server.tool(
  'sc_memory_graph_query',
  'Query the knowledge graph for entities and their relations',
  {
    entity: z.string().optional().describe('Entity name to look up'),
    type: z.string().optional().describe('Entity type filter'),
    relation: z.string().optional().describe('Relation type filter'),
  },
  async ({ entity, type, relation: _relation }) => {
    let text = '';

    if (entity) {
      const ent = db.prepare('SELECT * FROM entities WHERE name = ?').get(entity) as any;
      if (!ent) {
        return { content: [{ type: 'text', text: `Entity "${entity}" not found.` }] };
      }

      const rels = db.prepare(`
        SELECT r.relation_type, e2.name as target, e2.type as target_type
        FROM relations r
        JOIN entities e2 ON e2.id = r.to_entity
        WHERE r.from_entity = ?
        UNION ALL
        SELECT r.relation_type, e2.name as target, e2.type as target_type
        FROM relations r
        JOIN entities e2 ON e2.id = r.from_entity
        WHERE r.to_entity = ?
      `).all(ent.id, ent.id) as any[];

      text = `Entity: ${ent.name} (${ent.type})\nProperties: ${ent.properties ?? 'none'}\n\nRelations:\n`;
      text += rels.map((r) => `  - ${r.relation_type} → ${r.target} (${r.target_type})`).join('\n');
    } else {
      let sql = 'SELECT * FROM entities';
      const params: unknown[] = [];
      if (type) {
        sql += ' WHERE type = ?';
        params.push(type);
      }
      sql += ' ORDER BY name LIMIT 50';

      const entities = db.prepare(sql).all(...params) as any[];
      text = entities.map((e) => `${e.name} (${e.type})`).join('\n');
    }

    return { content: [{ type: 'text', text: text || 'No entities found.' }] };
  }
);

// --- Entity Management ---

server.tool(
  'sc_memory_add_entity',
  'Add an entity to the knowledge graph',
  {
    name: z.string().describe('Entity name'),
    type: z.string().describe('Entity type (e.g., "project", "person", "technology", "file")'),
    properties: z.string().optional().describe('JSON string of additional properties'),
  },
  async ({ name, type, properties }) => {
    try {
      const result = db.prepare(
        'INSERT OR REPLACE INTO entities (name, type, properties) VALUES (?, ?, ?)'
      ).run(name, type, properties ?? null);
      return { content: [{ type: 'text', text: `Entity "${name}" (${type}) saved as #${result.lastInsertRowid}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

server.tool(
  'sc_memory_add_relation',
  'Add a relation between two entities in the knowledge graph',
  {
    from: z.string().describe('Source entity name'),
    to: z.string().describe('Target entity name'),
    relationType: z.string().describe('Relation type (e.g., "uses", "depends-on", "created-by")'),
    properties: z.string().optional().describe('JSON string of additional properties'),
  },
  async ({ from, to, relationType, properties }) => {
    const fromEnt = db.prepare('SELECT id FROM entities WHERE name = ?').get(from) as any;
    const toEnt = db.prepare('SELECT id FROM entities WHERE name = ?').get(to) as any;

    if (!fromEnt) return { content: [{ type: 'text', text: `Entity "${from}" not found. Add it first.` }], isError: true };
    if (!toEnt) return { content: [{ type: 'text', text: `Entity "${to}" not found. Add it first.` }], isError: true };

    db.prepare(
      'INSERT INTO relations (from_entity, to_entity, relation_type, properties) VALUES (?, ?, ?, ?)'
    ).run(fromEnt.id, toEnt.id, relationType, properties ?? null);

    return { content: [{ type: 'text', text: `Relation: ${from} --[${relationType}]--> ${to}` }] };
  }
);

// --- Conversation Log ---

server.tool(
  'sc_memory_log_conversation',
  'Log a conversation entry for cross-session history',
  {
    sessionId: z.string().describe('Current session ID'),
    role: z.string().describe('Role (user, assistant, system)'),
    content: z.string().describe('Message content'),
    project: z.string().optional().describe('Project context'),
    tags: z.string().optional().describe('Comma-separated tags'),
  },
  async ({ sessionId, role, content, project, tags }) => {
    db.prepare(
      'INSERT INTO conversations (session_id, role, content, project, tags) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, role, content, project ?? null, tags ?? null);
    return { content: [{ type: 'text', text: 'Conversation logged.' }] };
  }
);

// --- Stats ---

server.tool(
  'sc_memory_stats',
  'Get statistics about the persistent memory database',
  {},
  async () => {
    const knowledge = db.prepare('SELECT COUNT(*) as count FROM knowledge').get() as any;
    const conversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get() as any;
    const entities = db.prepare('SELECT COUNT(*) as count FROM entities').get() as any;
    const relations = db.prepare('SELECT COUNT(*) as count FROM relations').get() as any;
    const categories = db.prepare('SELECT category, COUNT(*) as count FROM knowledge GROUP BY category ORDER BY count DESC').all() as any[];

    const text = [
      '--- SuperClaw Memory Stats ---',
      `Knowledge entries: ${knowledge.count}`,
      `Conversation logs: ${conversations.count}`,
      `Entities: ${entities.count}`,
      `Relations: ${relations.count}`,
      '',
      'Knowledge by category:',
      ...categories.map((c) => `  ${c.category}: ${c.count}`),
    ].join('\n');

    return { content: [{ type: 'text', text }] };
  }
);

// --- Learning Store ---

server.tool(
  'sc_learning_store',
  'Store a learning entry for accumulation across sessions',
  {
    category: z.enum(['conventions', 'successes', 'failures', 'gotchas', 'commands', 'decisions', 'issues']).describe('Learning category'),
    content: z.string().describe('Learning content'),
    session_id: z.string().optional().describe('Session ID for tracking'),
    iteration: z.number().optional().describe('Iteration number'),
    project: z.string().optional().describe('Project context'),
    tags: z.string().optional().describe('Comma-separated tags'),
  },
  async ({ category, content, session_id, iteration, project, tags }) => {
    const stmt = db.prepare(
      'INSERT INTO learnings (category, content, session_id, iteration, project, tags) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(category, content, session_id ?? null, iteration ?? 0, project ?? null, tags ?? null);
    return {
      content: [{ type: 'text', text: `Learning stored #${result.lastInsertRowid}: [${category}] ${content.slice(0, 50)}...` }],
    };
  }
);

// --- Learning Recall ---

server.tool(
  'sc_learning_recall',
  'Recall learnings by category, project, or session',
  {
    category: z.string().optional().describe('Filter by category'),
    project: z.string().optional().describe('Filter by project'),
    limit: z.number().optional().describe('Max results (default: 20)'),
    session_id: z.string().optional().describe('Filter by session'),
  },
  async ({ category, project, limit, session_id }) => {
    let sql = 'SELECT * FROM learnings WHERE 1=1';
    const params: unknown[] = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (project) {
      sql += ' AND project = ?';
      params.push(project);
    }

    if (session_id) {
      sql += ' AND session_id = ?';
      params.push(session_id);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit ?? 20);

    const rows = db.prepare(sql).all(...params) as any[];

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'No learnings found.' }] };
    }

    const text = rows.map((r) =>
      `[#${r.id}] [${r.category}] ${r.content}\nIteration: ${r.iteration} | Session: ${r.session_id ?? 'N/A'} | Created: ${r.created_at}`
    ).join('\n\n---\n\n');

    return { content: [{ type: 'text', text: text }] };
  }
);

// --- Learning Summary ---

server.tool(
  'sc_learning_summary',
  'Get summary of learnings grouped by category',
  {
    project: z.string().optional().describe('Filter by project'),
    session_id: z.string().optional().describe('Filter by session'),
  },
  async ({ project, session_id }) => {
    let whereClause = '1=1';
    const params: unknown[] = [];

    if (project) {
      whereClause += ' AND project = ?';
      params.push(project);
    }

    if (session_id) {
      whereClause += ' AND session_id = ?';
      params.push(session_id);
    }

    // Count by category
    const countSql = `SELECT category, COUNT(*) as count FROM learnings WHERE ${whereClause} GROUP BY category ORDER BY count DESC`;
    const counts = db.prepare(countSql).all(...params) as any[];

    if (counts.length === 0) {
      return { content: [{ type: 'text', text: 'No learnings found.' }] };
    }

    const sections: string[] = ['--- Learning Summary ---', ''];

    for (const cat of counts) {
      sections.push(`${cat.category}: ${cat.count} entries`);

      // Get recent 3 entries for this category
      const recentSql = `SELECT content, created_at FROM learnings WHERE category = ? AND ${whereClause} ORDER BY created_at DESC LIMIT 3`;
      const recentParams = [cat.category, ...params];
      const recent = db.prepare(recentSql).all(...recentParams) as any[];

      for (const r of recent) {
        sections.push(`  - ${r.content.slice(0, 80)}... (${r.created_at})`);
      }
      sections.push('');
    }

    return { content: [{ type: 'text', text: sections.join('\n') }] };
  }
);

// --- Verification Log ---

server.tool(
  'sc_verification_log',
  'Log a verification attempt with claimed vs verified result',
  {
    task_description: z.string().describe('Description of the task being verified'),
    claimed_result: z.string().describe('What was claimed to be the result'),
    verified_result: z.string().describe('What was actually verified'),
    passed: z.boolean().describe('Did verification pass?'),
    evidence: z.string().optional().describe('Evidence from verification (test output, build logs, etc.)'),
    verified_by: z.string().optional().describe('Who/what verified (default: atlas)'),
    session_id: z.string().optional().describe('Session ID'),
  },
  async ({ task_description, claimed_result, verified_result, passed, evidence, verified_by, session_id }) => {
    const stmt = db.prepare(
      'INSERT INTO verification_log (task_description, claimed_result, verified_result, verified_by, passed, evidence, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(
      task_description,
      claimed_result,
      verified_result,
      verified_by ?? 'atlas',
      passed ? 1 : 0,
      evidence ?? null,
      session_id ?? null
    );

    const status = passed ? 'PASSED' : 'FAILED';
    return {
      content: [{ type: 'text', text: `Verification logged #${result.lastInsertRowid}: ${status} - ${task_description}` }],
    };
  }
);

// --- Obsidian Sync ---

function obsidianSanitizeFilename(name: string): string {
  return name
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

function obsidianEnsureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function obsidianInjectWikilinks(text: string, entityNames: string[]): string {
  if (entityNames.length === 0) return text;
  const sorted = [...entityNames].sort((a, b) => b.length - a.length);
  let result = text;
  for (const name of sorted) {
    if (name.length <= 2) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<!\\[\\[)\\b(${escaped})\\b(?!\\]\\])`, 'g');
    result = result.replace(pattern, `[[$1]]`);
  }
  return result;
}

function obsidianFrontmatter(fields: Record<string, unknown>): string {
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

function obsidianColumnExists(table: string, column: string): boolean {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return info.some((col) => col.name === column);
  } catch {
    return false;
  }
}

function obsidianLoadSyncState(): string | null {
  const syncPath = join(dataDir, 'obsidian-sync-state.json');
  try {
    if (existsSync(syncPath)) {
      const data = JSON.parse(readFileSync(syncPath, 'utf-8'));
      return data.lastSync ?? null;
    }
  } catch {
    // Corrupted file, treat as no prior sync
  }
  return null;
}

function obsidianSaveSyncState(): void {
  const syncPath = join(dataDir, 'obsidian-sync-state.json');
  const state = { lastSync: new Date().toISOString().replace('T', ' ').slice(0, 19) };
  writeFileSync(syncPath, JSON.stringify(state, null, 2), 'utf-8');
}

function obsidianExportKnowledge(vaultPath: string, lastSync: string | null, entityNames: string[]): number {
  let sql = 'SELECT * FROM knowledge';
  const params: unknown[] = [];
  if (lastSync) {
    sql += ' WHERE updated_at > ?';
    params.push(lastSync);
  }
  sql += ' ORDER BY category, subject';

  const rows = db.prepare(sql).all(...params) as any[];
  const allKnowledge = db.prepare('SELECT id, category, subject, confidence FROM knowledge ORDER BY category, subject').all() as any[];

  for (const row of rows) {
    const categoryDir = join(vaultPath, 'Knowledge', obsidianSanitizeFilename(row.category));
    obsidianEnsureDir(categoryDir);

    const filename = obsidianSanitizeFilename(row.subject) + '.md';
    const filePath = join(categoryDir, filename);

    const related = allKnowledge
      .filter((k: any) => k.category === row.category && k.id !== row.id)
      .map((k: any) => `- [[${obsidianSanitizeFilename(k.subject)}]] (confidence: ${k.confidence})`);

    const linkedContent = obsidianInjectWikilinks(row.content, entityNames);
    const tags = [row.category];

    const fm = obsidianFrontmatter({
      id: row.id,
      category: row.category,
      confidence: row.confidence,
      access_count: row.access_count,
      created: row.created_at,
      updated: row.updated_at,
      tags,
      aliases: [row.subject],
    });

    const sections: string[] = [fm, '', `# ${row.subject}`, '', linkedContent];
    if (related.length > 0) {
      sections.push('', '## Related Knowledge', '', ...related);
    }

    writeFileSync(filePath, sections.join('\n') + '\n', 'utf-8');
  }

  return rows.length;
}

function obsidianExportEntities(vaultPath: string, lastSync: string | null, _entityNames: string[]): number {
  let sql = 'SELECT * FROM entities';
  const params: unknown[] = [];
  const hasUpdatedAt = obsidianColumnExists('entities', 'updated_at');
  if (lastSync && hasUpdatedAt) {
    sql += ' WHERE updated_at > ?';
    params.push(lastSync);
  }
  sql += ' ORDER BY type, name';

  const rows = db.prepare(sql).all(...params) as any[];

  for (const row of rows) {
    const typeDir = join(vaultPath, 'Entities', obsidianSanitizeFilename(row.type));
    obsidianEnsureDir(typeDir);

    const filename = obsidianSanitizeFilename(row.name) + '.md';
    const filePath = join(typeDir, filename);

    let props: Record<string, unknown> = {};
    if (row.properties) {
      try { props = JSON.parse(row.properties); } catch { /* skip */ }
    }

    // Get relations
    const outgoing = db.prepare(`
      SELECT r.relation_type, e.name as target_name, e.type as target_type
      FROM relations r JOIN entities e ON e.id = r.to_entity
      WHERE r.from_entity = ?
    `).all(row.id) as any[];

    const incoming = db.prepare(`
      SELECT r.relation_type, e.name as target_name, e.type as target_type
      FROM relations r JOIN entities e ON e.id = r.from_entity
      WHERE r.to_entity = ?
    `).all(row.id) as any[];

    // Find related knowledge
    let relatedKnowledge: any[] = [];
    try {
      relatedKnowledge = db.prepare(`
        SELECT DISTINCT k.subject, k.category FROM knowledge k
        WHERE k.content LIKE ? OR k.subject LIKE ? LIMIT 10
      `).all(`%${row.name}%`, `%${row.name}%`);
    } catch { /* skip */ }

    const fm = obsidianFrontmatter({
      type: row.type,
      properties: Object.keys(props).length > 0 ? props : undefined,
      created: row.created_at,
    });

    const sections: string[] = [fm, '', `# ${row.name}`];

    if (Object.keys(props).length > 0) {
      sections.push('', '## Properties', '', '| Key | Value |', '|-----|-------|');
      for (const [key, value] of Object.entries(props)) {
        sections.push(`| ${key} | ${value} |`);
      }
    }

    const allRels = [
      ...outgoing.map((r: any) => ({ ...r, direction: 'outgoing' })),
      ...incoming.map((r: any) => ({ ...r, direction: 'incoming' })),
    ];

    if (allRels.length > 0) {
      sections.push('', '## Relations', '');
      for (const rel of allRels) {
        const targetFile = obsidianSanitizeFilename(rel.target_name);
        const arrow = rel.direction === 'outgoing' ? '->' : '<-';
        sections.push(`- **${rel.relation_type}** ${arrow} [[${targetFile}]] (${rel.target_type})`);
      }
    }

    if (relatedKnowledge.length > 0) {
      sections.push('', '## Related Knowledge', '');
      for (const k of relatedKnowledge) {
        sections.push(`- [[${obsidianSanitizeFilename(k.subject)}]] - ${k.category}`);
      }
    }

    writeFileSync(filePath, sections.join('\n') + '\n', 'utf-8');
  }

  return rows.length;
}

function obsidianExportLearnings(vaultPath: string, lastSync: string | null): number {
  let sql = 'SELECT * FROM learnings';
  const params: unknown[] = [];
  if (lastSync) {
    sql += ' WHERE created_at > ?';
    params.push(lastSync);
  }
  sql += ' ORDER BY category, created_at DESC';

  const rows = db.prepare(sql).all(...params) as any[];

  for (const row of rows) {
    const categoryDir = join(vaultPath, 'Learnings', obsidianSanitizeFilename(row.category));
    obsidianEnsureDir(categoryDir);

    const filename = `${row.id}-${obsidianSanitizeFilename(row.content.slice(0, 50))}.md`;
    const filePath = join(categoryDir, filename);

    const fm = obsidianFrontmatter({
      id: row.id,
      category: row.category,
      iteration: row.iteration,
      session_id: row.session_id,
      project: row.project,
      tags: row.tags ? row.tags.split(',').map((t: string) => t.trim()) : undefined,
      created: row.created_at,
    });

    const sections: string[] = [
      fm,
      '',
      `# Learning #${row.id}`,
      '',
      row.content,
    ];

    writeFileSync(filePath, sections.join('\n') + '\n', 'utf-8');
  }

  return rows.length;
}

function obsidianExportConversations(vaultPath: string, lastSync: string | null): number {
  let sql = 'SELECT * FROM conversations';
  const params: unknown[] = [];
  if (lastSync) {
    sql += ' WHERE created_at > ?';
    params.push(lastSync);
  }
  sql += ' ORDER BY session_id, created_at';

  const rows = db.prepare(sql).all(...params) as any[];
  if (rows.length === 0) return 0;

  const sessions = new Map<string, any[]>();
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

    const filename = `${datePrefix}-${obsidianSanitizeFilename(sessionId)}.md`;
    const filePath = join(vaultPath, 'Sessions', filename);

    const fm = obsidianFrontmatter({
      session_id: sessionId,
      project: firstEntry.project,
      date: datePrefix,
      entries: entries.length,
    });

    const sections: string[] = [fm, '', `# Session ${sessionId}`, '', '## Timeline', ''];

    for (const entry of entries) {
      const time = entry.created_at ? entry.created_at.slice(11, 16) : '??:??';
      const calloutType = entry.role === 'user' ? 'note' : 'abstract';
      sections.push(`> [!${calloutType}] ${entry.role} (${time})`);
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

function obsidianGenerateIndexFiles(vaultPath: string): void {
  // Knowledge MOC
  const knowledgeRows = db.prepare(
    'SELECT id, category, subject, confidence FROM knowledge ORDER BY category, subject'
  ).all() as any[];

  const byCategory = new Map<string, any[]>();
  for (const row of knowledgeRows) {
    const existing = byCategory.get(row.category) ?? [];
    existing.push(row);
    byCategory.set(row.category, existing);
  }

  const knowledgeSections: string[] = ['# Knowledge Map', '', '## By Category', ''];
  for (const [category, entries] of byCategory) {
    knowledgeSections.push(`### ${category} (${entries.length} entries)`);
    for (const entry of entries) {
      knowledgeSections.push(`- [[${obsidianSanitizeFilename(entry.subject)}]] (confidence: ${entry.confidence})`);
    }
    knowledgeSections.push('');
  }
  writeFileSync(join(vaultPath, '_Index', 'All Knowledge.md'), knowledgeSections.join('\n') + '\n', 'utf-8');

  // Entity MOC
  const entityRows = db.prepare('SELECT * FROM entities ORDER BY type, name').all() as any[];

  const relationCounts = new Map<number, number>();
  try {
    const counts = db.prepare(`
      SELECT entity_id, COUNT(*) as cnt FROM (
        SELECT from_entity as entity_id FROM relations
        UNION ALL
        SELECT to_entity as entity_id FROM relations
      ) GROUP BY entity_id
    `).all() as any[];
    for (const c of counts) {
      relationCounts.set(c.entity_id, c.cnt);
    }
  } catch { /* skip */ }

  const byType = new Map<string, any[]>();
  for (const ent of entityRows) {
    const existing = byType.get(ent.type) ?? [];
    existing.push(ent);
    byType.set(ent.type, existing);
  }

  const entitySections: string[] = ['# Entity Map', '', '## By Type', ''];
  for (const [type, ents] of byType) {
    entitySections.push(`### ${type} (${ents.length})`);
    for (const ent of ents) {
      const relCount = relationCounts.get(ent.id) ?? 0;
      entitySections.push(`- [[${obsidianSanitizeFilename(ent.name)}]] - ${relCount} relations`);
    }
    entitySections.push('');
  }
  writeFileSync(join(vaultPath, '_Index', 'All Entities.md'), entitySections.join('\n') + '\n', 'utf-8');

  // Learnings MOC
  const learningRows = db.prepare(
    'SELECT id, category, content, iteration, created_at FROM learnings ORDER BY category, created_at DESC'
  ).all() as any[];

  const learningsByCategory = new Map<string, any[]>();
  for (const row of learningRows) {
    const existing = learningsByCategory.get(row.category) ?? [];
    existing.push(row);
    learningsByCategory.set(row.category, existing);
  }

  const learningSections: string[] = ['# All Learnings', '', '## By Category', ''];
  for (const [category, entries] of learningsByCategory) {
    learningSections.push(`### ${category} (${entries.length} entries)`);
    for (const entry of entries) {
      const preview = entry.content.slice(0, 80);
      learningSections.push(`- [[${entry.id}-${obsidianSanitizeFilename(preview)}|#${entry.id}]]: ${preview}... (iter: ${entry.iteration})`);
    }
    learningSections.push('');
  }
  writeFileSync(join(vaultPath, '_Index', 'All Learnings.md'), learningSections.join('\n') + '\n', 'utf-8');

  // Graph Stats
  const knowledgeCount = (db.prepare('SELECT COUNT(*) as count FROM knowledge').get() as any).count;
  const entityCount = (db.prepare('SELECT COUNT(*) as count FROM entities').get() as any).count;
  const relationCount = (db.prepare('SELECT COUNT(*) as count FROM relations').get() as any).count;
  const sessionCount = (db.prepare('SELECT COUNT(DISTINCT session_id) as count FROM conversations').get() as any).count;
  const categoryCount = (db.prepare('SELECT COUNT(DISTINCT category) as count FROM knowledge').get() as any).count;

  const entityTypes = db.prepare(
    'SELECT type, COUNT(*) as count FROM entities GROUP BY type ORDER BY count DESC'
  ).all() as any[];

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const statsSections: string[] = [
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
    statsSections.push(`- ${et.type}: ${et.count}`);
  }
  writeFileSync(join(vaultPath, '_Index', 'Graph Stats.md'), statsSections.join('\n') + '\n', 'utf-8');
}

server.tool(
  'sc_obsidian_sync',
  'Export SuperClaw memory to an Obsidian vault as interconnected markdown files with [[wikilinks]]',
  {
    vault_path: z.string().optional().describe('Path to Obsidian vault folder. Defaults to config value from superclaw.json (e.g., ~/obsidian/superclaw-brain)'),
    mode: z.enum(['full', 'incremental']).optional().describe('full: export everything, incremental: only changes since last sync (default: incremental)'),
    include: z.array(z.enum(['knowledge', 'entities', 'conversations', 'learnings'])).optional().describe('What to include (default: all)'),
  },
  async ({ vault_path, mode, include }) => {
    try {
      // Use config default if vault_path not provided
      const rawPath: string | undefined = vault_path ?? (scConfig?.obsidian?.vaultPath as string | undefined);
      if (!rawPath) {
        return {
          content: [{ type: 'text', text: 'Error: vault_path is required. Provide it as argument or set obsidian.vaultPath in ~/superclaw/superclaw.json' }],
          isError: true,
        };
      }
      // Expand ~ to homedir
      const resolvedPath: string = rawPath.startsWith('~')
        ? join(homedir(), rawPath.slice(1))
        : rawPath;

      const syncMode = mode ?? 'incremental';
      const includeItems = include ?? ['knowledge', 'entities', 'conversations', 'learnings'];
      const lastSync = syncMode === 'incremental' ? obsidianLoadSyncState() : null;

      // Ensure vault directories
      obsidianEnsureDir(join(resolvedPath, 'Knowledge'));
      obsidianEnsureDir(join(resolvedPath, 'Entities'));
      obsidianEnsureDir(join(resolvedPath, 'Sessions'));
      obsidianEnsureDir(join(resolvedPath, 'Learnings'));
      obsidianEnsureDir(join(resolvedPath, '_Index'));

      // Collect all entity names for wikilink injection
      const allEntityNames = (
        db.prepare('SELECT name FROM entities').all() as { name: string }[]
      ).map((e) => e.name);

      let knowledgeExported = 0;
      let entitiesExported = 0;
      let sessionsExported = 0;
      let learningsExported = 0;

      if (includeItems.includes('knowledge')) {
        knowledgeExported = obsidianExportKnowledge(resolvedPath, lastSync, allEntityNames);
      }

      if (includeItems.includes('entities')) {
        entitiesExported = obsidianExportEntities(resolvedPath, lastSync, allEntityNames);
      }

      if (includeItems.includes('conversations')) {
        sessionsExported = obsidianExportConversations(resolvedPath, lastSync);
      }

      if (includeItems.includes('learnings')) {
        learningsExported = obsidianExportLearnings(resolvedPath, lastSync);
      }

      // Generate index files
      obsidianGenerateIndexFiles(resolvedPath);

      // Save sync state
      obsidianSaveSyncState();

      // Gather stats
      const categories = (
        db.prepare('SELECT DISTINCT category FROM knowledge ORDER BY category').all() as any[]
      ).map((r: any) => r.category);

      const entityTypes = (
        db.prepare('SELECT DISTINCT type FROM entities ORDER BY type').all() as any[]
      ).map((r: any) => r.type);

      const summary = [
        `Obsidian sync complete (${syncMode} mode)`,
        `Vault: ${resolvedPath}`,
        '',
        `Knowledge exported: ${knowledgeExported}`,
        `Entities exported: ${entitiesExported}`,
        `Sessions exported: ${sessionsExported}`,
        `Learnings exported: ${learningsExported}`,
        '',
        `Categories: ${categories.join(', ') || 'none'}`,
        `Entity types: ${entityTypes.join(', ') || 'none'}`,
        '',
        'Generated index files:',
        '  - _Index/All Knowledge.md',
        '  - _Index/All Entities.md',
        '  - _Index/All Learnings.md',
        '  - _Index/Graph Stats.md',
      ].join('\n');

      return { content: [{ type: 'text', text: summary }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Obsidian sync error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// --- Session History ---

server.tool(
  'sc_memory_session_history',
  'List past conversation sessions with message counts and last active timestamps',
  {
    limit: z.number().optional().describe('Max sessions to return (default: 10)'),
  },
  async ({ limit }) => {
    const sessions = sessionBridge.getSessionHistory(limit ?? 10);
    if (sessions.length === 0) {
      return { content: [{ type: 'text', text: 'No conversation sessions found.' }] };
    }
    const lines = sessions.map(
      (s) => `Session: ${s.sessionId} | Messages: ${s.messageCount} | Last active: ${s.lastActive}`
    );
    return { content: [{ type: 'text', text: `--- Session History ---\n${lines.join('\n')}` }] };
  }
);

// --- Notepad (cross-session scratchpad) ---

const NOTEPAD_PATH = join(homedir(), '.claude', '.sc', 'notepad.json');

function loadNotepad(): { priority: string; entries: Record<string, { content: string; updated_at: string }> } {
  try {
    if (existsSync(NOTEPAD_PATH)) {
      const raw = JSON.parse(readFileSync(NOTEPAD_PATH, 'utf-8'));
      return { priority: raw.priority ?? '', entries: raw.entries ?? {} };
    }
  } catch { /* corrupted file */ }
  return { priority: '', entries: {} };
}

function saveNotepad(notepad: { priority: string; entries: Record<string, { content: string; updated_at: string }> }): void {
  const dir = join(homedir(), '.claude', '.sc');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(NOTEPAD_PATH, JSON.stringify(notepad, null, 2), 'utf-8');
}

server.tool(
  'sc_notepad_write',
  'Write a memo to the cross-session notepad scratchpad. Use for working notes, decisions, or context that should persist.',
  {
    key: z.string().describe('Memo key (e.g., "current-task", "debug-notes")'),
    content: z.string().describe('Memo content'),
  },
  async ({ key, content }) => {
    const notepad = loadNotepad();
    notepad.entries[key] = { content, updated_at: new Date().toISOString() };
    saveNotepad(notepad);
    return { content: [{ type: 'text' as const, text: `Notepad memo saved: "${key}" (${content.length} chars)` }] };
  }
);

server.tool(
  'sc_notepad_read',
  'Read memos from the cross-session notepad.',
  {
    key: z.string().optional().describe('Specific key to read. Omit for all entries.'),
  },
  async ({ key }) => {
    const notepad = loadNotepad();
    if (key) {
      const entry = notepad.entries[key];
      if (!entry) return { content: [{ type: 'text' as const, text: `No entry "${key}".` }] };
      return { content: [{ type: 'text' as const, text: `[${key}] (${entry.updated_at})\n${entry.content}` }] };
    }
    const lines: string[] = [];
    if (notepad.priority) { lines.push(`Priority: ${notepad.priority}`, ''); }
    for (const [k, e] of Object.entries(notepad.entries)) {
      lines.push(`[${k}] (${e.updated_at})`, e.content, '');
    }
    return { content: [{ type: 'text' as const, text: lines.length ? lines.join('\n').trim() : 'Notepad is empty.' }] };
  }
);

server.tool(
  'sc_notepad_clear',
  'Clear notepad entries.',
  {
    key: z.string().optional().describe('Key to clear. Omit to clear all (keeps priority).'),
  },
  async ({ key }) => {
    const notepad = loadNotepad();
    if (key) {
      if (!notepad.entries[key]) return { content: [{ type: 'text' as const, text: `No entry "${key}".` }] };
      delete notepad.entries[key];
      saveNotepad(notepad);
      return { content: [{ type: 'text' as const, text: `Cleared "${key}".` }] };
    }
    notepad.entries = {};
    saveNotepad(notepad);
    return { content: [{ type: 'text' as const, text: 'All entries cleared (priority preserved).' }] };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('sc-memory fatal:', err);
  process.exit(1);
});
