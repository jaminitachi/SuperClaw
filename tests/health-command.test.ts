import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const SUPERCLAW_ROOT = join(__dirname, '..');
const COMMAND_PATH = join(SUPERCLAW_ROOT, 'commands', 'sc-health.md');

describe('/health command', () => {
  it('command file exists', () => {
    expect(existsSync(COMMAND_PATH)).toBe(true);
  });

  it('has valid frontmatter with name', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('name:');
  });

  it('includes health check instructions', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content.toLowerCase()).toMatch(/health|status|system/);
  });

  it('is not empty (min 10 lines)', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    const lines = content.split('\n').length;
    expect(lines).toBeGreaterThanOrEqual(10);
  });
});
