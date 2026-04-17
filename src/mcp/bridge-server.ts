import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TelegramPoller } from '../telegram/poller.js';
import { loadConfig } from '../config/defaults.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

const config = loadConfig();

const poller = new TelegramPoller({
  botToken: config.telegram?.botToken ?? '',
  defaultChatId: config.telegram?.defaultChatId ?? '',
  allowFrom: config.telegram?.allowFrom ?? [],
});

const server = new McpServer({
  name: 'sc-bridge',
  version: '2.0.0',
});

// --- Telegram Tools ---

/**
 * Send Telegram message directly via Bot API.
 */
async function sendTelegramDirect(text: string, chatId?: string): Promise<{ ok: boolean; message_id?: number; error?: string }> {
  const botToken = config.telegram?.botToken;
  const targetChatId = chatId ?? config.telegram?.defaultChatId;
  if (!botToken || !targetChatId) {
    return { ok: false, error: 'Telegram not configured in superclaw.json (missing botToken or defaultChatId)' };
  }
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: targetChatId, text }),
  });
  const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string };
  if (data.ok) {
    return { ok: true, message_id: data.result?.message_id };
  }
  return { ok: false, error: data.description ?? 'Unknown Telegram error' };
}

server.tool(
  'sc_send_message',
  'Send a message via Telegram Bot API',
  {
    text: z.string().describe('Message text to send'),
    chatId: z.string().optional().describe('Target chat ID (defaults to configured defaultChatId)'),
  },
  async ({ text, chatId }) => {
    const result = await sendTelegramDirect(text, chatId);
    if (result.ok) {
      return { content: [{ type: 'text', text: `Telegram sent (message_id: ${result.message_id})` }] };
    }
    return { content: [{ type: 'text', text: `Telegram failed: ${result.error}` }], isError: true };
  }
);

server.tool(
  'sc_telegram_inbox',
  'Get recent incoming Telegram messages from the poller buffer',
  {
    limit: z.number().optional().describe('Max messages to return (default: 20, max: 50)'),
  },
  async ({ limit }) => {
    const messages = poller.getRecentMessages(limit ?? 20);
    if (messages.length === 0) {
      return { content: [{ type: 'text', text: 'No recent messages in buffer.' }] };
    }
    const formatted = messages.map((m) => {
      const date = new Date(m.date * 1000).toISOString().slice(0, 19).replace('T', ' ');
      return `[${date}] ${m.from} (chat:${m.chatId}): ${m.text}`;
    }).join('\n');
    return { content: [{ type: 'text', text: `${messages.length} recent message(s):\n\n${formatted}` }] };
  }
);

