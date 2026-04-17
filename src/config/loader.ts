import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { SuperClawConfigSchema, type SuperClawConfig } from './schema.js';

let cachedConfig: SuperClawConfig | null = null;

/**
 * Load and validate superclaw.json using the Zod schema from schema.ts.
 * Returns cached config on subsequent calls (use resetConfigCache() to clear).
 *
 * Resolution order for config path:
 *   1. Explicit rootDir parameter
 *   2. CLAUDE_PLUGIN_ROOT env var
 *   3. ~/superclaw (default)
 *
 * Environment variable overrides:
 *   - SC_TELEGRAM_TOKEN → telegram.botToken
 */
export function loadConfig(rootDir?: string): SuperClawConfig {
  if (cachedConfig) return cachedConfig;

  const root = rootDir ?? process.env.CLAUDE_PLUGIN_ROOT ?? join(homedir(), 'superclaw');
  const configPath = join(root, 'superclaw.json');

  let raw: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (err) { console.error('[superclaw]', err instanceof Error ? err.message : err); }
  }

  // Environment variable overrides
  if (process.env.SC_TELEGRAM_TOKEN) {
    if (!raw.telegram) raw.telegram = {};
    (raw.telegram as Record<string, unknown>).botToken = process.env.SC_TELEGRAM_TOKEN;
  }

  cachedConfig = SuperClawConfigSchema.parse(raw);
  return cachedConfig;
}

/** Clear the cached config (useful for tests or config reload). */
export function resetConfigCache(): void {
  cachedConfig = null;
}
