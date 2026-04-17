import { describe, it, expect } from 'vitest';
import { findClaudeBin } from '../scripts/lib/claude-bin.mjs';

describe('findClaudeBin', () => {
  it('returns a non-empty string', () => {
    const result = findClaudeBin();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a path that includes "claude"', () => {
    const result = findClaudeBin();
    expect(result).toContain('claude');
  });

  it('returns a string without surrounding whitespace', () => {
    const result = findClaudeBin();
    expect(result).toBe(result.trim());
  });

  it('returns the same value on repeated calls (deterministic)', () => {
    const first = findClaudeBin();
    const second = findClaudeBin();
    expect(first).toBe(second);
  });
});
