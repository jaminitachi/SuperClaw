import { describe, it, expect } from 'vitest';

// These imports WILL FAIL until scripts/lib/session-end-utils.mjs is created.
// That is intentional: TDD RED phase.
import {
  isAuthErrorSession,
  cleanEnvironment,
  isAuthError,
  parseJsonFromResponse,
} from '../scripts/lib/session-end-utils.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Auth error pattern detection in transcript text
// ─────────────────────────────────────────────────────────────────────────────

describe('isAuthErrorSession', () => {
  it('returns true when transcript contains "Not logged in"', () => {
    expect(isAuthErrorSession('Not logged in. Please authenticate first.')).toBe(true);
  });

  it('returns true when transcript contains "Please run /login"', () => {
    expect(isAuthErrorSession('Error: Please run /login to continue.')).toBe(true);
  });

  it('returns true when transcript contains "unauthorized" (case-insensitive)', () => {
    expect(isAuthErrorSession('Request failed: Unauthorized access denied.')).toBe(true);
  });

  it('returns true when transcript contains "authentication failed" (case-insensitive)', () => {
    expect(isAuthErrorSession('Authentication Failed — invalid token.')).toBe(true);
  });

  it('returns false for normal transcript text', () => {
    expect(
      isAuthErrorSession('[User]: Fix the bug\n[Assistant]: Done, patched the null-check.')
    ).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAuthErrorSession('')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Minimum transcript length filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('minimum transcript length filtering via isAuthErrorSession', () => {
  // The filtering decision is length-based; we test the boundary at 200 chars.
  // isAuthErrorSession is the gate function — a short transcript that would be
  // filtered must NOT trigger auth error detection (separate concern), so we
  // verify that a 199-char string of normal content returns false (no false
  // positive), and a normal 200+ char string also returns false.

  it('does not false-positive on a 199-char normal transcript', () => {
    const shortText = 'A'.repeat(199);
    expect(isAuthErrorSession(shortText)).toBe(false);
  });

  it('does not false-positive on a 200-char normal transcript', () => {
    const exactText = 'A'.repeat(200);
    expect(isAuthErrorSession(exactText)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CMUX environment cleanup
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanEnvironment', () => {
  const baseEnv: Record<string, string> = {
    PATH: '/usr/bin:/bin',
    HOME: '/home/user',
    CMUX_SESSION_ID: 'abc123',
    CMUX_AGENT: 'dev-qa',
    CMUX_SOMETHING_ELSE: 'value',
    CLAUDECODE: '1',
    CLAUDE_CODE: '1',
    CLAUDE_CODE_RUNNING: '1',
    CLAUDE_CODE_SESSION: 'sess-42',
    CLAUDE_CODE_ENTRY_POINT: '/usr/bin/claude',
    SUPERCLAW_DAEMON: '0',
    SOME_OTHER_VAR: 'keep-me',
  };

  it('removes all CMUX_ prefixed variables', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result).not.toHaveProperty('CMUX_SESSION_ID');
    expect(result).not.toHaveProperty('CMUX_AGENT');
    expect(result).not.toHaveProperty('CMUX_SOMETHING_ELSE');
  });

  it('removes CLAUDECODE', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result).not.toHaveProperty('CLAUDECODE');
  });

  it('removes CLAUDE_CODE', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result).not.toHaveProperty('CLAUDE_CODE');
  });

  it('removes CLAUDE_CODE_RUNNING', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result).not.toHaveProperty('CLAUDE_CODE_RUNNING');
  });

  it('removes CLAUDE_CODE_SESSION', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result).not.toHaveProperty('CLAUDE_CODE_SESSION');
  });

  it('removes CLAUDE_CODE_ENTRY_POINT', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result).not.toHaveProperty('CLAUDE_CODE_ENTRY_POINT');
  });

  it('sets SUPERCLAW_DAEMON to "1"', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result.SUPERCLAW_DAEMON).toBe('1');
  });

  it('sets CMUX_CLAUDE_HOOKS_DISABLED to "1"', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result.CMUX_CLAUDE_HOOKS_DISABLED).toBe('1');
  });

  it('preserves PATH', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result.PATH).toBe('/usr/bin:/bin');
  });

  it('preserves HOME', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result.HOME).toBe('/home/user');
  });

  it('preserves arbitrary non-Claude env vars', () => {
    const result = cleanEnvironment(baseEnv);
    expect(result.SOME_OTHER_VAR).toBe('keep-me');
  });

  it('does not mutate the input env object', () => {
    const input: Record<string, string> = { CLAUDECODE: '1', PATH: '/bin' };
    cleanEnvironment(input);
    expect(input.CLAUDECODE).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. parseJsonFromResponse
// ─────────────────────────────────────────────────────────────────────────────

describe('parseJsonFromResponse', () => {
  it('parses plain valid JSON', () => {
    const result = parseJsonFromResponse('{"summary":"ok","decisions":[]}');
    expect(result).toEqual({ summary: 'ok', decisions: [] });
  });

  it('parses JSON wrapped in ```json code fence', () => {
    const result = parseJsonFromResponse('```json\n{"summary":"fenced","decisions":[]}\n```');
    expect(result).toEqual({ summary: 'fenced', decisions: [] });
  });

  it('parses JSON wrapped in plain ``` code fence', () => {
    const result = parseJsonFromResponse('```\n{"summary":"plain fence"}\n```');
    expect(result).toEqual({ summary: 'plain fence' });
  });

  it('extracts embedded JSON when surrounded by prose text', () => {
    const result = parseJsonFromResponse(
      'Here is the analysis:\n{"summary":"embedded","failures":["crash"]}\nEnd of output.'
    );
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).summary).toBe('embedded');
  });

  it('returns null for empty string', () => {
    expect(parseJsonFromResponse('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(parseJsonFromResponse(null as unknown as string)).toBeNull();
  });

  it('returns null for text with no JSON object', () => {
    expect(parseJsonFromResponse('just some plain text with no json')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseJsonFromResponse('{ broken json ][')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Auth error detection in stderr
// ─────────────────────────────────────────────────────────────────────────────

describe('isAuthError', () => {
  it('returns true when stderr contains "Not logged in"', () => {
    expect(isAuthError('Error: Not logged in')).toBe(true);
  });

  it('returns true when stderr contains "please run /login" (case-insensitive)', () => {
    expect(isAuthError('Please run /login to authenticate')).toBe(true);
  });

  it('returns true when stderr contains "unauthorized" (case-insensitive)', () => {
    expect(isAuthError('HTTP 401: Unauthorized')).toBe(true);
  });

  it('returns false for normal stderr output', () => {
    expect(isAuthError('Spawning claude with --model sonnet')).toBe(false);
  });

  it('returns false for empty stderr', () => {
    expect(isAuthError('')).toBe(false);
  });
});
