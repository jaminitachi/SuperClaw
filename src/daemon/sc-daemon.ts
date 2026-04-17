/**
 * SuperClaw Daemon — standalone process that bridges Telegram to Claude Code.
 *
 * Polls Telegram for incoming messages, spawns `claude` CLI to process each one,
 * and sends the response back to the user. Runs independently of Claude Code.
 *
 * Usage:
 *   node bridge/sc-daemon.cjs          # foreground
 *   npm run daemon:start               # background (via scripts/daemon.mjs)
 */

import { spawn as spawnChild, execFileSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { CronScheduler } from '../cron/scheduler.js';
import { loadConfig } from '../config/loader.js';
import { loadRatchetState, saveRatchetState, ratchetCommit, ratchetReset, appendChangelog, shouldEscalate, type RatchetState } from './ratchet.js';
import { saveCheckpoint, loadCheckpoint, buildResumePrompt } from './handoff.js';
import { TranscriptWatcher } from './transcript-watcher.js';

// ─── Paths ────────────────────────────────────────────────────
const SUPERCLAW_ROOT = join(homedir(), 'superclaw');
const LOG_DIR = join(SUPERCLAW_ROOT, 'data', 'logs');
const PID_FILE = join(SUPERCLAW_ROOT, 'data', 'daemon.pid');
const TELEGRAM_BASE = 'https://api.telegram.org/bot';

// ─── Constants ────────────────────────────────────────────────
const POLL_TIMEOUT = 30;
const MAX_BACKOFF = 30_000;
const CLAUDE_TIMEOUT_MS = 300_000; // 5 minutes — Claude CLI startup can be slow
const TELEGRAM_MSG_LIMIT = 4000; // leave room below 4096
const MAX_TURNS = 15;

// ─── Types ────────────────────────────────────────────────────
interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { first_name?: string; username?: string };
    text?: string;
    date: number;
  };
}

interface TelegramResponse {
  ok: boolean;
  result?: TelegramUpdate[];
}

// ─── State ────────────────────────────────────────────────────
let running = true;
let cronScheduler: CronScheduler | null = null;
let transcriptWatcher: TranscriptWatcher | null = null;
let offset = 0;
let backoffMs = 1000;
let startedAt = Date.now();
let lastResponseTime = 0;
let pendingCount = 0;

const messageQueue: Array<{ chatId: number; text: string }> = [];
let processing = false;

// Per-chat session tracking — keeps conversation context alive
const chatSessions = new Map<number, string>(); // chatId → claude session_id

