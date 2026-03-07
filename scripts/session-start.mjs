#!/usr/bin/env node
/**
 * SessionStart hook — loads relevant memories from persistent DB and SC
 * notepad priority context into the session.
 */
import { readStdin } from './lib/stdin.mjs';
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'fs';
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

/**
 * Detect current project from cwd or git remote.
 */
function detectProject() {
  const cwd = process.cwd();
  // Extract project name from cwd (last directory component)
  const parts = cwd.split('/').filter(Boolean);
  const dirName = parts[parts.length - 1] || '';

  // Try git remote for more specific project identification
  try {
    const { execSync } = require('child_process');
    const remote = execSync('git remote get-url origin 2>/dev/null', {
      encoding: 'utf-8', timeout: 2000
    }).trim();
    // Extract repo name from URL: https://github.com/user/repo.git → repo
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (match) return { name: match[1].toLowerCase(), cwd, remote };
  } catch {}

  return { name: dirName.toLowerCase(), cwd, remote: null };
}

/**
 * Load smart context from SC's SQLite database.
 * Hierarchy: weekly-digests (compressed insights) → project-relevant learnings → recent knowledge
 */
async function loadRecentMemories(dbPath) {
  const summaries = [];
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });
    const project = detectProject();

    // Layer 1: Latest weekly digests (compressed insights from 1000+ learnings)
    const digests = db.prepare(
      `SELECT subject, content FROM knowledge
       WHERE category = 'weekly-digest'
       ORDER BY updated_at DESC LIMIT 3`
    ).all();

    if (digests.length > 0) {
      summaries.push('Accumulated insights (weekly digest):');
      for (const d of digests) {
        // Each digest has ~10 numbered insights, take first 5 to save tokens
        const lines = d.content.split('\n').filter(l => l.trim()).slice(0, 5);
        summaries.push(`  [${d.subject}]`);
        for (const l of lines) {
          summaries.push(`    ${l}`);
        }
      }
    }

    // Layer 2: Project-relevant learnings (non-archived, matching current project)
    if (project.name) {
      const projectLearnings = db.prepare(
        `SELECT content, category FROM learnings
         WHERE (project LIKE ? OR content LIKE ?)
         AND (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')
         ORDER BY created_at DESC LIMIT 5`
      ).all(`%${project.name}%`, `%${project.name}%`);

      if (projectLearnings.length > 0) {
        summaries.push(`Project learnings (${project.name}):`);
        for (const l of projectLearnings) {
          summaries.push(`  - [${l.category}] ${l.content.slice(0, 150)}`);
        }
      }
    }

    // Layer 3: Recent non-digest knowledge (decisions, architecture, etc.)
    const recentKnowledge = db.prepare(
      `SELECT subject, content, category FROM knowledge
       WHERE category != 'weekly-digest' AND category != 'session-summary'
       ORDER BY updated_at DESC LIMIT 5`
    ).all();

    if (recentKnowledge.length > 0) {
      summaries.push('Recent memories:');
      for (const r of recentKnowledge) {
        const cat = r.category ? ` [${r.category}]` : '';
        summaries.push(`  - ${r.subject}${cat}: ${String(r.content).slice(0, 120)}`);
      }
    }

    db.close();
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

      // Auto-cleanup: keep only last 10 working entries from last 3 days
      if (Array.isArray(notepad.working) && notepad.working.length > 10) {
        const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
        let recent = notepad.working.filter(e => (e.timestamp || '') >= cutoff);
        if (recent.length > 10) recent = recent.slice(-10);
        notepad.working = recent;
        try { writeFileSync(notepadPath, JSON.stringify(notepad, null, 2), 'utf-8'); } catch {}
      }

      if (notepad.priority && notepad.priority.trim()) {
        lines.push('SC Priority Context:');
        lines.push(`  ${notepad.priority.trim()}`);
      }
    }
  } catch (e) { logError('loadScPriorityContext', e); }
  return lines;
}

/**
 * Get Claude Code usage stats.
 * NOTE: Removed execSync('claude usage') — it spawned a new Claude session
 * causing ETIMEDOUT errors and useless "usage" session spam.
 * Usage is already shown in the HUD status line via usage-api.mjs.
 */
async function getUsageStats() {
  // Usage stats are handled by the HUD status line, not here.
  return [];
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

  // Auto-consolidate learnings if overdue (> 7 days since last digest)
  if (existsSync(dbPath)) {
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath, { readonly: true });
      const lastDigest = db.prepare(
        "SELECT updated_at FROM knowledge WHERE category = 'weekly-digest' ORDER BY updated_at DESC LIMIT 1"
      ).get();
      const unarchived = db.prepare(
        "SELECT COUNT(*) as cnt FROM learnings WHERE tags NOT LIKE '%archived%' OR tags IS NULL OR tags = ''"
      ).get();
      db.close();

      const daysSinceDigest = lastDigest
        ? (Date.now() - new Date(lastDigest.updated_at).getTime()) / 86_400_000
        : 999;

      if (daysSinceDigest > 7 && unarchived.cnt > 20) {
        lines.push(`Learning consolidation overdue (${Math.round(daysSinceDigest)}d, ${unarchived.cnt} unarchived). Running in background...`);
        // Fire and forget — don't block session start
        const { spawn: spawnChild } = await import('child_process');
        const child = spawnChild('node', [join(scRoot, 'scripts', 'learning-consolidate.mjs')], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
    } catch (e) { logError('autoConsolidate', e); }
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