server.tool(
  'sc_telegram_status',
  'Check Telegram bot connection and poller status',
  {},
  async () => {
    const botToken = config.telegram?.botToken;
    const hasToken = Boolean(botToken);
    const isPolling = poller.isRunning();
    let botInfo = 'unknown';

    if (hasToken) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const data = (await res.json()) as { ok: boolean; result?: { username?: string; first_name?: string } };
        if (data.ok && data.result) {
          botInfo = `@${data.result.username ?? data.result.first_name ?? 'unknown'}`;
        }
      } catch (err) {
        console.error('[superclaw]', err instanceof Error ? err.message : err);
        botInfo = 'unreachable';
      }
    }

    const lines = [
      '--- Telegram Status ---',
      `Bot token configured: ${hasToken ? 'yes' : 'no'}`,
      `Bot identity: ${botInfo}`,
      `Poller running: ${isPolling ? 'yes' : 'no'}`,
      `Default chat ID: ${config.telegram?.defaultChatId || 'not set'}`,
      `Allow-from filter: ${config.telegram?.allowFrom?.length ? config.telegram.allowFrom.join(', ') : 'none (all allowed)'}`,
      `Buffered messages: ${poller.getRecentMessages(50).length}`,
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

server.tool(
  'sc_route_command',
  'Process a command string through the internal SuperClaw router',
  {
    text: z.string().describe('Command text (e.g., /status, /screenshot, /run morning-brief)'),
  },
  async ({ text }) => {
    const response = poller.routeCommand(text);
    return { content: [{ type: 'text', text: response }] };
  }
);

server.tool(
  'sc_status',
  'SuperClaw system status: Telegram, Memory DB, Peekaboo availability',
  {},
  async () => {
    // Telegram status
    const botToken = config.telegram?.botToken;
    let telegramOk = false;
    if (botToken) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const data = (await res.json()) as { ok: boolean };
        telegramOk = data.ok;
      } catch (err) {
        console.error('[superclaw]', err instanceof Error ? err.message : err);
        telegramOk = false;
      }
    }

    // Memory DB
    const memoryDbPath = join(homedir(), 'superclaw', 'data', 'memory.db');
    const memoryDbExists = existsSync(memoryDbPath);

    // Peekaboo
    const peekabooPath = config.peekaboo?.path ?? '/opt/homebrew/bin/peekaboo';
    const peekabooExists = existsSync(peekabooPath);

    const lines = [
      '--- SuperClaw Status ---',
      `Telegram: ${telegramOk ? 'connected' : 'disconnected'}`,
      `Telegram poller: ${poller.isRunning() ? 'running' : 'stopped'}`,
      `Memory DB: ${memoryDbExists ? 'exists' : 'not found'} (${memoryDbPath})`,
      `Peekaboo: ${peekabooExists ? 'available' : 'not found'} (${peekabooPath})`,
      `Heartbeat: ${config.heartbeat?.enabled ? 'enabled' : 'disabled'}`,
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// --- Cron Tools ---
// Cron scheduler runs in sc-daemon process. Bridge reads/writes cron-jobs.json directly.

interface CronJobEntry {
  name: string;
  schedule: string;
  command: string;
  requiresIdle: boolean;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
}

const CRON_JOBS_PATH = join(homedir(), 'superclaw', 'data', 'cron-jobs.json');

function loadCronJobs(): CronJobEntry[] {
  try {
    if (existsSync(CRON_JOBS_PATH)) {
      return JSON.parse(readFileSync(CRON_JOBS_PATH, 'utf-8'));
    }
  } catch (err) { console.error('[superclaw]', err instanceof Error ? err.message : err); }
  return [];
}

function saveCronJobs(jobs: CronJobEntry[]): void {
  writeFileSync(CRON_JOBS_PATH, JSON.stringify(jobs, null, 2));
}

server.tool(
  'sc_cron_list',
  'List all scheduled cron jobs',
  {},
  async () => {
    const jobs = loadCronJobs();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(jobs, null, 2),
      }],
    };
  }
);

