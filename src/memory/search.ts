import type Database from 'better-sqlite3';

export interface SearchResult {
  id: number;
  category: string;
  subject: string;
  content: string;
  confidence: number;
  accessCount: number;
  updatedAt: string;
  rank: number;
}

export class MemorySearch {
  constructor(private db: Database.Database) {}

  fullTextSearch(query: string, options?: { category?: string; limit?: number }): SearchResult[] {
    const limit = options?.limit ?? 10;
    let sql = `
      SELECT k.id, k.category, k.subject, k.content, k.confidence,
             k.access_count, k.updated_at, rank
      FROM knowledge_fts fts
      JOIN knowledge k ON k.id = fts.rowid
      WHERE knowledge_fts MATCH ?
    `;
    const params: unknown[] = [query];

    if (options?.category) {
      sql += ' AND k.category = ?';
      params.push(options.category);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    // Bump access counts
    const update = this.db.prepare('UPDATE knowledge SET access_count = access_count + 1 WHERE id = ?');
    for (const row of rows) update.run(row.id);

    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      subject: r.subject,
      content: r.content,
      confidence: r.confidence,
      accessCount: r.access_count,
      updatedAt: r.updated_at,
      rank: r.rank,
    }));
  }

  getRecent(limit = 10, category?: string): SearchResult[] {
    let sql = 'SELECT *, 0 as rank FROM knowledge';
    const params: unknown[] = [];
    if (category) {
      sql += ' WHERE category = ?';
      params.push(category);
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    return (this.db.prepare(sql).all(...params) as any[]).map((r) => ({
      id: r.id,
      category: r.category,
      subject: r.subject,
      content: r.content,
      confidence: r.confidence,
      accessCount: r.access_count,
      updatedAt: r.updated_at,
      rank: 0,
    }));
  }

  getMostAccessed(limit = 10): SearchResult[] {
    return (this.db.prepare(
      'SELECT *, 0 as rank FROM knowledge ORDER BY access_count DESC LIMIT ?'
    ).all(limit) as any[]).map((r) => ({
      id: r.id,
      category: r.category,
      subject: r.subject,
      content: r.content,
      confidence: r.confidence,
      accessCount: r.access_count,
      updatedAt: r.updated_at,
      rank: 0,
    }));
  }

  getByCategory(): Record<string, number> {
    const rows = this.db.prepare(
      'SELECT category, COUNT(*) as count FROM knowledge GROUP BY category ORDER BY count DESC'
    ).all() as any[];
    const result: Record<string, number> = {};
    for (const r of rows) result[r.category] = r.count;
    return result;
  }
}