// ─── Logging ──────────────────────────────────────────────────
function log(level: string, msg: string): void {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [${level}] ${msg}\n`);
}

// ─── Config ───────────────────────────────────────────────────
interface DaemonTelegramConfig {
  botToken: string;
  defaultChatId: string;
  allowFrom: string[];
}

function loadDaemonConfig(): DaemonTelegramConfig {
  const cfg = loadConfig(SUPERCLAW_ROOT);

  if (!cfg.telegram.botToken) {
    log('FATAL', 'telegram.botToken not set in superclaw.json (or SC_TELEGRAM_TOKEN env)');
    process.exit(1);
  }

  return {
    botToken: cfg.telegram.botToken,
    defaultChatId: cfg.telegram.defaultChatId ?? '',
    allowFrom: cfg.telegram.allowFrom ?? [],
  };
}

// ─── PID Management ───────────────────────────────────────────
function writePidFile(): void {
  mkdirSync(join(SUPERCLAW_ROOT, 'data'), { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
}

function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {
    // Best effort
  }
}

// ─── Telegram API Helpers ─────────────────────────────────────
async function getUpdates(token: string, pollOffset: number, timeout: number): Promise<TelegramUpdate[]> {
  const params = new URLSearchParams({
    offset: String(pollOffset),
    timeout: String(timeout),
    allowed_updates: JSON.stringify(['message', 'edited_message', 'channel_post', 'callback_query']),
  });

  const url = `${TELEGRAM_BASE}${token}/getUpdates?${params}`;
  const res = await fetch(url);
  const data = (await res.json()) as TelegramResponse;

  if (!data.ok || !data.result) return [];
  return data.result;
}

async function sendChatAction(token: string, chatId: number, action: string): Promise<void> {
  const url = `${TELEGRAM_BASE}${token}/sendChatAction`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // Non-critical — ignore
  }
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  const url = `${TELEGRAM_BASE}${token}/sendMessage`;

  // Split long messages to respect Telegram's 4096 char limit
  const chunks = splitMessage(text, TELEGRAM_MSG_LIMIT);

  for (const chunk of chunks) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        log('WARN', `sendMessage failed: ${data.description ?? 'unknown error'}`);
      }
    } catch (err) {
      log('ERROR', `sendMessage error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitAt = remaining.lastIndexOf('\n', limit);
    if (splitAt < limit * 0.5) {
      // No good newline break — split at space
      splitAt = remaining.lastIndexOf(' ', limit);
    }
    if (splitAt < limit * 0.3) {
      // No good break — hard split
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

// ─── Direct Commands ──────────────────────────────────────────
function isDirectCommand(text: string): boolean {
  const cmd = text.trim().toLowerCase();
  return cmd === '/start' || cmd === '/status' || cmd === '/help' || cmd === '/ping';
}

function handleDirectCommand(text: string): string {
  const cmd = text.trim().toLowerCase();

  switch (cmd) {
    case '/start':
      return 'SuperClaw bot active. Send any message and Claude will respond.';

    case '/status': {
      const uptimeMs = Date.now() - startedAt;
      const uptimeMin = Math.floor(uptimeMs / 60_000);
      const uptimeHrs = Math.floor(uptimeMin / 60);
      const mins = uptimeMin % 60;
      const uptimeStr = uptimeHrs > 0 ? `${uptimeHrs}h ${mins}m` : `${mins}m`;
      const lastStr = lastResponseTime > 0
        ? new Date(lastResponseTime).toISOString()
        : 'none yet';
      return [
        '--- SuperClaw Daemon Status ---',
        `Uptime: ${uptimeStr}`,
        `Pending tasks: ${pendingCount}`,
        `Last response: ${lastStr}`,
        `PID: ${process.pid}`,
      ].join('\n');
    }

    case '/help':
      return [
        '--- SuperClaw Commands ---',
        '/start  - Activate bot',
        '/status - Show daemon status',
        '/new    - End session & extract learnings, start fresh',
        '/help   - List commands',
        '/ping   - Health check',
        '',
        'Any other message is forwarded to Claude for processing.',
      ].join('\n');

    case '/ping':
      return 'pong';

    default:
      return `Unknown command: ${cmd}`;
  }
}

// ─── Claude Execution ─────────────────────────────────────────

interface ClaudeResult {
  text: string;
  sessionId?: string;
}

function runClaude(message: string, chatId: number): Promise<ClaudeResult> {
  return new Promise((resolve) => {
    const args = [
      '-p', message,
      '--plugin-dir', SUPERCLAW_ROOT,
      '--output-format', 'json',
      '--max-turns', String(MAX_TURNS),
      '--permission-mode', 'bypassPermissions',
    ];

    // Resume existing session for this chat if available
    const existingSession = chatSessions.get(chatId);
    if (existingSession) {
      args.push('--resume', existingSession);
    }

    // Strip Claude Code nesting guard
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE;
    delete cleanEnv.CLAUDE_CODE_RUNNING;
    delete cleanEnv.CLAUDE_CODE_SESSION;
    delete cleanEnv.CLAUDE_CODE_ENTRY_POINT;
    cleanEnv.SUPERCLAW_DAEMON = '1';
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith('CMUX_')) delete cleanEnv[key];
    }
    cleanEnv.CMUX_CLAUDE_HOOKS_DISABLED = '1';

    const child = spawnChild('claude', args, {
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      log('WARN', `Claude timed out after ${CLAUDE_TIMEOUT_MS / 1000}s`);
      child.kill('SIGTERM');
    }, CLAUDE_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);

      if (code !== 0 && code !== null) {
        log('ERROR', `Claude exited with code ${code}`);
        if (stderr) log('ERROR', `Claude stderr: ${stderr.slice(0, 500)}`);
        resolve({ text: `[Error running Claude (exit ${code}): ${stderr.slice(0, 200) || 'unknown error'}]` });
        return;
      }

      // Parse JSON output to extract result + session_id
      // stdout might contain non-JSON lines before the actual JSON — find the JSON object
      const rawOut = stdout.trim();
      log('INFO', `Raw stdout (${rawOut.length} chars): "${rawOut.slice(0, 200)}..."`);

      try {
        // Find the last line that looks like JSON
        const jsonStart = rawOut.lastIndexOf('{"type"');
        const jsonStr = jsonStart >= 0 ? rawOut.slice(jsonStart) : rawOut;

        const json = JSON.parse(jsonStr) as {
          result?: string;
          session_id?: string;
          is_error?: boolean;
          subtype?: string;
        };

        const sessionId = json.session_id;
        if (sessionId) {
          chatSessions.set(chatId, sessionId);
          log('INFO', `Session ${sessionId.slice(0, 8)}... saved for chat ${chatId}`);
        }

        let text = json.result ?? '';
        if (!text && json.subtype === 'error_max_turns') {
          text = '[Claude hit turn limit. Send a follow-up message to continue.]';
        } else if (!text) {
          text = '[Claude returned empty response]';
        }
        resolve({ text, sessionId });
      } catch {
        // JSON parse failed — use raw output
        const text = stdout.trim() || '[Claude returned no output]';
        resolve({ text });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      log('ERROR', `Claude spawn error: ${err.message}`);
      resolve({ text: `[Error spawning Claude: ${err.message}]` });
    });

    if (child.pid) {
      const mode = existingSession ? `resume:${existingSession.slice(0, 8)}` : 'new';
      log('INFO', `Spawned claude (PID ${child.pid}, ${mode}) for: "${message.slice(0, 80)}..."`);
    }
  });
}

