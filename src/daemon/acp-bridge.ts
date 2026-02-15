import { GatewayClient } from './gateway-client.js';
import type { SuperClawConfig } from '../config/schema.js';

export interface ACPCommand {
  type: 'send' | 'screenshot' | 'status' | 'run-pipeline' | 'ask' | 'mac' | 'memory';
  channel?: string;
  payload: Record<string, unknown>;
}

export interface ACPResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export class ACPBridge {
  private gateway: GatewayClient;
  private config: SuperClawConfig;

  constructor(gateway: GatewayClient, config: SuperClawConfig) {
    this.gateway = gateway;
    this.config = config;
  }

  async handleCommand(cmd: ACPCommand): Promise<ACPResponse> {
    try {
      switch (cmd.type) {
        case 'send':
          return await this.handleSend(cmd);
        case 'status':
          return await this.handleStatus();
        case 'screenshot':
          return { success: true, data: { hint: 'Use sc-peekaboo MCP server for screenshots' } };
        case 'run-pipeline':
          return await this.handleRunPipeline(cmd);
        case 'ask':
          return await this.handleAsk(cmd);
        default:
          return { success: false, error: `Unknown command type: ${cmd.type}` };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async handleSend(cmd: ACPCommand): Promise<ACPResponse> {
    const { channel, text } = cmd.payload as { channel?: string; text: string };
    const target = channel ?? 'telegram';
    const result = await this.gateway.sendMessage(target, text);
    return { success: true, data: result };
  }

  private async handleStatus(): Promise<ACPResponse> {
    const connected = this.gateway.isConnected();
    let sessions: unknown = null;
    if (connected) {
      try {
        sessions = await this.gateway.listSessions();
      } catch {}
    }
    return {
      success: true,
      data: {
        gateway: connected ? 'connected' : 'disconnected',
        sessions,
        config: {
          telegram: this.config.telegram.enabled,
          heartbeat: this.config.heartbeat.enabled,
        },
      },
    };
  }

  private async handleRunPipeline(cmd: ACPCommand): Promise<ACPResponse> {
    const { name } = cmd.payload as { name: string };
    // Pipeline execution will be implemented in Phase 6
    return { success: true, data: { pipeline: name, status: 'queued' } };
  }

  private async handleAsk(cmd: ACPCommand): Promise<ACPResponse> {
    const { question } = cmd.payload as { question: string };
    const result = await this.gateway.spawnSession(
      `superclaw-ask-${Date.now()}`,
      question
    );
    return { success: true, data: result };
  }
}