server.tool(
  'sc_cron_add',
  'Add a new cron job',
  {
    name: z.string().describe('Unique name for the cron job'),
    schedule: z.string().describe('Cron expression (5-field): "minute hour day-of-month month day-of-week"'),
    command: z.string().describe('Shell command or "pipeline:<name>" to run'),
    requiresIdle: z.boolean().optional().default(false).describe('If true, skip execution when user is actively using the Mac (idle < 2min)'),
  },
  async ({ name, schedule, command, requiresIdle }) => {
    try {
      const jobs = loadCronJobs();
      if (jobs.some((j) => j.name === name)) {
        return { content: [{ type: 'text', text: `Cron job "${name}" already exists.` }], isError: true };
      }
      const job = { name, schedule, command, requiresIdle: requiresIdle ?? false, enabled: true, lastRun: null, nextRun: null };
      jobs.push(job);
      saveCronJobs(jobs);
      return { content: [{ type: 'text', text: `Cron job "${name}" added. Daemon will pick it up on next tick.\n${JSON.stringify(job, null, 2)}` }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Failed to add cron job: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'sc_cron_remove',
  'Remove a cron job by name',
  {
    name: z.string().describe('Name of the cron job to remove'),
  },
  async ({ name }) => {
    const jobs = loadCronJobs();
    const idx = jobs.findIndex((j) => j.name === name);
    if (idx >= 0) {
      jobs.splice(idx, 1);
      saveCronJobs(jobs);
      return { content: [{ type: 'text', text: `Cron job "${name}" removed.` }] };
    }
    return { content: [{ type: 'text', text: `Cron job "${name}" not found.` }], isError: true };
  }
);

// --- OMO (Orchestrated Multi-Model Operations) Tools ---

function hasCodexCLI(): boolean {
  try {
    execFileSync('codex', ['--version'], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch (err) {
    console.error('[superclaw]', err instanceof Error ? err.message : err);
    return false;
  }
}

function hasGeminiCLI(): boolean {
  try {
    execFileSync('gemini', ['--version'], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch (err) {
    console.error('[superclaw]', err instanceof Error ? err.message : err);
    return false;
  }
}

function buildSystemContext(): string {
  const parts: string[] = [];
  const claudeMdPath = join(process.cwd(), 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    try {
      const content = readFileSync(claudeMdPath, 'utf-8').slice(0, 2000);
      parts.push('## Project Context (CLAUDE.md)\n' + content);
    } catch (err) {
      console.error('[superclaw]', err instanceof Error ? err.message : err);
    }
  }
  parts.push('## Rules\nOnly modify files assigned to you. Report to PO if you need more files.');
  return parts.join('\n\n');
}

function callCodex(prompt: string, sandbox: string = 'workspace-write', model?: string): string {
  const systemCtx = buildSystemContext();
  const fullPrompt = systemCtx + '\n\n---\n\n' + prompt;
  const args = ['exec', '-s', sandbox];
  if (model) args.push('-m', model);
  args.push(fullPrompt);

  const output = execFileSync('codex', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env },
  });
  return output.toString().trim();
}

function callGemini(prompt: string): string {
  const systemCtx = buildSystemContext();
  const fullPrompt = systemCtx + '\n\n---\n\n' + prompt;
  const output = execFileSync('gemini', ['-p', fullPrompt, '-y'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GOOGLE_GENAI_USE_GCA: 'true' },
  });
  return output.toString().trim();
}

server.tool(
  'sc_ask_codex',
  'Send a prompt to OpenAI Codex agent (GPT) via codex exec CLI. Uses ChatGPT OAuth — no API key needed. Full coding agent with file R/W.',
  {
    prompt: z.string().describe('Task prompt for the Codex agent'),
    sandbox: z.string().optional().default('workspace-write').describe('Sandbox mode: workspace-read, workspace-write, or full-auto'),
    model: z.string().optional().describe('Model override (e.g., gpt-5.4). Defaults to codex default.'),
  },
  async ({ prompt, sandbox, model }) => {
    if (!hasCodexCLI()) {
      return { content: [{ type: 'text', text: 'codex CLI not installed. Install: npm i -g @openai/codex' }], isError: true };
    }
    try {
      const result = callCodex(prompt, sandbox ?? 'workspace-write', model);
      return { content: [{ type: 'text', text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `codex exec failed: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'sc_ask_gemini',
  'Send a prompt to Google Gemini agent via gemini CLI. Uses Google OAuth — no API key needed. Full coding agent with file R/W.',
  {
    prompt: z.string().describe('Task prompt for the Gemini agent'),
  },
  async ({ prompt }) => {
    if (!hasGeminiCLI()) {
      return { content: [{ type: 'text', text: 'gemini CLI not installed. Install: npm i -g @google/gemini-cli' }], isError: true };
    }
    try {
      const result = callGemini(prompt);
      return { content: [{ type: 'text', text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `gemini -p failed: ${msg}` }], isError: true };
    }
  }
);

const CATEGORY_ROUTING: Record<string, { provider: string; fallbackModel: string }> = {
  ultrabrain: { provider: 'codex', fallbackModel: 'opus' },
  deep: { provider: 'codex', fallbackModel: 'opus' },
  'visual-engineering': { provider: 'gemini', fallbackModel: 'sonnet' },
  artistry: { provider: 'gemini', fallbackModel: 'sonnet' },
  writing: { provider: 'gemini', fallbackModel: 'haiku' },
  quick: { provider: 'claude', fallbackModel: 'haiku' },
  standard: { provider: 'claude', fallbackModel: 'sonnet' },
};

server.tool(
  'sc_omo_dispatch',
  'Auto-route a task to the best provider by category. Routes ultrabrain/deep→Codex, visual/artistry/writing→Gemini, quick/standard→Claude. Falls back to Claude if external CLI unavailable.',
  {
    category: z.string().describe('Task category: ultrabrain, deep, visual-engineering, artistry, writing, quick, standard'),
    prompt: z.string().describe('Task prompt'),
    codexModel: z.string().optional().describe('Codex model override (e.g., gpt-5.4)'),
    codexSandbox: z.string().optional().default('workspace-write').describe('Codex sandbox mode'),
  },
  async ({ category, prompt, codexModel, codexSandbox }) => {
    const route = CATEGORY_ROUTING[category];
    if (!route) {
      return { content: [{ type: 'text', text: `Unknown category "${category}". Use: ${Object.keys(CATEGORY_ROUTING).join(', ')}` }], isError: true };
    }

    // Try primary provider
    if (route.provider === 'codex' && hasCodexCLI()) {
      try {
        const result = callCodex(prompt, codexSandbox ?? 'workspace-write', codexModel);
        return { content: [{ type: 'text', text: `[OMO:codex] ${result}` }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `[OMO:codex→fallback] Codex failed (${msg}). Use Claude ${route.fallbackModel} as fallback.` }], isError: true };
      }
    }

    if (route.provider === 'gemini' && hasGeminiCLI()) {
      try {
        const result = callGemini(prompt);
        return { content: [{ type: 'text', text: `[OMO:gemini] ${result}` }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `[OMO:gemini→fallback] Gemini failed (${msg}). Use Claude ${route.fallbackModel} as fallback.` }], isError: true };
      }
    }

    // Claude or fallback
    return { content: [{ type: 'text', text: `[OMO:claude:${route.fallbackModel}] Route to Claude (${route.fallbackModel}). Provider "${route.provider}" CLI not available.` }] };
  }
);

// --- Smart Interaction Router ---
// Browser tasks → Playwright MCP (DOM-based, precise)
// Desktop app tasks → Peekaboo screenshot + coordinate click

const BROWSER_KEYWORDS = [
  'browser', 'chrome', 'safari', 'firefox', 'edge', 'arc', 'brave',
  'http', 'https', 'url', 'www', 'website', 'webpage', 'web page', 'web site',
  'google', 'gmail', 'youtube', 'twitter', 'github', 'slack.com',
  '검색', '웹', '브라우저', '크롬', '사파리', '로그인', '회원가입',
  '탭', 'tab', 'bookmark', '즐겨찾기',
];

const DESKTOP_KEYWORDS = [
  'finder', 'terminal', 'iterm', 'vscode', 'code', 'xcode',
  'notes', 'messages', 'kakao', 'kakaotalk', 'discord',
  'system preferences', 'settings', 'spotlight',
  'dock', 'menu bar', 'notification',
  '파인더', '터미널', '설정', '메모', '카카오', '독',
];

function classifyInteractionTarget(task: string): 'browser' | 'desktop' | 'unknown' {
  const lower = task.toLowerCase();

  // URL pattern is a strong browser signal
  if (/https?:\/\/|www\./.test(lower)) return 'browser';

  const browserScore = BROWSER_KEYWORDS.filter(k => lower.includes(k)).length;
  const desktopScore = DESKTOP_KEYWORDS.filter(k => lower.includes(k)).length;

  if (browserScore > desktopScore) return 'browser';
  if (desktopScore > browserScore) return 'desktop';
  if (browserScore > 0) return 'browser';
  return 'unknown';
}

server.tool(
  'sc_interact',
  'Smart UI interaction router. Automatically picks the best method: Playwright (browser/web) or Peekaboo+coordinates (desktop apps). Call this FIRST before any UI automation to get the right approach.',
  {
    task: z.string().describe('What you want to do (e.g., "구글에서 Claude 검색", "Finder에서 파일 이동", "Settings에서 WiFi 끄기")'),
    target: z.string().optional().describe('Explicit target: "browser", "desktop", or app name'),
  },
  async ({ task, target }) => {
    let method: 'browser' | 'desktop' | 'unknown';

    if (target) {
      const t = target.toLowerCase();
      if (['browser', 'web', 'chrome', 'safari', 'firefox', 'arc', 'brave', 'edge'].includes(t)) {
        method = 'browser';
      } else if (t === 'desktop' || DESKTOP_KEYWORDS.some(k => t.includes(k))) {
        method = 'desktop';
      } else {
        method = classifyInteractionTarget(task + ' ' + target);
      }
    } else {
      method = classifyInteractionTarget(task);
    }

    if (method === 'browser') {
      return {
        content: [{
          type: 'text',
          text: [
            '[ROUTE:playwright] Use Playwright MCP tools for this browser task.',
            '',
            'Steps:',
            '1. mcp__playwright__browser_navigate(url) — go to page',
            '2. mcp__playwright__browser_snapshot() — get DOM accessibility tree with ref IDs',
            '3. mcp__playwright__browser_click(ref="<id>") — click element by ref',
            '4. mcp__playwright__browser_fill_form(fields=[...]) — fill inputs by ref',
            '5. mcp__playwright__browser_type(ref, text) — type into element',
            '',
            'NEVER use osascript/AppleScript/coordinate clicking for browser tasks.',
            'NEVER use sc_click/sc_screenshot for web pages.',
            'Playwright refs come from browser_snapshot — use those.',
            '',
            `Task: ${task}`,
          ].join('\n'),
        }],
      };
    }

    if (method === 'desktop') {
      return {
        content: [{
          type: 'text',
          text: [
            '[ROUTE:peekaboo] Use Peekaboo MCP tools for this desktop app task.',
            '',
            'Steps:',
            '1. sc_screenshot(window="<app>") — capture the app window',
            '2. sc_see(app="<app>") — get UI elements with IDs and coordinates',
            '3. sc_click(element="<id>") or sc_click(x=N, y=N) — click element',
            '4. sc_type(text="...") — type text at cursor',
            '5. sc_hotkey(keys="cmd+c") — keyboard shortcut',
            '',
            'For precise element targeting, prefer sc_see + element ID over raw coordinates.',
            'If sc_see fails, use sc_screenshot + visual analysis + sc_click(x,y).',
            '',
            `Task: ${task}`,
          ].join('\n'),
        }],
      };
    }

    // Unknown — provide both options
    return {
      content: [{
        type: 'text',
        text: [
          '[ROUTE:auto] Could not determine target type. Choose based on context:',
          '',
          'If browser/web → use Playwright: browser_navigate, browser_snapshot, browser_click(ref)',
          'If desktop app → use Peekaboo: sc_screenshot, sc_see, sc_click, sc_type',
          '',
          'RULE: NEVER use osascript to control browsers. Use Playwright instead.',
          '',
          `Task: ${task}`,
        ].join('\n'),
      }],
    };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // NOTE: Telegram polling is handled by sc-daemon, NOT here.
  // The MCP bridge only exposes send/inbox/status tools — it does NOT poll.
  // NOTE: Cron scheduling is handled by sc-daemon only — NOT here.
  // Running it in both caused race conditions where multiple instances
  // overwrote each other's lastRun timestamps in cron-jobs.json.

  // Graceful shutdown when parent (Claude Code) disconnects
  process.stdin.on('end', () => {
    process.exit(0);
  });
  process.stdin.resume();
}

main().catch((err) => {
  console.error('sc-bridge fatal:', err);
  process.exit(1);
});
