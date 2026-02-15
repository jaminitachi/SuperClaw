import type Database from 'better-sqlite3';

export const CURRENT_VERSION = 1;

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );

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
      source TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      properties TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_entity INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      to_entity INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      properties TEXT,
      weight REAL DEFAULT 1.0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skill_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_name TEXT NOT NULL UNIQUE,
      invocation_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      avg_duration_ms REAL DEFAULT 0,
      last_used TEXT,
      feedback_score REAL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      subject, content, category,
      content='knowledge',
      content_rowid='id'
    );

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

    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
    CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge(updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
    CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity);
    CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity);
  `);

  // Record migration
  const existing = db.prepare('SELECT version FROM _migrations WHERE version = ?').get(CURRENT_VERSION);
  if (!existing) {
    db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(CURRENT_VERSION);
  }
}