// ─── Message Queue ────────────────────────────────────────────
async function enqueueMessage(config: DaemonTelegramConfig, chatId: number, text: string): Promise<void> {
  messageQueue.push({ chatId, text });
  pendingCount = messageQueue.length;
  await processQueue(config);
}

async function processQueue(config: DaemonTelegramConfig): Promise<void> {
  if (processing) return;
  processing = true;

  while (messageQueue.length > 0 && running) {
    const item = messageQueue.shift()!;
    pendingCount = messageQueue.length;

    try {
      await sendChatAction(config.botToken, item.chatId, 'typing');
      log('INFO', `Running Claude for: "${item.text.slice(0, 60)}"`);
      const result = await runClaude(item.text, item.chatId);
      log('INFO', `Claude replied (${result.text.length} chars): "${result.text.slice(0, 100)}..."`);
      await sendMessage(config.botToken, item.chatId, result.text);
      log('INFO', `Telegram reply sent to ${item.chatId}`);
      lastResponseTime = Date.now();
    } catch (err) {
      log('ERROR', `Queue processing error: ${err instanceof Error ? err.message : String(err)}`);
      await sendMessage(
        config.botToken,
        item.chatId,
        '[Internal error processing your message. Please try again.]',
      );
    }
  }

  processing = false;
}

// ─── Allow-list Check ─────────────────────────────────────────
function isAllowed(chatId: number, allowFrom: string[]): boolean {
  if (allowFrom.length === 0) return true;
  return allowFrom.includes(String(chatId));
}

