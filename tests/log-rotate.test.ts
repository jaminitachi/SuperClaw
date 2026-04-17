import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rotateIfNeeded } from '../scripts/lib/log-rotate.mjs';
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('rotateIfNeeded', () => {
  const testDir = join(tmpdir(), 'sc-test-rotate');
  const logPath = join(testDir, 'test.log');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    for (const f of [logPath, `${logPath}.1`, `${logPath}.2`, `${logPath}.3`]) {
      try { unlinkSync(f); } catch {}
    }
  });

  it('does nothing if file does not exist', () => {
    rotateIfNeeded(logPath);
    expect(existsSync(logPath)).toBe(false);
  });

  it('does nothing if file is under 5MB', () => {
    writeFileSync(logPath, 'small');
    rotateIfNeeded(logPath);
    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(`${logPath}.1`)).toBe(false);
  });

  it('rotates file when over 5MB', () => {
    writeFileSync(logPath, Buffer.alloc(6 * 1024 * 1024)); // 6MB
    rotateIfNeeded(logPath);
    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(existsSync(logPath)).toBe(false);
  });

  it('chains rotation: .1 becomes .2', () => {
    writeFileSync(`${logPath}.1`, 'old backup');
    writeFileSync(logPath, Buffer.alloc(6 * 1024 * 1024));
    rotateIfNeeded(logPath);
    expect(existsSync(`${logPath}.2`)).toBe(true);
    expect(existsSync(`${logPath}.1`)).toBe(true);
  });

  it('deletes oldest backup (.3) when rotating with full chain', () => {
    writeFileSync(`${logPath}.3`, 'oldest');
    writeFileSync(`${logPath}.2`, 'old');
    writeFileSync(`${logPath}.1`, 'recent');
    writeFileSync(logPath, Buffer.alloc(6 * 1024 * 1024));
    rotateIfNeeded(logPath);
    // .3 should exist (was deleted then replaced by old .2)
    expect(existsSync(`${logPath}.3`)).toBe(true);
  });
});
