import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TelegramPoller } from '../telegram/poller.js';
import { loadConfig } from '../config/defaults.js';
import { CronScheduler } from '../cron/scheduler.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const config = loadConfig();

const poller = new TelegramPoller({
  botToken: config.telegram?.botToken ?? '',
  defaultChatId: config.telegram?.defaultChatId ?? '',
  allowFrom: config.telegram?.allowFrom ?? [],
});

const cronScheduler = new CronScheduler(join(homedir(), 'superclaw', 'data'));

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
      } catch {
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
      } catch {
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

server.tool(
  'sc_cron_list',
  'List all scheduled cron jobs',
  {},
  async () => {
    const jobs = cronScheduler.listJobs();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(jobs.map((j) => ({
          name: j.name,
          schedule: j.schedule,
          command: j.command,
          enabled: j.enabled,
          lastRun: j.lastRun ?? null,
          nextRun: j.nextRun ?? null,
        })), null, 2),
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
  },
  async ({ name, schedule, command }) => {
    try {
      const job = cronScheduler.addJob(name, schedule, command);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(job, null, 2),
        }],
      };
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
    const removed = cronScheduler.removeJob(name);
    if (removed) {
      return { content: [{ type: 'text', text: `Cron job "${name}" removed.` }] };
    }
    return { content: [{ type: 'text', text: `Cron job "${name}" not found.` }], isError: true };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // NOTE: Telegram polling is handled by sc-daemon, NOT here.
  // The MCP bridge only exposes send/inbox/status tools — it does NOT poll.

  // Start cron scheduler
  cronScheduler.start();
}

main().catch((err) => {
  console.error('sc-bridge fatal:', err);
  process.exit(1);
});
