import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GatewayClient } from '../daemon/gateway-client.js';
import { ACPBridge } from '../daemon/acp-bridge.js';
import { ChannelRouter } from '../daemon/channel-router.js';
import { loadConfig } from '../config/defaults.js';

const config = loadConfig();
const gateway = new GatewayClient(config.gateway);
const bridge = new ACPBridge(gateway, config);
const router = new ChannelRouter(gateway, bridge);

let gatewayConnected = false;

async function ensureConnected(): Promise<void> {
  if (!gatewayConnected) {
    try {
      await gateway.connect();
      router.setupEventListeners();
      gatewayConnected = true;
    } catch (err) {
      // Gateway may not be running, tools still work but warn
    }
  }
}

const server = new McpServer({
  name: 'sc-bridge',
  version: '1.0.0',
});

// --- Gateway Tools ---

server.tool(
  'sc_gateway_status',
  'Get the current status of the OpenClaw gateway connection and SuperClaw subsystems',
  {},
  async () => {
    await ensureConnected();
    const res = await bridge.handleCommand({ type: 'status', payload: {} });
    return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
  }
);

server.tool(
  'sc_gateway_request',
  'Send a raw JSON-RPC request to the OpenClaw gateway',
  {
    method: z.string().describe('Gateway RPC method name (e.g., sessions.list, config.get)'),
    params: z.record(z.unknown()).optional().describe('Request parameters'),
  },
  async ({ method, params }) => {
    await ensureConnected();
    try {
      const result = await gateway.request(method, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// --- Telegram/Messaging Tools ---

/**
 * Send Telegram message directly via Bot API (no OpenClaw dependency).
 */
async function sendTelegramDirect(text: string): Promise<{ ok: boolean; message_id?: number; error?: string }> {
  const botToken = config.telegram?.botToken;
  const chatId = config.telegram?.defaultChatId;
  if (!botToken || !chatId) {
    return { ok: false, error: 'Telegram not configured in superclaw.json (missing botToken or defaultChatId)' };
  }
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string };
  if (data.ok) {
    return { ok: true, message_id: data.result?.message_id };
  }
  return { ok: false, error: data.description ?? 'Unknown Telegram error' };
}

server.tool(
  'sc_send_message',
  'Send a message to Telegram (direct) or other channels via OpenClaw gateway',
  {
    channel: z.string().default('telegram').describe('Target channel (telegram, discord)'),
    text: z.string().describe('Message text to send'),
  },
  async ({ channel, text }) => {
    // Telegram: send directly via Bot API (no OpenClaw needed)
    if (channel === 'telegram') {
      const result = await sendTelegramDirect(text);
      if (result.ok) {
        return { content: [{ type: 'text', text: `Telegram sent (message_id: ${result.message_id})` }] };
      }
      return { content: [{ type: 'text', text: `Telegram failed: ${result.error}` }], isError: true };
    }

    // Other channels: route through OpenClaw gateway
    await ensureConnected();
    try {
      const result = await gateway.sendMessage(channel, text);
      return { content: [{ type: 'text', text: `Message sent to ${channel}: ${JSON.stringify(result)}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Send failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

server.tool(
  'sc_route_command',
  'Route a command string through the SuperClaw channel router (simulates incoming message)',
  {
    text: z.string().describe('Command text (e.g., /status, /screenshot, /run morning-brief)'),
    channel: z.string().default('claude-code').describe('Source channel'),
  },
  async ({ text, channel }) => {
    await ensureConnected();
    const response = await router.route({ channel, from: 'claude-code', text });
    return { content: [{ type: 'text', text: response }] };
  }
);

// --- Session Tools ---

server.tool(
  'sc_sessions_list',
  'List active OpenClaw agent sessions',
  {},
  async () => {
    await ensureConnected();
    try {
      const result = await gateway.listSessions();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

server.tool(
  'sc_session_spawn',
  'Spawn a new OpenClaw agent session with a task',
  {
    label: z.string().describe('Session label/identifier'),
    task: z.string().describe('Task description for the agent'),
    model: z.string().optional().describe('Model to use (default: anthropic/claude-sonnet-4-5)'),
  },
  async ({ label, task, model }) => {
    await ensureConnected();
    try {
      const result = await gateway.spawnSession(label, task, model);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Spawn failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// --- Cron Tools (Phase 2 stub) ---

server.tool(
  'sc_cron_list',
  'List scheduled cron jobs from OpenClaw',
  {},
  async () => {
    await ensureConnected();
    try {
      const result = await gateway.request('cron.list', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Cron list failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

server.tool(
  'sc_cron_add',
  'Add a new cron job to OpenClaw',
  {
    name: z.string().describe('Job name'),
    schedule: z.string().describe('Cron expression (e.g., "0 8 * * 1-5")'),
    command: z.string().describe('Command or pipeline to run'),
  },
  async ({ name, schedule, command }) => {
    await ensureConnected();
    try {
      const result = await gateway.request('cron.add', { name, schedule, command });
      return { content: [{ type: 'text', text: `Cron job "${name}" added: ${JSON.stringify(result)}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Cron add failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Attempt gateway connection in background
  ensureConnected().catch(() => {});
}

main().catch((err) => {
  console.error('sc-bridge fatal:', err);
  process.exit(1);
});