// ─── Graceful Shutdown ────────────────────────────────────────
function setupShutdown(): void {
  const shutdown = (signal: string) => {
    log('INFO', `Received ${signal} — shutting down`);
    running = false;
    cronScheduler?.stop();
    transcriptWatcher?.stop();

    // Wait briefly for current work, then clean up
    setTimeout(() => {
      removePidFile();
      log('INFO', 'SuperClaw daemon stopped');
      process.exit(0);
    }, 2000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ─── Autonomous Ratchet Loop ─────────────────────────────────
async function runAutonomousTask(taskPrompt: string, projectDir: string): Promise<void> {
  const config = loadConfig();

  // Resume from existing checkpoint if available
  const checkpoint = loadCheckpoint();
  let prompt = checkpoint
    ? buildResumePrompt(checkpoint) + '\n\n' + taskPrompt
    : taskPrompt;

  let state: RatchetState = loadRatchetState() || {
    taskId: `task-${Date.now()}`,
    iteration: 0,
    consecutiveFailures: 0,
    status: 'running',
    lastCheckpoint: new Date().toISOString(),
  };

  const MAX_ITERATIONS = 20;

  while (state.status === 'running' && state.iteration < MAX_ITERATIONS) {
    state.iteration++;
    log('INFO', `[ratchet] Iteration ${state.iteration}/${MAX_ITERATIONS}`);

    try {
      // Spawn claude -p session
      const args = [
        '-p', prompt,
        '--plugin-dir', SUPERCLAW_ROOT,
        '--output-format', 'json',
        '--max-turns', '30',
        '--permission-mode', 'bypassPermissions',
      ];

      if (projectDir) {
        args.push('--cwd', projectDir);
      }

      const taskEnv: Record<string, string | undefined> = { ...process.env };
      delete taskEnv.CLAUDECODE;
      delete taskEnv.CLAUDE_CODE;
      delete taskEnv.CLAUDE_CODE_RUNNING;
      delete taskEnv.CLAUDE_CODE_SESSION;
      delete taskEnv.CLAUDE_CODE_ENTRY_POINT;
      for (const key of Object.keys(taskEnv)) {
        if (key.startsWith('CMUX_')) delete taskEnv[key];
      }
      taskEnv.SUPERCLAW_DAEMON = '1';
      taskEnv.CMUX_CLAUDE_HOOKS_DISABLED = '1';

      const output = execFileSync('claude', args, {
        timeout: 600_000, // 10 minutes
        maxBuffer: 10 * 1024 * 1024,
        env: taskEnv,
        input: '',
      });

      const result = output.toString('utf-8');

      // Success: test pass or DONE status
      if (result.includes('"status":"completed"') || result.includes('DONE')) {
        // Success -> git commit
        const committed = ratchetCommit(projectDir, `[ratchet] iteration ${state.iteration}: success`);
        if (committed) {
          appendChangelog(projectDir, `Iteration ${state.iteration}: SUCCESS\n${result.slice(0, 200)}`);
        }
        state.consecutiveFailures = 0;
        state.lastCheckpoint = new Date().toISOString();

        // Save checkpoint
        saveCheckpoint({
          taskDescription: taskPrompt.slice(0, 200),
          completedSteps: [`iteration-${state.iteration}`],
          pendingSteps: [],
          failedApproaches: [],
          currentBranch: 'main',
          lastCommitHash: 'HEAD',
          timestamp: new Date().toISOString(),
        });

        // Next iteration uses result-based prompt
        prompt = `Previous iteration succeeded. Continue with remaining tasks.\n\n${taskPrompt}`;

      } else {
        // Failure -> git reset
        state.consecutiveFailures++;
        ratchetReset(projectDir);
        appendChangelog(projectDir, `Iteration ${state.iteration}: FAILED\n${result.slice(0, 200)}`);

        prompt = `Previous iteration failed. Error: ${result.slice(0, 500)}\nTry a different approach.\n\n${taskPrompt}`;
      }

    } catch (err) {
      // Timeout or crash
      state.consecutiveFailures++;
      log('ERROR', `[ratchet] Iteration ${state.iteration} crashed: ${err}`);
      appendChangelog(projectDir, `Iteration ${state.iteration}: CRASH\n${err}`);
    }

    // 3 consecutive failures -> Telegram alert + stop
    if (shouldEscalate(state)) {
      state.status = 'escalated';
      log('WARN', '[ratchet] 3 consecutive failures — escalating to user');

      // Telegram notification
      if (config.telegram.botToken && config.telegram.defaultChatId) {
        try {
          const msg = `[SuperClaw Ratchet] 3연속 실패로 중단됨.\nTask: ${taskPrompt.slice(0, 100)}\nIteration: ${state.iteration}`;
          await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: config.telegram.defaultChatId, text: msg }),
          });
        } catch { /* best effort */ }
      }
      break;
    }

    saveRatchetState(state);
  }

  // Complete
  if (state.iteration >= MAX_ITERATIONS) {
    state.status = 'complete';
    log('INFO', `[ratchet] Max iterations reached (${MAX_ITERATIONS})`);
  }

  saveRatchetState(state);
  log('INFO', `[ratchet] Finished. Status: ${state.status}, iterations: ${state.iteration}`);
}

