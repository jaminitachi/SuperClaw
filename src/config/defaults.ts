import { SuperClawConfigSchema, type SuperClawConfig } from './schema.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), 'superclaw', 'superclaw.json');

export function loadConfig(): SuperClawConfig {
  let userConfig: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      userConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {}
  }

  return SuperClawConfigSchema.parse(userConfig);
}

export function getProjectRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT ?? join(homedir(), 'superclaw');
}

export function getDataDir(): string {
  return join(getProjectRoot(), 'data');
}
