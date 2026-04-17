#!/usr/bin/env node
/**
 * SessionEnd hook — v6: summarize logic removed.
 *
 * Learning extraction is now handled out-of-band by the TranscriptWatcher
 * inside sc-daemon (B2 architecture). This hook only does:
 *   1. ULW state cleanup
 *   2. Session cleanup
 *   3. Obsidian sync worker spawn (detached, non-blocking)
 *
 * The hook no longer spawns `claude -p` for extraction — that path was
 * unreliable because Claude Code's exit killed the subprocess before
 * completion. The daemon-side watcher detects idle transcripts (mtime > 10min)
 * and calls `codex exec` independently of Claude Code's lifecycle.
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, unlinkSync, existsSync, rmdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { readStdin } from './lib/stdin.mjs';
import { cleanupSession } from './lib/session.mjs';
import { ulwStatePath, ulwVerifyLogPath, ulwBoardPath, ulwGatesPath } from './lib/ulw-paths.mjs';

const HOME = homedir();
const HOOK_LOG_PATH = join(HOME, 'superclaw', 'data', 'logs', 'hooks.log');

function log(level, context, msg) {
  try {
    const ts = new Date().toISOString();
    mkdirSync(join(HOME, 'superclaw', 'data', 'logs'), { recursive: true });
    appendFileSync(HOOK_LOG_PATH, `[${ts}] [${level}] [session-end/${context}] ${msg}\n`);
  } catch {}
}

/**
 * Spawn background worker for Obsidian sync (fire-and-forget).
 * The worker does not call Claude CLI so it's safe to detach.
 */
async function spawnObsidianSyncWorker() {
  try {
    const { spawn: spawnBg } = await import('child_process');
    const tmpPath = join(HOME, '.claude', '.sc', `session-end-${Date.now()}.json`);
    mkdirSync(join(HOME, '.claude', '.sc'), { recursive: true });
    writeFileSync(tmpPath, JSON.stringify({ transcriptText: '', project: 'general', obsidianOnly: true }));

    const worker = spawnBg('node', [
      join(HOME, 'superclaw', 'scripts', 'session-end-worker.mjs'),
      tmpPath,
    ], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, SUPERCLAW_DAEMON: '1' },
    });
    worker.unref();
  } catch (e) { log('ERROR', 'obsidian-spawn', e.message); }
}

async function main() {
  const input = await readStdin();
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    data = {};
  }

  // Diagnostic log
  try {
    const keys = data ? Object.keys(data).join(',') : 'none';
    const isDaemon = process.env.SUPERCLAW_DAEMON === '1';
    log('INFO', 'init', `keys=${keys} daemon=${isDaemon} (v6: extraction delegated to daemon watcher)`);
  } catch {}

  // Ultrawork state cleanup — session-scoped only. Never touch STATE_DIR root.
  const sessionId = data?.session_id || data?.sessionId || null;
  const ulwPath = ulwStatePath(sessionId);
  if (sessionId && ulwPath) {
    let shouldClean = false;
    try {
      shouldClean = existsSync(ulwPath);
    } catch {
      shouldClean = false;
    }
    if (shouldClean) {
      try { unlinkSync(ulwPath); } catch {}
      try { unlinkSync(ulwVerifyLogPath(sessionId)); } catch {}
      try { unlinkSync(ulwBoardPath(sessionId)); } catch {}
      try { unlinkSync(ulwGatesPath(sessionId)); } catch {}
      // Cleanup hygiene: remove legacy 2-set state files from pre-refactor sessions
      const sessDir = dirname(ulwPath);
      try { unlinkSync(join(sessDir, 'ulw-edited-files.json')); } catch {}
      try { unlinkSync(join(sessDir, 'ulw-verified-files.json')); } catch {}
      // Remove session dir if now empty; ENOTEMPTY (non-ULW files remain) is silently ignored
      try { rmdirSync(sessDir); } catch {}
    }
  }

  // Skip for daemon-spawned sessions (they have their own cleanup path)
  if (process.env.SUPERCLAW_DAEMON === '1') {
    cleanupSession(data.session_id);
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Fire-and-forget Obsidian sync (safe — no Claude CLI spawn)
  await spawnObsidianSyncWorker();

  cleanupSession(data.session_id);
  console.log(JSON.stringify({ continue: true }));
}

main().catch((e) => { log('ERROR', 'main', e.message); console.log(JSON.stringify({ continue: true, suppressOutput: true })); });
