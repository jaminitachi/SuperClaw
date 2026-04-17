import type Database from 'better-sqlite3';

export const CURRENT_VERSION = 2;

export function initSchema(db: Database.Database): void {
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
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

    CREATE TABLE IF NOT EXISTS learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK(category IN ('conventions', 'successes', 'failures', 'gotchas', 'commands', 'decisions', 'issues')),
      content TEXT NOT NULL CHECK(length(content) >= 10),
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
      verified_by TEXT DEFAULT 'verify',
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

    CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
      content, category,
      content='learnings',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS learnings_ai AFTER INSERT ON learnings BEGIN
      INSERT INTO learnings_fts(rowid, content, category)
      VALUES (new.id, new.content, new.category);
    END;

    CREATE TRIGGER IF NOT EXISTS learnings_ad AFTER DELETE ON learnings BEGIN
      INSERT INTO learnings_fts(learnings_fts, rowid, content, category)
      VALUES ('delete', old.id, old.content, old.category);
    END;

    CREATE TRIGGER IF NOT EXISTS learnings_au AFTER UPDATE ON learnings BEGIN
      INSERT INTO learnings_fts(learnings_fts, rowid, content, category)
      VALUES ('delete', old.id, old.content, old.category);
      INSERT INTO learnings_fts(rowid, content, category)
      VALUES (new.id, new.content, new.category);
    END;

    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
    CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge(updated_at);
    CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);
    CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings(project);
  `);

  // Record migration
  const existing = db.prepare('SELECT version FROM _migrations WHERE version = ?').get(CURRENT_VERSION);
  if (!existing) {
    db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(CURRENT_VERSION);
  }
}
