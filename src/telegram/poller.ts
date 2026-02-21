export interface TelegramMessage {
  updateId: number;
  messageId: number;
  chatId: number;
  from: string;
  text: string;
  date: number;
}

interface TelegramPollerConfig {
  botToken: string;
  defaultChatId: string;
  allowFrom: string[];
}

type MessageHandler = (msg: TelegramMessage) => void;

interface CommandRoute {
  pattern: RegExp;
  handler: (msg: TelegramMessage, match: RegExpMatchArray) => string;
}

export class TelegramPoller {
  private config: TelegramPollerConfig;
  private running = false;
  private offset = 0;
  private buffer: TelegramMessage[] = [];
  private handlers: MessageHandler[] = [];
  private abortController: AbortController | null = null;
  private backoffMs = 1000;
  private static readonly MAX_BUFFER = 50;
  private static readonly POLL_TIMEOUT = 30;
  private static readonly MAX_BACKOFF = 30000;
  private static readonly BASE_URL = 'https://api.telegram.org/bot';
  private routes: CommandRoute[];

  constructor(config: TelegramPollerConfig) {
    this.config = config;
    this.routes = this.buildRoutes();
  }

  private buildRoutes(): CommandRoute[] {
    return [
      {
        pattern: /^\/status$/i,
        handler: () => '--- SuperClaw Status ---\nUse sc_status MCP tool for full system status.',
      },
      {
        pattern: /^\/screenshot(?:\s+(.+))?$/i,
        handler: (_msg, match) => {
          const target = match[1] ?? 'screen';
          return `Screenshot requested: ${target}\n(Use sc_screenshot MCP tool from Claude Code)`;
        },
      },
      {
        pattern: /^\/run\s+(.+)$/i,
        handler: (_msg, match) => {
          const pipeline = match[1]!;
          return `Pipeline "${pipeline}" queued for execution.`;
        },
      },
      {
        pattern: /^\/ask\s+(.+)$/i,
        handler: (_msg, match) => {
          const question = match[1]!;
          return `Question received: ${question}\n(Forwarded to agent)`;
        },
      },
      {
        pattern: /^\/mac\s+(.+)$/i,
        handler: (_msg, match) => {
          const command = match[1]!;
          return `Mac command: ${command}\n(Use mac-control MCP tools from Claude Code)`;
        },
      },
      {
        pattern: /^\/memory\s+(.+)$/i,
        handler: (_msg, match) => {
          const query = match[1]!;
          return `Memory query: ${query}\n(Use sc_memory_search MCP tool)`;
        },
      },
    ];
  }

  routeCommand(text: string, msg?: TelegramMessage): string {
    const trimmed = text.trim();
    const dummyMsg: TelegramMessage = msg ?? {
      updateId: 0,
      messageId: 0,
      chatId: Number(this.config.defaultChatId) || 0,
      from: 'internal',
      text: trimmed,
      date: Math.floor(Date.now() / 1000),
    };

    for (const route of this.routes) {
      const match = trimmed.match(route.pattern);
      if (match) {
        return route.handler(dummyMsg, match);
      }
    }

    return `Received: ${trimmed}\n(No matching command. Available: /status, /screenshot, /run, /ask, /mac, /memory)`;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.backoffMs = 1000;
    this.pollLoop();
  }

  stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  getRecentMessages(limit = 20): TelegramMessage[] {
    const n = Math.min(limit, this.buffer.length);
    return this.buffer.slice(-n);
  }

  async sendMessage(text: string, chatId?: string): Promise<boolean> {
    const targetChatId = chatId ?? this.config.defaultChatId;
    if (!this.config.botToken || !targetChatId) return false;

    const url = `${TelegramPoller.BASE_URL}${this.config.botToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text }),
      });
      const data = (await res.json()) as { ok: boolean };
      return data.ok;
    } catch {
      return false;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  isRunning(): boolean {
    return this.running;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.fetchUpdates();
        this.backoffMs = 1000; // reset on success

        for (const msg of messages) {
          // Filter by allowFrom if configured
          if (
            this.config.allowFrom.length > 0 &&
            !this.config.allowFrom.includes(String(msg.chatId))
          ) {
            continue;
          }

          this.bufferMessage(msg);

          // Notify handlers
          for (const handler of this.handlers) {
            try {
              handler(msg);
            } catch {
              // Handler errors should not break the poll loop
            }
          }

          // Auto-reply to commands
          const reply = this.routeCommand(msg.text, msg);
          if (reply) {
            await this.sendMessage(reply, String(msg.chatId));
          }
        }
      } catch (err) {
        if (!this.running) break; // aborted intentionally
        // Backoff on error
        await this.sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, TelegramPoller.MAX_BACKOFF);
      }
    }
  }

  private async fetchUpdates(): Promise<TelegramMessage[]> {
    this.abortController = new AbortController();
    const params = new URLSearchParams({
      offset: String(this.offset),
      timeout: String(TelegramPoller.POLL_TIMEOUT),
      allowed_updates: JSON.stringify(['message']),
    });

    const url = `${TelegramPoller.BASE_URL}${this.config.botToken}/getUpdates?${params}`;

    const res = await fetch(url, {
      signal: this.abortController.signal,
    });

    const data = (await res.json()) as {
      ok: boolean;
      result?: Array<{
        update_id: number;
        message?: {
          message_id: number;
          chat: { id: number };
          from?: { first_name?: string; username?: string };
          text?: string;
          date: number;
        };
      }>;
    };

    if (!data.ok || !data.result) return [];

    const messages: TelegramMessage[] = [];
    for (const update of data.result) {
      if (update.update_id >= this.offset) {
        this.offset = update.update_id + 1;
      }

      const m = update.message;
      const msgText = m?.text;
      if (m && msgText) {
        messages.push({
          updateId: update.update_id,
          messageId: m.message_id,
          chatId: m.chat.id,
          from: m.from?.username ?? m.from?.first_name ?? 'unknown',
          text: msgText,
          date: m.date,
        });
      }
    }

    return messages;
  }

  private bufferMessage(msg: TelegramMessage): void {
    this.buffer.push(msg);
    if (this.buffer.length > TelegramPoller.MAX_BUFFER) {
      this.buffer = this.buffer.slice(-TelegramPoller.MAX_BUFFER);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
