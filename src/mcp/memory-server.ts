import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { initSchema } from '../memory/schema.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { loadConfig } from '../config/loader.js';
import {
  sanitizeFilename as obsidianSanitize,
  ensureDir as obsidianEnsure,
  injectWikilinks as obsidianInject,
  formatFrontmatter as obsidianFm,
} from '../memory/obsidian-export.js';

// --- DB Row Interfaces ---

interface KnowledgeRow {
  id: number;
  category: string;
  subject: string;
  content: string;
  confidence: number;
  access_count: number;
  tags: string;
  description: string;
  created_at: string;
  updated_at: string;
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

interface VerificationRow {
  id: number;
  task_description: string;
  claimed_result: string | null;
  verified_result: string | null;
  verified_by: string;
  passed: number;
  evidence: string | null;
  session_id: string | null;
  created_at: string;
}

interface SkillMetricRow {
  id: number;
  skill_name: string;
  invocation_count: number;
  success_count: number;
  avg_duration_ms: number | null;
  last_used: string | null;
  created_at: string;
  updated_at: string;
}

interface CountRow {
  count: number;
}

interface CategoryCountRow {
  category: string;
  count: number;
}

interface PragmaColumnInfo {
  name: string;
}

interface CategoryRow {
  category: string;
}

const DB_PATH = process.env.SC_MEMORY_DB ?? join(homedir(), 'superclaw', 'data', 'memory.db');

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Load config via unified loader (Zod-validated, cached, env override support)
const scConfig = loadConfig();

// Initialize schema from SSOT
initSchema(db);

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
    previewChars: z.number().optional().describe('Preview characters per result (default: 200, max: 2000). Use sc_memory_recall(id=N) for full content.'),
  },
  async ({ query, limit, category, previewChars }) => {
    // Auto-quote queries containing hyphens or special FTS5 chars
    // to prevent "no such column" errors (e.g., "qa-test" → "\"qa-test\"")
    let ftsQuery = query;
    if (/[-+*~]/.test(query) && !query.startsWith('"')) {
      ftsQuery = `"${query}"`;
    }

    let sql = `
      SELECT k.id, k.category, k.subject, k.content, k.confidence, k.access_count, k.updated_at,
             rank
      FROM knowledge_fts fts
      JOIN knowledge k ON k.id = fts.rowid
      WHERE knowledge_fts MATCH ?
    `;
    const params: unknown[] = [ftsQuery];

    if (category) {
      sql += ' AND k.category = ?';
      params.push(category);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit ?? 10);

    const previewLimit = Math.max(80, Math.min(2000, Math.floor(previewChars ?? 200)));

    const formatKnowledgeRows = (rows: (KnowledgeRow & { rank: number })[]) => {
      // Update access counts
      const updateStmt = db.prepare('UPDATE knowledge SET access_count = access_count + 1 WHERE id = ?');
      for (const row of rows) {
        updateStmt.run(row.id);
      }

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No results found.' }] };
      }

      // Progressive disclosure (inspired by Claude-Mem):
      // Show compact index first, truncate long content to save tokens.
      // Use sc_memory_recall with specific ID for full content.
      const text = rows.map((r) => {
        const content = String(r.content);
        const truncated = content.length > previewLimit ? content.slice(0, previewLimit) + '...[truncated, use sc_memory_recall id=' + r.id + ' for full]' : content;
        return `[#${r.id}] [${r.category}] ${r.subject} (confidence: ${r.confidence}, accessed: ${r.access_count}x)\n${truncated}`;
      }).join('\n\n---\n\n');

      return { content: [{ type: 'text' as const, text: `${rows.length} results found. Showing compact view (${previewLimit} chars/result) — use sc_memory_recall(id=N) for full content.\n\n${text}` }] };
    };

    try {
      const rows = db.prepare(sql).all(...params) as (KnowledgeRow & { rank: number })[];
      return formatKnowledgeRows(rows);
    } catch (err: any) {
      // FTS5 syntax error — try quoting the entire query
      if (err.message?.includes('fts5')) {
        const quotedQuery = `"${ftsQuery.replace(/"/g, '""')}"`;
        const quotedParams: unknown[] = [quotedQuery];
        if (category) quotedParams.push(category);
        quotedParams.push(limit ?? 10);
        try {
          const rows = db.prepare(sql).all(...quotedParams) as (KnowledgeRow & { rank: number })[];
          return formatKnowledgeRows(rows);
        } catch {
          return { content: [{ type: 'text' as const, text: `Search error: query "${query}" contains FTS5 syntax characters. Try simpler search terms.` }] };
        }
      }
      return { content: [{ type: 'text' as const, text: `Search error: ${err.message}` }] };
    }
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
    let rows: KnowledgeRow[];

    if (id) {
      rows = db.prepare('SELECT * FROM knowledge WHERE id = ?').all(id) as KnowledgeRow[];
    } else if (category) {
      rows = db.prepare(
        'SELECT * FROM knowledge WHERE category = ? ORDER BY updated_at DESC LIMIT ?'
      ).all(category, limit ?? 5) as KnowledgeRow[];
    } else {
      rows = db.prepare(
        'SELECT * FROM knowledge ORDER BY updated_at DESC LIMIT ?'
      ).all(limit ?? 5) as KnowledgeRow[];
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
    table: z.enum(['knowledge', 'learnings', 'verification_log']).describe('Which table to delete from'),
    id: z.number().describe('The ID of the entry to delete'),
  },
  async ({ table, id }) => {
    try {
      const validTables = ['knowledge', 'learnings', 'verification_log'];
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

// --- Stats ---

server.tool(
  'sc_memory_stats',
  'Get statistics about the persistent memory database',
  {},
  async () => {
    const knowledge = db.prepare('SELECT COUNT(*) as count FROM knowledge').get() as CountRow;
    const learnings = db.prepare('SELECT COUNT(*) as count FROM learnings').get() as CountRow;
    const categories = db.prepare('SELECT category, COUNT(*) as count FROM knowledge GROUP BY category ORDER BY count DESC').all() as CategoryCountRow[];
    const learningCategories = db.prepare('SELECT category, COUNT(*) as count FROM learnings GROUP BY category ORDER BY count DESC').all() as CategoryCountRow[];

    const text = [
      '--- SuperClaw Memory Stats ---',
      `Knowledge entries: ${knowledge.count}`,
      `Learning entries: ${learnings.count}`,
      '',
      'Knowledge by category:',
      ...categories.map((c) => `  ${c.category}: ${c.count}`),
      '',
      'Learnings by category:',
      ...learningCategories.map((c) => `  ${c.category}: ${c.count}`),
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

    const rows = db.prepare(sql).all(...params) as LearningRow[];

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'No learnings found.' }] };
    }

    const text = rows.map((r) =>
      `[#${r.id}] [${r.category}] ${r.content}\nIteration: ${r.iteration} | Session: ${r.session_id ?? 'N/A'} | Created: ${r.created_at}`
    ).join('\n\n---\n\n');

    return { content: [{ type: 'text', text: text }] };
  }
);

