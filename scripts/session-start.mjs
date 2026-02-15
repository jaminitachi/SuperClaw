#!/usr/bin/env node
/**
 * SessionStart hook — loads relevant memories from persistent DB and OMC
 * notepad priority context into the session.
 */
import { readStdin } from './lib/stdin.mjs';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Load recent memories from SC's SQLite database.
 * Returns an array of summary strings.
 */
async function loadRecentMemories(dbPath) {
  const summaries = [];
  try {
    // Dynamic import of better-sqlite3 for hook context
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare(
        `SELECT key, value, category, updated_at
         FROM memories
         ORDER BY updated_at DESC
         LIMIT 10`
      )
      .all();
    db.close();
    if (rows.length > 0) {
      summaries.push('Recent memories:');
      for (const r of rows) {
        const cat = r.category ? ` [${r.category}]` : '';
        summaries.push(`  - ${r.key}${cat}: ${String(r.value).slice(0, 120)}`);
      }
    }
  } catch {
    // better-sqlite3 may not be available in hook context — fall back silently
  }
  return summaries;
}

/**
 * Load OMC notepad priority context if available.
 */
function loadOmcPriorityContext() {
  const lines = [];
  try {
    const notepadPath = join(homedir(), '.claude', '.omc', 'notepad.json');
    if (existsSync(notepadPath)) {
      const notepad = JSON.parse(readFileSync(notepadPath, 'utf-8'));
      if (notepad.priority && notepad.priority.trim()) {
        lines.push('OMC Priority Context:');
        lines.push(`  ${notepad.priority.trim()}`);
      }
    }
  } catch {
    // Notepad not available or malformed — skip silently
  }
  return lines;
}

async function main() {
  const input = await readStdin();
  try {
    JSON.parse(input); // validate input is JSON
  } catch {
    // non-JSON input is acceptable
  }

  const scRoot = join(homedir(), 'superclaw');
  const configPath = join(scRoot, 'superclaw.json');
  const dbPath = join(scRoot, 'data', 'memory.db');

  // First-run detection: if no config file, user hasn't run `npm run setup`
  if (!existsSync(configPath)) {
    const lines = [
      '[SuperClaw] No configuration found.',
      '',
      'Tell the user: "SuperClaw is not set up yet. Run this in your terminal first:"',
      '```',
      'cd ~/superclaw && npm run setup',
      '```',
      'This installs all prerequisites, configures Telegram, and builds the MCP servers.',
    ];
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: lines.join('\n'),
      },
    }));
    return;
  }

  // Check if Telegram is configured (optional but useful to mention)
  let telegramHint = '';
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (!cfg.telegram?.enabled || !cfg.telegram?.botToken) {
      telegramHint = 'Telegram is not configured. To add it, run `npm run setup` again or edit superclaw.json.';
    }
  } catch {}

  const lines = ['[SuperClaw] Persistent memory system active.'];
  if (telegramHint) lines.push(telegramHint);

  if (existsSync(dbPath)) {
    lines.push('Memory DB found — use sc_memory_search/sc_memory_recall to access past knowledge.');

    // Attempt to load recent memories directly
    const memories = await loadRecentMemories(dbPath);
    if (memories.length > 0) {
      lines.push(...memories);
    }
  } else {
    lines.push('No memory DB found. Use sc_memory_store to start building persistent memory.');
  }

  // Load OMC notepad priority context
  const omcContext = loadOmcPriorityContext();
  if (omcContext.length > 0) {
    lines.push(...omcContext);
  }

  // Check if OpenClaw gateway is available
  try {
    const response = await fetch('http://127.0.0.1:18789/', {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    if (response) {
      lines.push('OpenClaw gateway: connected (port 18789)');
    } else {
      lines.push('OpenClaw gateway: not reachable');
    }
  } catch {
    lines.push('OpenClaw gateway: not reachable');
  }

  lines.push('Skills: telegram-control, mac-control, memory-mgr, heartbeat, automation-pipeline, cron-mgr, skill-forge, setup, dev-workflow, paper-review, experiment-log, lit-review, research-analysis');
  lines.push('Delegation: see DELEGATION.md for agent routing table');

  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join('\n'),
    },
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
