import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../src/memory/schema.js';

describe('initSchema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates knowledge table', () => {
    initSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map((t: any) => t.name);
    expect(names).toContain('knowledge');
  });

  it('creates learnings table with content check', () => {
    initSchema(db);
    // 10자 미만 거부
    expect(() => {
      db.prepare('INSERT INTO learnings (category, content) VALUES (?, ?)').run('conventions', 'short');
    }).toThrow();
    // 10자 이상 허용
    expect(() => {
      db.prepare('INSERT INTO learnings (category, content) VALUES (?, ?)').run('conventions', 'this is long enough content');
    }).not.toThrow();
  });

  it('creates FTS5 index for knowledge', () => {
    initSchema(db);
    const fts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts'").get();
    expect(fts).toBeTruthy();
  });

  it('creates FTS5 index for learnings', () => {
    initSchema(db);
    const fts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='learnings_fts'").get();
    expect(fts).toBeTruthy();
  });

  it('does NOT create entities/relations/conversations tables', () => {
    initSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map((t: any) => t.name);
    expect(names).not.toContain('entities');
    expect(names).not.toContain('relations');
    expect(names).not.toContain('conversations');
  });

  it('sets busy_timeout', () => {
    initSchema(db);
    const timeout = db.pragma('busy_timeout');
    expect(timeout).toEqual([{ timeout: 5000 }]);
  });
});
