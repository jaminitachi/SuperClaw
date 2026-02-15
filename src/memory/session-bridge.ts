import type Database from 'better-sqlite3';

export class SessionBridge {
  constructor(private db: Database.Database) {}

  loadSessionContext(sessionId: string, limit = 20): string[] {
    const rows = this.db.prepare(
      'SELECT role, content FROM conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(sessionId, limit) as any[];
    return rows.reverse().map((r) => `[${r.role}] ${r.content}`);
  }

  getRelevantKnowledge(query: string, limit = 5): string[] {
    try {
      const rows = this.db.prepare(`
        SELECT k.subject, k.content, k.category
        FROM knowledge_fts fts
        JOIN knowledge k ON k.id = fts.rowid
        WHERE knowledge_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(query, limit) as any[];

      return rows.map((r) => `[${r.category}] ${r.subject}: ${r.content}`);
    } catch {
      return [];
    }
  }

  logConversation(sessionId: string, role: string, content: string, project?: string, tags?: string): void {
    this.db.prepare(
      'INSERT INTO conversations (session_id, role, content, project, tags) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, role, content, project ?? null, tags ?? null);
  }

  getSessionHistory(limit = 10): { sessionId: string; messageCount: number; lastActive: string }[] {
    const rows = this.db.prepare(`
      SELECT session_id, COUNT(*) as msg_count, MAX(created_at) as last_active
      FROM conversations
      GROUP BY session_id
      ORDER BY last_active DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map((r) => ({
      sessionId: r.session_id,
      messageCount: r.msg_count,
      lastActive: r.last_active,
    }));
  }
}
