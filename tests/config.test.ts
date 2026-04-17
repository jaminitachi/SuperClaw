import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, resetConfigCache } from '../src/config/loader.js';

describe('loadConfig', () => {
  afterEach(() => {
    resetConfigCache();
  });

  it('returns default config when no file exists', () => {
    const config = loadConfig('/tmp/nonexistent');
    expect(config.telegram.enabled).toBe(false);
    expect(config.memory.dbPath).toBe('data/memory.db');
    expect(config.heartbeat.intervalSeconds).toBe(30);
  });

  it('respects SC_TELEGRAM_TOKEN env var', () => {
    process.env.SC_TELEGRAM_TOKEN = 'test-token-123';
    const config = loadConfig('/tmp/nonexistent');
    expect(config.telegram.botToken).toBe('test-token-123');
    delete process.env.SC_TELEGRAM_TOKEN;
  });

  it('caches config on subsequent calls', () => {
    const config1 = loadConfig('/tmp/nonexistent');
    const config2 = loadConfig('/tmp/nonexistent');
    expect(config1).toBe(config2); // same reference
  });

  it('resets cache', () => {
    const config1 = loadConfig('/tmp/nonexistent');
    resetConfigCache();
    const config2 = loadConfig('/tmp/nonexistent');
    expect(config1).not.toBe(config2); // different reference
  });
});
