#!/usr/bin/env node
/**
 * SessionStart hook — loads relevant memories from persistent DB and SC
 * notepad priority context into the session.
 */
if (process.env.SUPERCLAW_DAEMON === '1') {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}
import { readStdin } from './lib/stdin.mjs';
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { todosPath } from './lib/session.mjs';
import { trace } from './lib/hook-logger.mjs';
import { execSync, spawn } from 'child_process';

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
 * New 3-layer hierarchy:
 *   Layer 1: core-digest (project-matching, full content)
 *   Layer 2: recent weekly-digest (project-matching, unarchived)
 *   Layer 3: unarchived learnings (project-matching, recent 10)
 * Always includes "general" project content.
 */
async function loadRecentMemories(dbPath) {
  const summaries = [];
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });
    const project = detectProject();
    const projName = project.name || 'general';
    // Always match current project + "general"
    const projectPatterns = [projName];
    if (projName !== 'general') projectPatterns.push('general');

    // Layer 1: Core digests (evergreen compressed knowledge, per-project)
    for (const p of projectPatterns) {
      const coreDigest = db.prepare(
        "SELECT subject, content FROM knowledge WHERE category = 'core-digest' AND subject = ? LIMIT 1"
      ).get(`Core Digest: ${p}`);

      if (coreDigest) {
        summaries.push(`Core knowledge (${p}):`);
        const lines = coreDigest.content.split('\n').filter(l => l.trim());
        for (const l of lines) {
          summaries.push(`  ${l}`);
        }
      }
    }

    // Layer 2: Recent unarchived weekly-digests (project-matching)
    for (const p of projectPatterns) {
      const weeklyDigests = db.prepare(
        `SELECT subject, content FROM knowledge
         WHERE category = 'weekly-digest'
           AND subject LIKE ?
           AND (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')
         ORDER BY updated_at DESC LIMIT 2`
      ).all(`Weekly Digest: ${p} (%`);

      if (weeklyDigests.length > 0) {
        summaries.push(`Recent weekly insights (${p}):`);
        for (const d of weeklyDigests) {
          const lines = d.content.split('\n').filter(l => l.trim()).slice(0, 5);
          summaries.push(`  [${d.subject}]`);
          for (const l of lines) {
            summaries.push(`    ${l}`);
          }
        }
      }
    }

    // Layer 3: Unarchived learnings (project-matching, recent 10)
    for (const p of projectPatterns) {
      const learnings = db.prepare(
        `SELECT content, category FROM learnings
         WHERE (COALESCE(NULLIF(project, ''), 'general') = ?)
         AND (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')
         ORDER BY created_at DESC LIMIT 10`
      ).all(p);

      if (learnings.length > 0) {
        summaries.push(`Recent learnings (${p}):`);
        for (const l of learnings) {
          summaries.push(`  - [${l.category}] ${l.content.slice(0, 150)}`);
        }
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

      // Schema: { priority, entries: { key: { content, updated_at } } }
      if (notepad.priority && notepad.priority.trim()) {
        lines.push('SC Priority Context:');
        lines.push(`  ${notepad.priority.trim()}`);
      }

      // Show recent notepad entries
      if (notepad.entries && typeof notepad.entries === 'object') {
        const entries = Object.entries(notepad.entries);
        if (entries.length > 0) {
          lines.push('SC Notepad:');
          for (const [key, val] of entries.slice(-5)) {
            const content = (val && typeof val === 'object' && val.content) ? val.content : String(val);
            lines.push(`  [${key}] ${content.slice(0, 200)}`);
          }
        }
      }
    }
  } catch (e) { logError('loadScPriorityContext', e); }
  return lines;
}

/**
 * First-run auto-install of learning-consolidate launchd plist.
 * Memory consolidation is SuperClaw's core feature — must work without `npm run setup`.
 * Silent no-op if: non-macOS / plist already installed / script missing.
 */
