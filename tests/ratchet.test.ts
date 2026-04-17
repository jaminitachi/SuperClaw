import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appendChangelog, shouldEscalate } from '../src/daemon/ratchet.js';

describe('appendChangelog', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ratchet-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates CHANGELOG.md if not exists', () => {
    appendChangelog(tempDir, 'Initial entry');
    expect(existsSync(join(tempDir, 'CHANGELOG.md'))).toBe(true);
    const content = readFileSync(join(tempDir, 'CHANGELOG.md'), 'utf-8');
    expect(content).toContain('Initial entry');
    expect(content).toContain('# CHANGELOG');
  });

  it('appends to existing CHANGELOG.md', () => {
    writeFileSync(join(tempDir, 'CHANGELOG.md'), '# CHANGELOG\n## 2024-01-01\nOld entry\n');
    appendChangelog(tempDir, 'New entry');
    const content = readFileSync(join(tempDir, 'CHANGELOG.md'), 'utf-8');
    expect(content).toContain('Old entry');
    expect(content).toContain('New entry');
  });
});

describe('shouldEscalate', () => {
  it('returns true after 3 consecutive failures', () => {
    expect(shouldEscalate({ taskId: 't1', iteration: 1, consecutiveFailures: 3, status: 'running', lastCheckpoint: '' })).toBe(true);
  });

  it('returns false with fewer than 3 failures', () => {
    expect(shouldEscalate({ taskId: 't1', iteration: 1, consecutiveFailures: 2, status: 'running', lastCheckpoint: '' })).toBe(false);
  });
});
