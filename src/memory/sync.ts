import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type Database from 'better-sqlite3';

const OPENCLAW_MEMORY = join(homedir(), '.openclaw', 'workspace', 'memory');

export class MemorySync {
  constructor(private db: Database.Database) {}

  syncFromOpenClaw(): number {
    if (!existsSync(OPENCLAW_MEMORY)) return 0;

    let imported = 0;
    const files = readdirSync(OPENCLAW_MEMORY).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const content = readFileSync(join(OPENCLAW_MEMORY, file), 'utf-8');
      if (!content.trim()) continue;

      const date = file.replace('.md', '');
      const existing = this.db.prepare(
        'SELECT id FROM knowledge WHERE category = ? AND subject = ?'
      ).get('openclaw-daily', date);

      if (!existing) {
        this.db.prepare(
          'INSERT INTO knowledge (category, subject, content, confidence, source) VALUES (?, ?, ?, ?, ?)'
        ).run('openclaw-daily', date, content, 0.7, 'openclaw-sync');
        imported++;
      }
    }

    // Sync MEMORY.md
    const memoryMd = join(homedir(), '.openclaw', 'workspace', 'MEMORY.md');
    if (existsSync(memoryMd)) {
      const content = readFileSync(memoryMd, 'utf-8');
      if (content.trim()) {
        const existing = this.db.prepare(
          'SELECT id FROM knowledge WHERE category = ? AND subject = ?'
        ).get('openclaw-longterm', 'MEMORY.md');

        if (existing) {
          this.db.prepare(
            'UPDATE knowledge SET content = ?, updated_at = datetime("now") WHERE id = ?'
          ).run(content, (existing as any).id);
        } else {
          this.db.prepare(
            'INSERT INTO knowledge (category, subject, content, confidence, source) VALUES (?, ?, ?, ?, ?)'
          ).run('openclaw-longterm', 'MEMORY.md', content, 0.9, 'openclaw-sync');
          imported++;
        }
      }
    }

    return imported;
  }

  exportToOpenClaw(): void {
    // Export high-confidence knowledge back to OpenClaw MEMORY.md
    const rows = this.db.prepare(
      'SELECT subject, content FROM knowledge WHERE confidence >= 0.8 AND source != ? ORDER BY updated_at DESC LIMIT 50'
    ).all('openclaw-sync') as any[];

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

    const outPath = join(OPENCLAW_MEMORY, 'superclaw-export.md');
    writeFileSync(outPath, lines.join('\n'));
  }
}
