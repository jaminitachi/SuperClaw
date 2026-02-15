import { SuperClawConfigSchema, type SuperClawConfig } from './schema.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), 'superclaw', 'superclaw.json');
const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

export function loadConfig(): SuperClawConfig {
  let gatewayToken = '';
  if (existsSync(OPENCLAW_CONFIG_PATH)) {
    try {
      const oc = JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'));
      gatewayToken = oc?.gateway?.auth?.token ?? '';
    } catch {}
  }

  let userConfig: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      userConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {}
  }

  const raw = {
    gateway: { token: gatewayToken, ...((userConfig.gateway as any) ?? {}) },
    ...userConfig,
  };

  return SuperClawConfigSchema.parse(raw);
}

export function getProjectRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT ?? join(homedir(), 'superclaw');
}

export function getDataDir(): string {
  return join(getProjectRoot(), 'data');
}
