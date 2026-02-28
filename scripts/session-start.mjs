#!/usr/bin/env node
/**
 * SessionStart hook — loads relevant memories from persistent DB and SC
 * notepad priority context into the session.
 */
import { readStdin } from './lib/stdin.mjs';
import { existsSync, readFileSync, appendFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { todosPath } from './lib/session.mjs';

const HOOK_LOG_PATH = join(homedir(), 'superclaw', 'data', 'logs', 'hooks.log');

function logError(context, err) {
  try {
    const ts = new Date().toISOString();
    const msg = err instanceof Error ? err.message : String(err);
    appendFileSync(HOOK_LOG_PATH, `[${ts}] [ERROR] [session-start/${context}] ${msg}\n`);
  } catch {}
}

function getDelegationProtocol() {
  return `[SuperClaw Delegation Protocol v2.0]

You are an orchestrator with specialist agents. Delegate tasks via: Task(subagent_type="superclaw:<agent>", model="<model>", prompt="<task>")

RULES:
1. Delegate ALL code changes to agents. Never write code directly.
2. Delegate debugging to sc-debugger.
3. Verify completion with sc-verifier before claiming done.
4. Use parallel dispatch for independent tasks.
5. Check system state before making claims (run commands to verify).

AGENT ROUTING:
- Code: sc-junior (simple), sc-atlas (standard), sc-architect (complex), sc-frontend (UI)
- Debug: sc-debugger
- Review: sc-code-reviewer, sc-security-reviewer, sc-performance
- Memory: memory-curator
- Research: paper-reader, literature-reviewer, experiment-tracker, data-analyst
- Infra: mac-control, system-monitor, heartbeat-mgr, cron-mgr, pipeline-builder
- Orchestration: sc-prometheus (plan), sc-metis (gaps), sc-momus (validate), sc-atlas (decompose)

MODEL SELECTION: haiku (trivial) | sonnet (standard, DEFAULT) | opus (complex reasoning)

TOOLS: sc_memory_store/search/recall, sc_notepad_write/read/clear, sc_send_message, sc_screenshot, sc_status`;
}

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
        `SELECT subject, content, category, updated_at
         FROM knowledge
         ORDER BY updated_at DESC
         LIMIT 10`
      )
      .all();
    db.close();
    if (rows.length > 0) {
      summaries.push('Recent memories:');
      for (const r of rows) {
        const cat = r.category ? ` [${r.category}]` : '';
        summaries.push(`  - ${r.subject}${cat}: ${String(r.content).slice(0, 120)}`);
      }
    }
  } catch (e) { logError('loadRecentMemories', e); }
  return summaries;
}

/**
 * Load SC notepad priority context if available.
 */
function loadScPriorityContext() {
  const lines = [];
  try {
    const notepadPath = join(homedir(), '.claude', '.sc', 'notepad.json');
    if (existsSync(notepadPath)) {
      const notepad = JSON.parse(readFileSync(notepadPath, 'utf-8'));
      if (notepad.priority && notepad.priority.trim()) {
        lines.push('SC Priority Context:');
        lines.push(`  ${notepad.priority.trim()}`);
      }
      // Read notepad entries (new scratchpad format)
      if (notepad.entries && typeof notepad.entries === 'object') {
        const keys = Object.keys(notepad.entries);
        if (keys.length > 0) {
          lines.push('SC Notepad entries:');
          for (const key of keys) {
            const entry = notepad.entries[key];
            const preview = entry.content?.slice(0, 100) ?? '';
            lines.push(`  - ${key}: ${preview}${entry.content?.length > 100 ? '...' : ''}`);
          }
        }
      }
    }
  } catch (e) { logError('loadScPriorityContext', e); }
  return lines;
}

/**
 * Get Claude Code usage stats via CLI
 */
async function getUsageStats() {
  const lines = [];
  try {
    const { execSync } = await import('child_process');

    // Get usage output
    const usage = execSync('claude usage 2>/dev/null || echo "Usage data unavailable"', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (usage && !usage.includes('unavailable')) {
      lines.push('');
      lines.push('Usage Stats:');
      // Add the raw usage output, indented
      for (const line of usage.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
  } catch (e) { logError('getUsageStats', e); }
  return lines;
}

async function main() {
  const input = await readStdin();
  let parsedInput = {};
  try {
    parsedInput = JSON.parse(input);
  } catch {
    // non-JSON input is acceptable
  }
  const sessionId = parsedInput?.session_id;

  // RULE 1: Clean up TODO state for this session
  try { unlinkSync(todosPath(sessionId)); } catch {}

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
  let cfg = null;
  try {
    cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (!cfg.telegram?.enabled || !cfg.telegram?.botToken) {
      telegramHint = 'Telegram is not configured. To add it, run `npm run setup` again or edit superclaw.json.';
    }
  } catch (e) { logError('loadConfig', e); }

  const lines = [getDelegationProtocol(), '', '[SuperClaw] Persistent memory system active.'];
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

  // Load SC notepad priority context
  const scContext = loadScPriorityContext();
  if (scContext.length > 0) {
    lines.push(...scContext);
  }

  // Check if Telegram bot is reachable
  try {
    if (cfg?.telegram?.enabled && cfg?.telegram?.botToken) {
      const res = await fetch(`https://api.telegram.org/bot${cfg.telegram.botToken}/getMe`, {
        signal: AbortSignal.timeout(1500),
      }).catch(() => null);
      if (res) {
        const data = await res.json();
        if (data.ok) {
          lines.push(`Telegram bot: connected (@${data.result.username})`);
        } else {
          lines.push('Telegram bot: token invalid');
        }
      } else {
        lines.push('Telegram bot: not reachable (network issue)');
      }
    }
  } catch (e) { logError('telegramCheck', e); }

  // Usage stats
  const usageLines = await getUsageStats();
  if (usageLines.length > 0) {
    lines.push(...usageLines);
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

main().catch((e) => { logError('main', e); console.log(JSON.stringify({ continue: true, suppressOutput: true })); });
