import { describe, it, expect } from 'vitest';
import { homedir } from 'os';

// ── cost ─────────────────────────────────────────────────────────────────────
import {
  calculateCost,
  formatCost,
  formatTokenCount,
  getCacheHitRate,
} from '../hud/cost.mjs';

// ── sanitize ─────────────────────────────────────────────────────────────────
import { sanitizeOutput, limitLines } from '../hud/sanitize.mjs';

// ── limits ───────────────────────────────────────────────────────────────────
import { renderRateLimits } from '../hud/elements/limits.mjs';

// ── cwd ──────────────────────────────────────────────────────────────────────
import { renderCwd } from '../hud/elements/cwd.mjs';

// ── context ──────────────────────────────────────────────────────────────────
import { renderContext } from '../hud/elements/context.mjs';

// ANSI code constants (mirrors hud/colors.mjs — used in assertions)
const RESET = '\x1b[0m';
const DIM   = '\x1b[2m';
const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Strip all ANSI escape codes so we can assert on plain text */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('HUD cost — calculateCost', () => {
  const baseTokens = {
    input: 1_000_000,
    cacheCreation: 0,
    cacheRead: 0,
    total: 1_000_000,
  };

  it('calculates cost for sonnet tier (default when model unknown)', () => {
    // sonnet: input $3/1M + outputEst(15% of total) $15/1M
    // = 3.0 + (1_000_000 * 0.15 / 1_000_000) * 15 = 3.0 + 2.25 = 5.25
    const cost = calculateCost('claude-sonnet-3', baseTokens);
    expect(cost).toBeCloseTo(5.25, 5);
  });

  it('calculates cost for opus tier', () => {
    // opus: input $15/1M + outputEst $75/1M
    // = 15.0 + (1_000_000 * 0.15 / 1_000_000) * 75 = 15.0 + 11.25 = 26.25
    const cost = calculateCost('claude-opus-4', baseTokens);
    expect(cost).toBeCloseTo(26.25, 5);
  });

  it('calculates cost for haiku tier', () => {
    // haiku: input $0.80/1M + outputEst $4/1M
    // = 0.80 + (1_000_000 * 0.15 / 1_000_000) * 4 = 0.80 + 0.60 = 1.40
    const cost = calculateCost('claude-haiku-3', baseTokens);
    expect(cost).toBeCloseTo(1.40, 5);
  });

  it('falls back to sonnet tier when modelName is null', () => {
    const cost = calculateCost(null as unknown as string, baseTokens);
    expect(cost).toBeCloseTo(5.25, 5);
  });

  it('includes cacheCreation cost', () => {
    const tokens = { input: 0, cacheCreation: 1_000_000, cacheRead: 0, total: 1_000_000 };
    // sonnet cacheCreation $3.75/1M + outputEst $15/1M * 0.15 = 3.75 + 2.25 = 6.0
    const cost = calculateCost('claude-sonnet', tokens);
    expect(cost).toBeCloseTo(6.0, 5);
  });

  it('includes cacheRead cost', () => {
    const tokens = { input: 0, cacheCreation: 0, cacheRead: 1_000_000, total: 1_000_000 };
    // sonnet cacheRead $0.30/1M + outputEst 2.25 = 2.55
    const cost = calculateCost('claude-sonnet', tokens);
    expect(cost).toBeCloseTo(2.55, 5);
  });

  it('returns 0 when all token counts are 0', () => {
    const tokens = { input: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
    expect(calculateCost('claude-sonnet', tokens)).toBe(0);
  });

  it('model name match is case-insensitive', () => {
    const t = baseTokens;
    expect(calculateCost('Claude-OPUS-4', t)).toBeCloseTo(calculateCost('claude-opus-4', t), 10);
    expect(calculateCost('HAIKU', t)).toBeCloseTo(calculateCost('haiku', t), 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('HUD cost — formatCost', () => {
  it('returns $0.00 when cost is below 0.01', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.009)).toBe('$0.00');
  });

  it('formats costs between 0.01 and 1 with two decimal places', () => {
    expect(formatCost(0.01)).toBe('$0.01');
    expect(formatCost(0.5)).toBe('$0.50');
    expect(formatCost(0.99)).toBe('$0.99');
  });

  it('formats costs >= 1 with two decimal places', () => {
    expect(formatCost(1)).toBe('$1.00');
    expect(formatCost(12.3456)).toBe('$12.35');
    expect(formatCost(100)).toBe('$100.00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('HUD cost — formatTokenCount', () => {
  it('returns plain string for counts below 1000', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1)).toBe('1');
  });

  it('formats thousands with one decimal and k suffix', () => {
    expect(formatTokenCount(1_000)).toBe('1.0k');
    expect(formatTokenCount(1_200)).toBe('1.2k');
    expect(formatTokenCount(999_999)).toBe('1000.0k');
  });

  it('formats millions with one decimal and M suffix', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M');
    expect(formatTokenCount(1_500_000)).toBe('1.5M');
    expect(formatTokenCount(10_000_000)).toBe('10.0M');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('HUD cost — getCacheHitRate', () => {
  it('returns 0 when total is 0 (no division by zero)', () => {
    expect(getCacheHitRate({ total: 0, cacheRead: 0 } as any)).toBe(0);
  });

  it('returns correct percentage of cacheRead / total', () => {
    expect(getCacheHitRate({ total: 1000, cacheRead: 250 } as any)).toBeCloseTo(25, 5);
    expect(getCacheHitRate({ total: 1000, cacheRead: 1000 } as any)).toBeCloseTo(100, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('HUD sanitize — sanitizeOutput', () => {
  it('removes cursor movement escape sequences', () => {
    // \x1b[A = cursor up, \x1b[2J = erase screen
    const dirty = 'hello\x1b[Aworld\x1b[2J';
    expect(sanitizeOutput(dirty)).toBe('helloworld');
  });

  it('removes mode set/reset sequences', () => {
    const dirty = 'abc\x1b[?25hdef\x1b[?25l';
    expect(sanitizeOutput(dirty)).toBe('abcdef');
  });

  it('removes OSC sequences (window title, etc.)', () => {
    const dirty = '\x1b]0;my terminal title\x07plain';
    expect(sanitizeOutput(dirty)).toBe('plain');
  });

  it('replaces full block U+2588 with #', () => {
    expect(sanitizeOutput('a\u2588b')).toBe('a#b');
  });

  it('replaces light block U+2591 with -', () => {
    expect(sanitizeOutput('a\u2591b')).toBe('a-b');
  });

  it('preserves SGR color codes (e.g. \\x1b[31m)', () => {
    // SGR ends with 'm' — should NOT be stripped
    const colored = '\x1b[31mred text\x1b[0m';
    expect(sanitizeOutput(colored)).toBe(colored);
  });

  it('returns empty string unchanged', () => {
    expect(sanitizeOutput('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(sanitizeOutput('no escapes here')).toBe('no escapes here');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('HUD sanitize — limitLines', () => {
  it('returns text unchanged when lines <= maxLines', () => {
    const text = 'line1\nline2\nline3';
    expect(limitLines(text, 3)).toBe(text);
    expect(limitLines(text, 5)).toBe(text);
  });

  it('truncates to maxLines and appends overflow notice', () => {
    const text = 'a\nb\nc\nd\ne';
    const result = limitLines(text, 3);
    expect(result).toBe('a\nb\nc\n... (+2 lines)');
  });

  it('handles exactly maxLines+1 lines', () => {
    const text = '1\n2\n3\n4';
    const result = limitLines(text, 3);
    expect(result).toBe('1\n2\n3\n... (+1 lines)');
  });

  it('handles a single line input (no newlines)', () => {
    expect(limitLines('only one line', 4)).toBe('only one line');
  });

  it('handles empty string', () => {
    expect(limitLines('', 4)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('HUD limits — renderRateLimits', () => {
  it('returns null when usage is null', () => {
    expect(renderRateLimits(null)).toBeNull();
  });

  it('returns null when usage is undefined', () => {
    expect(renderRateLimits(undefined as any)).toBeNull();
  });

  it('returns null when usage has no recognized percent fields', () => {
    expect(renderRateLimits({} as any)).toBeNull();
  });

  it('renders fiveHourPercent in plain text', () => {
    const result = renderRateLimits({ fiveHourPercent: 42 } as any);
    expect(result).not.toBeNull();
    expect(stripAnsi(result!)).toContain('5h:42%');
  });

  it('renders weeklyPercent in plain text', () => {
    const result = renderRateLimits({ weeklyPercent: 55 } as any);
    expect(result).not.toBeNull();
    expect(stripAnsi(result!)).toContain('wk:55%');
  });

  it('uses green color when percent is below warning threshold (60)', () => {
    const result = renderRateLimits({ fiveHourPercent: 30 } as any);
    expect(result).toContain(GREEN);
  });

  it('uses yellow color when percent is at/above warning threshold (60)', () => {
    const result = renderRateLimits({ fiveHourPercent: 60 } as any);
    expect(result).toContain(YELLOW);
  });

  it('uses red color when percent is at/above critical threshold (85)', () => {
    const result = renderRateLimits({ fiveHourPercent: 85 } as any);
    expect(result).toContain(RED);
  });

  it('shows dimmed stale prefix ~% when usage.stale is true', () => {
    const result = renderRateLimits({ fiveHourPercent: 50, stale: true } as any);
    expect(result).not.toBeNull();
    // Must contain DIM and the tilde prefix
    expect(result).toContain(DIM);
    expect(stripAnsi(result!)).toContain('5h:~50%');
  });

  it('shows stale weekly with tilde prefix', () => {
    const result = renderRateLimits({ weeklyPercent: 70, stale: true } as any);
    expect(stripAnsi(result!)).toContain('wk:~70%');
  });

  it('appends formatted reset time when fiveHourReset is provided', () => {
    const soon = new Date(Date.now() + 90 * 60_000).toISOString(); // 90 min from now
    const result = renderRateLimits({ fiveHourPercent: 20, fiveHourReset: soon } as any);
    expect(stripAnsi(result!)).toMatch(/5h:20%\(.*\)/);
  });

  it('shows per-model opus breakdown (Op:)', () => {
    const result = renderRateLimits({ opusWeeklyPercent: 30 } as any);
    expect(result).not.toBeNull();
    expect(stripAnsi(result!)).toContain('Op:30%');
  });

  it('shows per-model sonnet breakdown (Sn:)', () => {
    const result = renderRateLimits({ sonnetWeeklyPercent: 45 } as any);
    expect(result).not.toBeNull();
    expect(stripAnsi(result!)).toContain('Sn:45%');
  });

  it('hides per-model breakdown when stale', () => {
    const result = renderRateLimits({ opusWeeklyPercent: 30, stale: true } as any);
    // Per-model parts are skipped for stale data
    if (result !== null) {
      expect(stripAnsi(result)).not.toContain('Op:');
    }
  });

  it('formats reset time in minutes', () => {
    const soon = new Date(Date.now() + 45 * 60_000).toISOString();
    const result = renderRateLimits({ fiveHourPercent: 10, fiveHourReset: soon } as any);
    expect(stripAnsi(result!)).toContain('45m');
  });

  it('formats reset time in hours+minutes', () => {
    const later = new Date(Date.now() + (2 * 3_600_000 + 30 * 60_000)).toISOString();
    const result = renderRateLimits({ fiveHourPercent: 10, fiveHourReset: later } as any);
    expect(stripAnsi(result!)).toContain('2h30m');
  });

  it('formats reset time in days', () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const result = renderRateLimits({ weeklyPercent: 10, weeklyReset: future } as any);
    expect(stripAnsi(result!)).toContain('3d');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('HUD cwd — renderCwd', () => {
  const home = homedir();

  it('returns null when cwd is null', () => {
    expect(renderCwd(null as unknown as string)).toBeNull();
  });

  it('returns null when cwd is empty string', () => {
    expect(renderCwd('')).toBeNull();
  });

  it('basename format returns only the last path segment', () => {
    const result = renderCwd('/Users/alice/projects/superclaw', 'basename');
    expect(stripAnsi(result!)).toBe('superclaw');
  });

  it('folder format returns only the last path segment (same as basename)', () => {
    const result = renderCwd('/Users/alice/projects/superclaw', 'folder');
    expect(stripAnsi(result!)).toBe('superclaw');
  });

  it('absolute format returns the full path', () => {
    const path = '/some/absolute/path';
    const result = renderCwd(path, 'absolute');
    expect(stripAnsi(result!)).toBe(path);
  });

  it('relative format replaces home prefix with ~', () => {
    const path = `${home}/projects/foo`;
    const result = renderCwd(path, 'relative');
    expect(stripAnsi(result!)).toBe('~/projects/foo');
  });

  it('relative format leaves non-home paths unchanged', () => {
    const path = '/tmp/some/other/path';
    const result = renderCwd(path, 'relative');
    expect(stripAnsi(result!)).toBe(path);
  });

  it('defaults to relative format when format parameter is omitted', () => {
    const path = `${home}/work`;
    const resultDefault = renderCwd(path);
    const resultRelative = renderCwd(path, 'relative');
    expect(resultDefault).toBe(resultRelative);
  });

  it('wraps output in DIM ANSI codes', () => {
    const result = renderCwd('/tmp/test', 'absolute');
    expect(result).toContain(DIM);
    expect(result).toContain(RESET);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('HUD context — renderContext', () => {
  const defaultConfig = { thresholds: { contextWarning: 70, contextCritical: 85 }, elements: {} };

  it('returns null when percent is null', () => {
    expect(renderContext(null as unknown as number, defaultConfig)).toBeNull();
  });

  it('returns null when percent is undefined', () => {
    expect(renderContext(undefined as unknown as number, defaultConfig)).toBeNull();
  });

  it('renders ctx: prefix with rounded percentage', () => {
    const result = renderContext(50, defaultConfig);
    expect(stripAnsi(result!)).toBe('ctx:50%');
  });

  it('rounds fractional percent', () => {
    const result = renderContext(49.6, defaultConfig);
    expect(stripAnsi(result!)).toBe('ctx:50%');
  });

  it('uses green color below warning threshold (70)', () => {
    const result = renderContext(30, defaultConfig);
    expect(result).toContain(GREEN);
  });

  it('uses yellow color at warning threshold (70)', () => {
    const result = renderContext(70, defaultConfig);
    expect(result).toContain(YELLOW);
  });

  it('uses yellow color between warning and critical (71–84)', () => {
    const result = renderContext(80, defaultConfig);
    expect(result).toContain(YELLOW);
  });

  it('uses red color at critical threshold (85)', () => {
    const result = renderContext(85, defaultConfig);
    expect(result).toContain(RED);
  });

  it('uses red color above critical threshold', () => {
    const result = renderContext(100, defaultConfig);
    expect(result).toContain(RED);
  });

  it('renders with bar when config.elements.useBars is true', () => {
    const config = { ...defaultConfig, elements: { useBars: true } };
    const result = renderContext(50, config);
    // Bar format starts with ctx:[
    expect(stripAnsi(result!)).toMatch(/^ctx:\[/);
    expect(stripAnsi(result!)).toContain('50%');
  });

  it('bar at 0% has no filled blocks', () => {
    const config = { ...defaultConfig, elements: { useBars: true } };
    const result = renderContext(0, config);
    // All 10 slots should be empty (░)
    expect(stripAnsi(result!)).toContain('░░░░░░░░░░');
  });

  it('bar at 100% has all filled blocks', () => {
    const config = { ...defaultConfig, elements: { useBars: true } };
    const result = renderContext(100, config);
    // All 10 slots should be filled (█)
    expect(stripAnsi(result!)).toContain('██████████');
  });

  it('uses config warning threshold when supplied', () => {
    const config = { thresholds: { contextWarning: 50, contextCritical: 90 }, elements: {} };
    const resultBelow = renderContext(49, config);
    const resultAtOrAbove = renderContext(50, config);
    expect(resultBelow).toContain(GREEN);
    expect(resultAtOrAbove).toContain(YELLOW);
  });

  it('falls back to default thresholds (70/85) when thresholds config is absent', () => {
    const config = { elements: {} } as any;
    const resultGreen = renderContext(60, config);
    const resultYellow = renderContext(70, config);
    expect(resultGreen).toContain(GREEN);
    expect(resultYellow).toContain(YELLOW);
  });
});