// ─── Main Loop ────────────────────────────────────────────────
async function main(): Promise<void> {
  // Check for autonomous mode CLI arguments
  const autonomousTask = process.argv.find(a => a.startsWith('--task='));
  const autonomousDir = process.argv.find(a => a.startsWith('--project='));

  if (autonomousTask) {
    const task = autonomousTask.split('=').slice(1).join('=');
    const dir = autonomousDir ? autonomousDir.split('=').slice(1).join('=') : process.cwd();
    await runAutonomousTask(task, dir);
    process.exit(0);
  }

  // Existing Telegram + cron logic continues below
  const config = loadDaemonConfig();

  mkdirSync(LOG_DIR, { recursive: true });
  writePidFile();
  setupShutdown();

  // Start cron scheduler — runs independently of Claude Code sessions
  cronScheduler = new CronScheduler(join(SUPERCLAW_ROOT, 'data'));
  cronScheduler.start();

  // Start transcript watcher — extracts learnings from finished Claude Code sessions
  // out-of-band from Claude Code's lifecycle (B2 architecture).
  try {
    const fullCfg = loadConfig(SUPERCLAW_ROOT);
    transcriptWatcher = new TranscriptWatcher(
      {
        enabled: fullCfg.watcher.enabled,
        idleMinutes: fullCfg.watcher.idleMinutes,
        pollIntervalSeconds: fullCfg.watcher.pollIntervalSeconds,
        maxRetries: fullCfg.watcher.maxRetries,
        batchSize: fullCfg.watcher.batchSize,
        extractionTimeoutMs: fullCfg.watcher.extractionTimeoutMs,
      },
      (level, msg) => log(level, msg)
    );
    transcriptWatcher.start();
  } catch (err) {
    log('ERROR', `transcript watcher init failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Sync pmset wake schedule from launchd plist times
  try {
    const syncScript = join(SUPERCLAW_ROOT, 'scripts', 'sc-sync-pmset.sh');
    if (existsSync(syncScript)) {
      spawn('/bin/bash', [syncScript], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {}

  log('INFO', `SuperClaw daemon started (PID ${process.pid})`);
  log('INFO', `Config: allowFrom=[${config.allowFrom.join(',')}], defaultChatId=${config.defaultChatId}`);

  while (running) {
    try {
      const updates = await getUpdates(config.botToken, offset, POLL_TIMEOUT);
      backoffMs = 1000; // Reset on success

      for (const update of updates) {
        if (update.update_id >= offset) {
          offset = update.update_id + 1;
        }

        const msg = update.message;
        if (!msg || !msg.text) continue;

        const chatId = msg.chat.id;
        const text = msg.text;
        const from = msg.from?.username ?? msg.from?.first_name ?? 'unknown';

        log('INFO', `Message from ${from} (${chatId}): "${text.slice(0, 100)}"`);

        if (!isAllowed(chatId, config.allowFrom)) {
          log('WARN', `Blocked message from unauthorized chat: ${chatId}`);
          continue;
        }

        if (text.trim().toLowerCase() === '/new') {
          // Handle /new: end current session with learning extraction, start fresh
          const oldSession = chatSessions.get(chatId);
          if (oldSession) {
            log('INFO', `Session reset requested for chat ${chatId}, running final extraction...`);
            // Spawn one final claude for the old session WITHOUT SUPERCLAW_DAEMON
            // so SessionEnd hook runs normally and extracts learnings
            await sendChatAction(config.botToken, chatId, 'typing');
            const finalArgs = [
              '-p', 'Session ending. Please save any important learnings using sc_memory_store and sc_learning_store before this session closes.',
              '--plugin-dir', SUPERCLAW_ROOT,
              '--output-format', 'json',
              '--max-turns', '5',
              '--permission-mode', 'bypassPermissions',
              '--resume', oldSession,
            ];
            const cleanEnv = { ...process.env };
            delete cleanEnv.CLAUDECODE;
            delete cleanEnv.CLAUDE_CODE;
            delete cleanEnv.CLAUDE_CODE_RUNNING;
            delete cleanEnv.CLAUDE_CODE_SESSION;
            delete cleanEnv.CLAUDE_CODE_ENTRY_POINT;
            // Do NOT set SUPERCLAW_DAEMON — this allows SessionEnd hook to run
            for (const key of Object.keys(cleanEnv)) {
              if (key.startsWith('CMUX_')) delete cleanEnv[key];
            }
            cleanEnv.CMUX_CLAUDE_HOOKS_DISABLED = '1';

            await new Promise<void>((resolve) => {
              const child = spawnChild('claude', finalArgs, {
                env: cleanEnv,
                stdio: ['ignore', 'pipe', 'pipe'],
              });
              child.on('close', () => resolve());
              child.on('error', () => resolve());
              setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 120_000);
            });

            chatSessions.delete(chatId);
            log('INFO', `Session cleared for chat ${chatId}`);
            await sendMessage(config.botToken, chatId, 'Session ended. Learnings extracted. Next message starts a new session.');
          } else {
            await sendMessage(config.botToken, chatId, 'No active session. Next message will start a new one.');
          }
        } else if (isDirectCommand(text)) {
          const reply = handleDirectCommand(text);
          log('INFO', `Direct command "${text}" → "${reply}"`);
          await sendMessage(config.botToken, chatId, reply);
          log('INFO', `Direct reply sent to ${chatId}`);
        } else {
          // Queue for Claude processing (one at a time)
          await enqueueMessage(config, chatId, text);
        }
      }
    } catch (err) {
      if (!running) break;

      log('ERROR', `Poll error: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry ────────────────────────────────────────────────────
main().catch((err) => {
  log('FATAL', `Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  removePidFile();
  process.exit(1);
});
