import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { GatewayConfig } from '../config/schema.js';

export interface GatewayFrame {
  type: 'req' | 'res' | 'event';
  id?: string;
  method?: string;
  params?: unknown;
  ok?: boolean;
  payload?: unknown;
  error?: { code: number; message: string };
  event?: string;
  seq?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: GatewayConfig;
  private requestId = 0;
  private pending = new Map<string, PendingRequest>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private backoffMs = 1000;
  private reconnectAttempts = 0;
  private static readonly MAX_BACKOFF = 30000;
  private static readonly CONNECTION_TIMEOUT = 10000;

  constructor(config: GatewayConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Gateway connection timed out after ${GatewayClient.CONNECTION_TIMEOUT}ms`));
      }, GatewayClient.CONNECTION_TIMEOUT);

      const ws = new WebSocket(this.config.url);
      this.ws = ws;

      ws.on('open', () => {
        const connectParams = {
          minProtocol: 1,
          maxProtocol: 1,
          client: {
            id: 'superclaw',
            displayName: 'SuperClaw Bridge',
            version: '1.0.0',
            platform: 'darwin',
            mode: 'backend',
          },
          auth: { token: this.config.token },
          caps: ['messaging', 'events'],
          role: 'bridge',
        };
        ws.send(JSON.stringify(connectParams));
      });

      ws.on('message', (data) => {
        try {
          const frame: GatewayFrame = JSON.parse(data.toString());
          this.handleFrame(frame);

          if (!this.connected && frame.type === 'res' && frame.ok) {
            clearTimeout(connectionTimeout);
            this.connected = true;
            this.backoffMs = 1000;
            this.reconnectAttempts = 0;
            resolve();
          }
        } catch (err) {
          this.emit('error', err);
        }
      });

      ws.on('close', () => {
        clearTimeout(connectionTimeout);
        this.connected = false;
        this.emit('disconnected');
        this.scheduleReconnect();
      });

      ws.on('error', (err) => {
        clearTimeout(connectionTimeout);
        if (!this.connected) reject(err);
        this.emit('error', err);
      });
    });
  }

  private handleFrame(frame: GatewayFrame): void {
    if (frame.type === 'event') {
      this.emit('event', frame);
      this.emit(`event:${frame.event}`, frame.payload);
      return;
    }

    if (frame.type === 'res' && frame.id) {
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        clearTimeout(pending.timer);
        if (frame.ok) {
          pending.resolve(frame.payload);
        } else {
          pending.reject(new Error(frame.error?.message ?? 'Request failed'));
        }
      }
      return;
    }
  }

  async request(method: string, params?: unknown, timeoutMs = 30000): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to gateway');
    }

    const id = `sc-${++this.requestId}`;
    const frame: GatewayFrame = { type: 'req', id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  async sendMessage(channel: string, text: string): Promise<unknown> {
    return this.request('send', { channel, text });
  }

  async listSessions(): Promise<unknown> {
    return this.request('sessions.list', { limit: 50 });
  }

  async spawnSession(label: string, task: string, model?: string): Promise<unknown> {
    return this.request('sessions.spawn', {
      agentId: 'main',
      label,
      task,
      model: model ?? 'anthropic/claude-sonnet-4-5',
    });
  }

  async getConfig(): Promise<unknown> {
    return this.request('config.get', {});
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, GatewayClient.MAX_BACKOFF);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        this.emit('reconnected');
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error('Client disconnected'));
    });
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
