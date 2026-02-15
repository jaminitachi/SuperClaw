#!/usr/bin/env node
/**
 * PreCompact hook — saves current SC state (active pipelines, recent memories)
 * and emits remember-tag formatted context for critical information.
 */
import { readStdin } from './lib/stdin.mjs';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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
      .prepare('SELECT key, category FROM memories ORDER BY updated_at DESC LIMIT 5')
      .all();
    db.close();
    for (const r of rows) {
      const cat = r.category ? ` [${r.category}]` : '';
      keys.push(`${r.key}${cat}`);
    }
  } catch {
    // better-sqlite3 may not be available — skip silently
  }
  return keys;
}

async function main() {
  const input = await readStdin();
  try {
    JSON.parse(input); // validate input is JSON
  } catch {
    // non-JSON input is acceptable
  }

  const dbPath = join(homedir(), 'superclaw', 'data', 'memory.db');
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

  // Gateway status
  try {
    const response = await fetch('http://127.0.0.1:18789/', {
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);
    if (response) {
      rememberParts.push('OpenClaw gateway was connected');
    }
  } catch {
    // Gateway check failed — not critical for compaction
  }

  // Emit remember tags for the model to preserve
  if (rememberParts.length > 0) {
    contextLines.push('');
    contextLines.push('<remember>');
    contextLines.push(`SuperClaw state at compaction: ${rememberParts.join('. ')}.`);
    contextLines.push('SC tools: sc_memory_store, sc_memory_search, sc_memory_recall, sc_screenshot, sc_heartbeat.');
    contextLines.push('Delegation: see DELEGATION.md for agent routing (superclaw:mac-control, superclaw:memory-curator, etc.).');
    contextLines.push('</remember>');
  }

  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreCompact',
      additionalContext: contextLines.join('\n'),
    },
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
