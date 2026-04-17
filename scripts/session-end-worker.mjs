#!/usr/bin/env node
/**
 * session-end-worker.mjs — Background worker for Obsidian sync only.
 * Learning extraction moved to session-end.mjs (synchronous).
 *
 * Usage: node session-end-worker.mjs <tmp-json-path>
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { rotateIfNeeded } from './lib/log-rotate.mjs';

const HOME = homedir();
const HOOK_LOG_PATH = join(HOME, 'superclaw', 'data', 'logs', 'hooks.log');

function log(level, context, msg) {
  try {
    const ts = new Date().toISOString();
    mkdirSync(join(HOME, 'superclaw', 'data', 'logs'), { recursive: true });
    appendFileSync(HOOK_LOG_PATH, `[${ts}] [${level}] [worker/${context}] ${msg}\n`);
  } catch {}
}

/**
 * Trigger Obsidian incremental sync if configured.
 */
async function triggerObsidianSync() {
  try {
    const configPath = join(HOME, 'superclaw', 'superclaw.json');
    if (!existsSync(configPath)) return;

    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));

    if (!cfg.obsidian?.vaultPath || !cfg.obsidian?.syncOn?.includes('session_end')) return;

    const dbPath = join(HOME, 'superclaw', 'data', 'memory.db');
    if (!existsSync(dbPath)) return;

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    const vaultPath = cfg.obsidian.vaultPath.startsWith('~')
      ? join(HOME, cfg.obsidian.vaultPath.slice(1))
      : cfg.obsidian.vaultPath;

    const syncStatePath = join(HOME, 'superclaw', 'data', 'obsidian-sync-state.json');
    let lastSync = null;
    if (existsSync(syncStatePath)) {
      try {
        const state = JSON.parse(readFileSync(syncStatePath, 'utf-8'));
        lastSync = state.lastSync || null;
      } catch {}
    }

    const include = cfg.obsidian.include || ['knowledge', 'entities', 'conversations'];

    if (include.includes('knowledge')) {
      const query = lastSync
        ? 'SELECT * FROM knowledge WHERE updated_at > ? ORDER BY updated_at DESC'
        : 'SELECT * FROM knowledge ORDER BY updated_at DESC';
      const rows = lastSync ? db.prepare(query).all(lastSync) : db.prepare(query).all();

      for (const row of rows) {
        const catDir = join(vaultPath, 'Knowledge', row.category || 'uncategorized');
        mkdirSync(catDir, { recursive: true });
        const safeName = row.subject.replace(/[/\\:*?"<>|]/g, '_').slice(0, 80);
        const filePath = join(catDir, `${safeName}.md`);
        const content = [
          '---',
          `category: ${row.category}`,
          `confidence: ${row.confidence}`,
          `access_count: ${row.access_count}`,
          `updated_at: ${row.updated_at}`,
          `created_at: ${row.created_at}`,
          '---',
          '',
          `# ${row.subject}`,
          '',
          row.content,
        ].join('\n');
        writeFileSync(filePath, content, 'utf-8');
      }

      log('INFO', 'obsidian', `Synced ${rows.length} knowledge entries`);
    }

    db.close();

    mkdirSync(join(HOME, 'superclaw', 'data'), { recursive: true });
    writeFileSync(syncStatePath, JSON.stringify({ lastSync: new Date().toISOString() }), 'utf-8');

  } catch (e) { log('ERROR', 'obsidian', e.message); }
}

// ── Main ──
async function main() {
  const tmpPath = process.argv[2];
  if (!tmpPath || !existsSync(tmpPath)) {
    log('ERROR', 'main', `tmp file not found: ${tmpPath}`);
    process.exit(1);
  }

  rotateIfNeeded(HOOK_LOG_PATH);

  try {
    const { unlinkSync } = await import('fs');
    unlinkSync(tmpPath);
  } catch {}

  await triggerObsidianSync();
  log('INFO', 'main', 'Obsidian sync completed');
}

main().catch((e) => {
  log('ERROR', 'main', e.message);
  process.exit(1);
});