async function ensureLearningConsolidatePlist() {
  try {
    if (platform() !== 'darwin') return;
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.user.sc-learning-consolidate.plist');
    if (existsSync(plistPath)) return;
    const scriptPath = join(homedir(), 'superclaw', 'scripts', 'learning-consolidate.mjs');
    if (!existsSync(scriptPath)) return;
    const { addSchedule } = await import('./lib/schedule-manager.mjs');
    addSchedule({ name: 'learning-consolidate', nodeScript: scriptPath, hour: 3, minute: 0, weekday: 0 });
    logError('plist-auto-install', new Error('learning-consolidate plist registered (first-run, Sun 03:00)'));
  } catch (e) { logError('ensureLearningConsolidatePlist', e); }
}

/**
 * First-run auto-install of sc-daemon (TranscriptWatcher for 12h session summaries).
 * Requires pre-built bridge/sc-daemon.cjs — skipped if user hasn't run `npm run build`.
 */
async function ensureDaemonInstalled() {
  try {
    if (platform() !== 'darwin') return;
    const daemonPlist = join(homedir(), 'Library', 'LaunchAgents', 'com.superclaw.daemon.plist');
    if (existsSync(daemonPlist)) return;
    const daemonScript = join(homedir(), 'superclaw', 'scripts', 'daemon.mjs');
    const bridgeFile = join(homedir(), 'superclaw', 'bridge', 'sc-daemon.cjs');
    if (!existsSync(daemonScript)) return;
    if (!existsSync(bridgeFile)) {
      logError('daemon-auto-install-skip', new Error('bridge/sc-daemon.cjs missing — run `npm run build` first'));
      return;
    }
    // Detached spawn — install runs launchctl which may take a moment; don't block hook
    const child = spawn(process.execPath, [daemonScript, 'install'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    logError('daemon-auto-install', new Error('daemon install triggered (first-run)'));
  } catch (e) { logError('ensureDaemonInstalled', e); }
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

  // Core feature: ensure memory-consolidation plist is installed (silent, idempotent)
  await ensureLearningConsolidatePlist();
  await ensureDaemonInstalled();

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
      systemMessage: lines.join('\n'),
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

    // knowledge 자동 recall (access_count 증가)
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath);
      const recentKnowledge = db.prepare(
        'SELECT id, category, subject FROM knowledge ORDER BY updated_at DESC LIMIT 5'
      ).all();

      if (recentKnowledge.length > 0) {
        // access_count 증가
        const updateStmt = db.prepare('UPDATE knowledge SET access_count = access_count + 1 WHERE id = ?');
        for (const k of recentKnowledge) {
          updateStmt.run(k.id);
        }

        // context에 포함
        lines.push('');
        lines.push('Recent knowledge:');
        for (const k of recentKnowledge) {
          lines.push(`  [${k.category}] ${k.subject}`);
        }
      }
      db.close();
    } catch (e) { logError('knowledgeRecall', e); }
  } else {
    lines.push('No memory DB found. Use sc_memory_store to start building persistent memory.');
  }

  // Load SC notepad priority context
  const scContext = loadScPriorityContext();
  if (scContext.length > 0) {
    lines.push(...scContext);
  }

  // ── SuperClaw Orchestration Model (v4: minimal token footprint) ──
  lines.push('');
  lines.push('SuperClaw v4: Team-based orchestration. Use /ultrawork for PO mode.');
  lines.push('Teams: DEV (architect/frontend/backend/qa), RESEARCH (reviewer/writer/assistant), INFRA (monitor/mac), VERIFY.');
  lines.push('See ~/superclaw/agents/TEAMS.md for details.');

  trace(sessionId, 'hook:SessionStart:output', {
    additionalContext: lines.join('\n').slice(0, 1000),
    contextLength: lines.join('\n').length,
  });

  console.log(JSON.stringify({
    continue: true,
    systemMessage: lines.join('\n'),
  }));
}

main().catch((e) => { logError('main', e); console.log(JSON.stringify({ continue: true, suppressOutput: true })); });
