import { join } from 'path';
import { homedir } from 'os';

// Re-export unified loadConfig from loader
export { loadConfig, resetConfigCache } from './loader.js';

export function getProjectRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT ?? join(homedir(), 'superclaw');
}

export function getDataDir(): string {
  return join(getProjectRoot(), 'data');
}
