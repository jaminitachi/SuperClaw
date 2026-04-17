#!/usr/bin/env node
/**
 * PreCompact hook — saves current SC state (active pipelines, recent memories)
 * and emits remember-tag formatted context for critical information.
 */
if (process.env.SUPERCLAW_DAEMON === '1') {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}
import { readStdin } from './lib/stdin.mjs';
import { existsSync, readFileSync, readdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ulwStatePath, ulwGatesPath, ulwVerifyLogPath } from './lib/ulw-paths.mjs';
import { loadUnverified } from './lib/ulw-verify-log.mjs';

/**
 * Gather active pipeline state from SC data directory.
 */
function getActivePipelines() {
  const lines = [];
  try {
    const pipelinesDir = join(homedir(), 'superclaw', 'data', 'pipelines');
    if (existsSync(pipelinesDir)) {
      const files = readdirSync(pipelinesDir).filter(f => f.endsWith('.json'));
      for (const file of files.slice(0, 5)) {
        try {
          const pipeline = JSON.parse(readFileSync(join(pipelinesDir, file), 'utf-8'));
          if (pipeline.active || pipeline.status === 'running') {
            lines.push(`Pipeline "${pipeline.name || file}": ${pipeline.status || 'active'}`);
          }
        } catch {
          // Malformed pipeline file — skip
        }
      }
    }
  } catch {
    // Pipeline directory not available
  }
  return lines;
}

/**
 * Gather recent memory keys from SC's SQLite database.
 */
async function getRecentMemoryKeys(dbPath) {
  const keys = [];
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare('SELECT subject, category FROM knowledge ORDER BY updated_at DESC LIMIT 5')
      .all();
    db.close();
    for (const r of rows) {
      const cat = r.category ? ` [${r.category}]` : '';
      keys.push(`${r.subject}${cat}`);
    }
  } catch {
    // better-sqlite3 may not be available — skip silently
  }
  return keys;
}

async function main() {
  const input = await readStdin();
  let data = null;
  try {
    data = JSON.parse(input);
  } catch {
    // non-JSON input is acceptable
  }
  const sessionId = data?.session_id || data?.sessionId || null;

  const dbPath = join(homedir(), 'superclaw', 'data', 'memory.db');
  const configPath = join(homedir(), 'superclaw', 'superclaw.json');
  const contextLines = [
    '[SuperClaw] Context compaction imminent.',
    'Critical knowledge should be persisted via sc_memory_store before it is lost.',
  ];

  // Build remember-tag formatted context for critical state
  const rememberParts = [];

  // Active pipelines
  const pipelines = await getActivePipelines();
  if (pipelines.length > 0) {
    rememberParts.push(`Active SC pipelines: ${pipelines.join(', ')}`);
  }

  // Recent memory keys (so the model knows what's stored)
  if (existsSync(dbPath)) {
    const memKeys = await getRecentMemoryKeys(dbPath);
    if (memKeys.length > 0) {
      rememberParts.push(`Recent SC memories: ${memKeys.join(', ')}`);
    }
  }

  // Telegram bot status
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (cfg.telegram?.enabled && cfg.telegram?.botToken) {
      rememberParts.push('Telegram bot was configured');
    }
  } catch {
    // Config read failed — not critical for compaction
  }

  // ULW state preservation — session-scoped only. No sessionId → no ULW context to preserve.
  if (sessionId) {
    const ulwPath = ulwStatePath(sessionId);
    if (ulwPath && existsSync(ulwPath)) {
      try {
        const ulwState = JSON.parse(readFileSync(ulwPath, 'utf-8'));
        rememberParts.push(`ULW mode: ACTIVE since ${ulwState.startedAt}, mode=${ulwState.mode}`);

        const gatesPath = ulwGatesPath(sessionId);
        if (gatesPath && existsSync(gatesPath)) {
          const gates = JSON.parse(readFileSync(gatesPath, 'utf-8'));
          rememberParts.push(`Gates: plan=${gates.planApproved}, tests=${gates.testsExist}, testsRun=${gates.testsRun}`);
        }

        const unverified = [...loadUnverified(ulwVerifyLogPath(sessionId))];
        if (unverified.length > 0) {
          rememberParts.push(`Unverified files (${unverified.length}): ${unverified.slice(0, 5).join(', ')}`);
        }
      } catch {}
    }
  }

  // Emit remember tags for the model to preserve
  if (rememberParts.length > 0) {
    contextLines.push('');
    contextLines.push('<remember>');
    contextLines.push(`SuperClaw state at compaction: ${rememberParts.join('. ')}.`);
    contextLines.push('SC tools: sc_memory_store, sc_memory_search, sc_memory_recall, sc_screenshot, sc_heartbeat.');
    contextLines.push('Delegation: see DELEGATION.md for agent routing (superclaw:mac-control, superclaw:memory-mgr, etc.).');
    contextLines.push('Fact-Check Rule: When claiming facts about external tools/APIs, (1) read code/--help first, (2) WebFetch official docs, (3) show sources. Never rely on training data alone.');
    contextLines.push('</remember>');
  }

  console.log(JSON.stringify({
    continue: true,
    systemMessage: contextLines.join('\n'),
  }));
}

main().catch((e) => {
  try { appendFileSync(join(homedir(), 'superclaw', 'data', 'logs', 'hooks.log'), `[${new Date().toISOString()}] [ERROR] [pre-compact] ${e?.message ?? e}\n`); } catch {}
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
