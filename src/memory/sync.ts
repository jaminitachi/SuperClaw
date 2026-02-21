import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';

export class MemorySync {
  private externalMemoryPath: string | null;

  constructor(private db: Database.Database, externalMemoryPath?: string) {
    this.externalMemoryPath = externalMemoryPath ?? null;
  }

  syncFromExternal(): number {
    if (!this.externalMemoryPath || !existsSync(this.externalMemoryPath)) return 0;

    let imported = 0;
    const files = readdirSync(this.externalMemoryPath).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const content = readFileSync(join(this.externalMemoryPath, file), 'utf-8');
      if (!content.trim()) continue;

      const subject = file.replace('.md', '');
      const existing = this.db.prepare(
        'SELECT id FROM knowledge WHERE category = ? AND subject = ?'
      ).get('external-sync', subject);

      if (!existing) {
        this.db.prepare(
          'INSERT INTO knowledge (category, subject, content, confidence, source) VALUES (?, ?, ?, ?, ?)'
        ).run('external-sync', subject, content, 0.7, 'external-sync');
        imported++;
      }
    }

    return imported;
  }

  exportToExternal(): void {
    if (!this.externalMemoryPath) return;

    const rows = this.db.prepare(
      'SELECT subject, content FROM knowledge WHERE confidence >= 0.8 AND source != ? ORDER BY updated_at DESC LIMIT 50'
    ).all('external-sync') as any[];

    if (rows.length === 0) return;

    const lines = [
      '# SuperClaw Knowledge Export',
      `_Last synced: ${new Date().toISOString()}_`,
      '',
    ];

    for (const row of rows) {
      lines.push(`## ${row.subject}`);
      lines.push(row.content);
      lines.push('');
    }

    const outPath = join(this.externalMemoryPath, 'superclaw-export.md');
    writeFileSync(outPath, lines.join('\n'));
  }
}