// --- Learning Search ---

server.tool(
  'sc_learning_search',
  'Full-text search learnings using FTS5',
  {
    query: z.string().describe('Search query (supports FTS5 syntax)'),
    category: z.string().optional().describe('Filter by category'),
    project: z.string().optional().describe('Filter by project'),
    limit: z.number().optional().describe('Max results (default: 20)'),
  },
  async ({ query, category, project, limit }) => {
    // Auto-quote queries containing hyphens or special FTS5 chars
    let ftsQuery = query;
    if (/[-+*~]/.test(query) && !query.startsWith('"')) {
      ftsQuery = `"${query}"`;
    }

    let sql = `
      SELECT l.id, l.category, l.content, l.session_id, l.iteration, l.project, l.tags, l.created_at,
             rank
      FROM learnings_fts fts
      JOIN learnings l ON l.id = fts.rowid
      WHERE learnings_fts MATCH ?
    `;
    const params: unknown[] = [ftsQuery];

    if (category) {
      sql += ' AND l.category = ?';
      params.push(category);
    }

    if (project) {
      sql += ' AND l.project = ?';
      params.push(project);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit ?? 20);

    const formatRows = (rows: (LearningRow & { rank: number })[]) => {
      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No learnings found.' }] };
      }

      const text = rows.map((r) =>
        `[#${r.id}] [${r.category}] ${r.content}\nIteration: ${r.iteration} | Session: ${r.session_id ?? 'N/A'} | Created: ${r.created_at}`
      ).join('\n\n---\n\n');

      return { content: [{ type: 'text' as const, text: `${rows.length} results found.\n\n${text}` }] };
    };

    try {
      const rows = db.prepare(sql).all(...params) as (LearningRow & { rank: number })[];
      return formatRows(rows);
    } catch (err: any) {
      // FTS5 syntax error — try quoting the entire query
      if (err.message?.includes('fts5')) {
        const quotedQuery = `"${ftsQuery.replace(/"/g, '""')}"`;
        const quotedParams: unknown[] = [quotedQuery];
        if (category) quotedParams.push(category);
        if (project) quotedParams.push(project);
        quotedParams.push(limit ?? 20);
        try {
          const rows = db.prepare(sql).all(...quotedParams) as (LearningRow & { rank: number })[];
          return formatRows(rows);
        } catch {
          return { content: [{ type: 'text' as const, text: `Search error: query "${query}" contains FTS5 syntax characters. Try simpler search terms.` }] };
        }
      }
      return { content: [{ type: 'text' as const, text: `Search error: ${err.message}` }] };
    }
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
    const counts = db.prepare(countSql).all(...params) as CategoryCountRow[];

    if (counts.length === 0) {
      return { content: [{ type: 'text', text: 'No learnings found.' }] };
    }

    const sections: string[] = ['--- Learning Summary ---', ''];

    for (const cat of counts) {
      sections.push(`${cat.category}: ${cat.count} entries`);

      // Get recent 3 entries for this category
      const recentSql = `SELECT content, created_at FROM learnings WHERE category = ? AND ${whereClause} ORDER BY created_at DESC LIMIT 3`;
      const recentParams = [cat.category, ...params];
      const recent = db.prepare(recentSql).all(...recentParams) as Pick<LearningRow, 'content' | 'created_at'>[];

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
// Helper functions imported from ../memory/obsidian-export.ts (SSOT)
const obsidianSanitizeFilename = obsidianSanitize;
const obsidianEnsureDir = obsidianEnsure;
const obsidianInjectWikilinks = obsidianInject;
const obsidianFrontmatter = obsidianFm;

function obsidianColumnExists(table: string, column: string): boolean {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as PragmaColumnInfo[];
    return info.some((col) => col.name === column);
  } catch (err) {
    console.error('[superclaw]', err instanceof Error ? err.message : err);
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
  } catch (err) {
    console.error('[superclaw]', err instanceof Error ? err.message : err);
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

  const rows = db.prepare(sql).all(...params) as KnowledgeRow[];
  const allKnowledge = db.prepare('SELECT id, category, subject, confidence FROM knowledge ORDER BY category, subject').all() as Pick<KnowledgeRow, 'id' | 'category' | 'subject' | 'confidence'>[];

  for (const row of rows) {
    const categoryDir = join(vaultPath, 'Knowledge', obsidianSanitizeFilename(row.category));
    obsidianEnsureDir(categoryDir);

    const filename = obsidianSanitizeFilename(row.subject) + '.md';
    const filePath = join(categoryDir, filename);

    const related = allKnowledge
      .filter((k) => k.category === row.category && k.id !== row.id)
      .map((k) => `- [[${obsidianSanitizeFilename(k.subject)}]] (confidence: ${k.confidence})`);

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

function obsidianExportLearnings(vaultPath: string, lastSync: string | null): number {
  let sql = 'SELECT * FROM learnings';
  const params: unknown[] = [];
  if (lastSync) {
    sql += ' WHERE created_at > ?';
    params.push(lastSync);
  }
  sql += ' ORDER BY category, created_at DESC';

  const rows = db.prepare(sql).all(...params) as LearningRow[];

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
      tags: row.tags ? row.tags.split(',').map((t) => t.trim()) : undefined,
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

function obsidianGenerateIndexFiles(vaultPath: string): void {
  // Knowledge MOC
  const knowledgeRows = db.prepare(
    'SELECT id, category, subject, confidence FROM knowledge ORDER BY category, subject'
  ).all() as Pick<KnowledgeRow, 'id' | 'category' | 'subject' | 'confidence'>[];

  const byCategory = new Map<string, Pick<KnowledgeRow, 'id' | 'category' | 'subject' | 'confidence'>[]>();
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

  // Learnings MOC
  const learningRows = db.prepare(
    'SELECT id, category, content, iteration, created_at FROM learnings ORDER BY category, created_at DESC'
  ).all() as Pick<LearningRow, 'id' | 'category' | 'content' | 'iteration' | 'created_at'>[];

  const learningsByCategory = new Map<string, Pick<LearningRow, 'id' | 'category' | 'content' | 'iteration' | 'created_at'>[]>();
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

  // Memory Stats
  const knowledgeCount = (db.prepare('SELECT COUNT(*) as count FROM knowledge').get() as CountRow).count;
  const learningsCount = (db.prepare('SELECT COUNT(*) as count FROM learnings').get() as CountRow).count;
  const categoryCount = (db.prepare('SELECT COUNT(DISTINCT category) as count FROM knowledge').get() as CountRow).count;

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const statsSections: string[] = [
    '# Memory Stats',
    '',
    `Last synced: ${now}`,
    '',
    '| Metric | Count |',
    '|--------|-------|',
    `| Knowledge entries | ${knowledgeCount} |`,
    `| Learnings | ${learningsCount} |`,
    `| Categories | ${categoryCount} |`,
  ];
  writeFileSync(join(vaultPath, '_Index', 'Memory Stats.md'), statsSections.join('\n') + '\n', 'utf-8');
}

server.tool(
  'sc_obsidian_sync',
  'Export SuperClaw memory to an Obsidian vault as interconnected markdown files with [[wikilinks]]',
  {
    vault_path: z.string().optional().describe('Path to Obsidian vault folder. Defaults to config value from superclaw.json (e.g., ~/obsidian/superclaw-brain)'),
    mode: z.enum(['full', 'incremental']).optional().describe('full: export everything, incremental: only changes since last sync (default: incremental)'),
    include: z.array(z.enum(['knowledge', 'learnings'])).optional().describe('What to include (default: all)'),
  },
  async ({ vault_path, mode, include }) => {
    try {
      // Use config default if vault_path not provided
      const rawPath: string | undefined = vault_path ?? scConfig.obsidian.vaultPath;
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
      const includeItems = include ?? ['knowledge', 'learnings'];
      const lastSync = syncMode === 'incremental' ? obsidianLoadSyncState() : null;

      // Ensure vault directories
      obsidianEnsureDir(join(resolvedPath, 'Knowledge'));
      obsidianEnsureDir(join(resolvedPath, 'Learnings'));
      obsidianEnsureDir(join(resolvedPath, '_Index'));

      let knowledgeExported = 0;
      let learningsExported = 0;

      if (includeItems.includes('knowledge')) {
        knowledgeExported = obsidianExportKnowledge(resolvedPath, lastSync, []);
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
        db.prepare('SELECT DISTINCT category FROM knowledge ORDER BY category').all() as CategoryRow[]
      ).map((r) => r.category);

      const summary = [
        `Obsidian sync complete (${syncMode} mode)`,
        `Vault: ${resolvedPath}`,
        '',
        `Knowledge exported: ${knowledgeExported}`,
        `Learnings exported: ${learningsExported}`,
        '',
        `Categories: ${categories.join(', ') || 'none'}`,
        '',
        'Generated index files:',
        '  - _Index/All Knowledge.md',
        '  - _Index/All Learnings.md',
        '  - _Index/Memory Stats.md',
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

// --- Notepad (cross-session scratchpad) ---

const NOTEPAD_PATH = join(homedir(), '.claude', '.sc', 'notepad.json');

function loadNotepad(): { priority: string; entries: Record<string, { content: string; updated_at: string }> } {
  try {
    if (existsSync(NOTEPAD_PATH)) {
      const raw = JSON.parse(readFileSync(NOTEPAD_PATH, 'utf-8'));
      return { priority: raw.priority ?? '', entries: raw.entries ?? {} };
    }
  } catch (err) { console.error('[superclaw]', err instanceof Error ? err.message : err); }
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
