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

import { spawn as spawnChild } from 'child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { CronScheduler } from '../cron/scheduler.js';

// ─── Paths ────────────────────────────────────────────────────
const SUPERCLAW_ROOT = join(homedir(), 'superclaw');
const CONFIG_PATH = join(SUPERCLAW_ROOT, 'superclaw.json');
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
interface DaemonConfig {
  botToken: string;
  defaultChatId: string;
  allowFrom: string[];
}

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
function loadConfig(): DaemonConfig {
  if (!existsSync(CONFIG_PATH)) {
    log('FATAL', `Config not found: ${CONFIG_PATH}`);
    log('FATAL', 'Run "npm run setup" to configure SuperClaw first.');
    process.exit(1);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    log('FATAL', `Failed to parse config: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const tg = raw.telegram as Record<string, unknown> | undefined;
  if (!tg || !tg.botToken) {
    log('FATAL', 'telegram.botToken not set in superclaw.json');
    process.exit(1);
  }

  return {
    botToken: tg.botToken as string,
    defaultChatId: (tg.defaultChatId as string) ?? '',
    allowFrom: (tg.allowFrom as string[]) ?? [],
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
async function enqueueMessage(config: DaemonConfig, chatId: number, text: string): Promise<void> {
  messageQueue.push({ chatId, text });
  pendingCount = messageQueue.length;
  await processQueue(config);
}

async function processQueue(config: DaemonConfig): Promise<void> {
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

// ─── Main Loop ────────────────────────────────────────────────
async function main(): Promise<void> {
  const config = loadConfig();

  mkdirSync(LOG_DIR, { recursive: true });
  writePidFile();
  setupShutdown();

  // Start cron scheduler — runs independently of Claude Code sessions
  cronScheduler = new CronScheduler(join(SUPERCLAW_ROOT, 'data'));
  cronScheduler.start();

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
