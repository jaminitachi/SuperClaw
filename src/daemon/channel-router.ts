import { GatewayClient } from './gateway-client.js';
import type { ACPBridge } from './acp-bridge.js';

export interface IncomingMessage {
  channel: string;
  from: string;
  text: string;
  messageId?: string;
  replyTo?: string;
}

interface Route {
  pattern: RegExp;
  handler: (msg: IncomingMessage, match: RegExpMatchArray) => Promise<string>;
}

export class ChannelRouter {
  private gateway: GatewayClient;
  private bridge: ACPBridge;
  private routes: Route[] = [];

  constructor(gateway: GatewayClient, bridge: ACPBridge) {
    this.gateway = gateway;
    this.bridge = bridge;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.routes = [
      {
        pattern: /^\/status$/i,
        handler: async () => {
          const res = await this.bridge.handleCommand({ type: 'status', payload: {} });
          return this.formatStatus(res.data);
        },
      },
      {
        pattern: /^\/screenshot(?:\s+(.+))?$/i,
        handler: async (_msg, match) => {
          const target = match[1] ?? 'screen';
          return `📸 Screenshot requested: ${target}\n(Use sc_screenshot MCP tool from Claude Code)`;
        },
      },
      {
        pattern: /^\/run\s+(.+)$/i,
        handler: async (_msg, match) => {
          const pipeline = match[1]!;
          const res = await this.bridge.handleCommand({
            type: 'run-pipeline',
            payload: { name: pipeline },
          });
          return res.success ? `Pipeline "${pipeline}" queued.` : `Error: ${res.error}`;
        },
      },
      {
        pattern: /^\/ask\s+(.+)$/i,
        handler: async (_msg, match) => {
          const question = match[1]!;
          const res = await this.bridge.handleCommand({
            type: 'ask',
            payload: { question },
          });
          return res.success ? 'Question forwarded to agent.' : `Error: ${res.error}`;
        },
      },
      {
        pattern: /^\/mac\s+(.+)$/i,
        handler: async (_msg, match) => {
          const command = match[1]!;
          return `Mac command: ${command}\n(Routed to mac-control agent)`;
        },
      },
      {
        pattern: /^\/memory\s+(.+)$/i,
        handler: async (_msg, match) => {
          const query = match[1]!;
          return `Memory query: ${query}\n(Routed to sc-memory MCP server)`;
        },
      },
    ];
  }

  async route(msg: IncomingMessage): Promise<string> {
    const text = msg.text.trim();

    for (const route of this.routes) {
      const match = text.match(route.pattern);
      if (match) {
        return route.handler(msg, match);
      }
    }

    // Default: route to agent session
    const res = await this.bridge.handleCommand({
      type: 'ask',
      payload: { question: text },
    });
    return res.success ? 'Message forwarded to agent.' : `Error: ${res.error}`;
  }

  private formatStatus(data: unknown): string {
    const d = data as Record<string, unknown>;
    const lines = [
      '--- SuperClaw Status ---',
      `Gateway: ${d.gateway}`,
    ];
    const cfg = d.config as Record<string, boolean> | undefined;
    if (cfg) {
      lines.push(`Telegram: ${cfg.telegram ? 'enabled' : 'disabled'}`);
      lines.push(`Heartbeat: ${cfg.heartbeat ? 'enabled' : 'disabled'}`);
    }
    return lines.join('\n');
  }

  setupEventListeners(): void {
    // Listen for incoming chat messages from gateway
    this.gateway.on('event:chat.message', async (payload: unknown) => {
      const p = payload as Record<string, unknown>;
      const msg: IncomingMessage = {
        channel: (p.channel as string) ?? 'unknown',
        from: (p.from as string) ?? 'unknown',
        text: (p.text as string) ?? '',
        messageId: p.messageId as string | undefined,
      };

      const response = await this.route(msg);
      await this.gateway.sendMessage(msg.channel, response);
    });
  }
}
