/**
 * Session Isolation Tests
 *
 * Verifies that ULW state is strictly session-scoped. Two parallel sessions
 * must NEVER see each other's edited files, verification state, gates, or
 * be blocked by each other's Sisyphus. Missing session_id must be a safe no-op
 * (no orphan state written anywhere).
 *
 * All state under ~/.claude/.sc/state/sessions/{sessionId}/.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
// @ts-ignore — plain .mjs module, no types
import { loadUnverified, loadAllEdited, markEdited, markVerified } from '../scripts/lib/ulw-verify-log.mjs';

const SCRIPTS = join(homedir(), 'superclaw', 'scripts');
const STATE_DIR = join(homedir(), '.claude', '.sc', 'state');
const SESSIONS_ROOT = join(STATE_DIR, 'sessions');
// A stray global verify log file — should never be written to. The current
// design has no global fallback; this path exists only as a canary.
const GLOBAL_VERIFY_LOG = join(STATE_DIR, 'ulw-verify-log.jsonl');

// Deterministic-but-unique IDs per run so parallel test runs don't collide.
const STAMP = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const SID_A = `test-iso-a-${STAMP}`;
const SID_B = `test-iso-b-${STAMP}`;

function sessionDir(sid: string) {
  return join(SESSIONS_ROOT, sid);
}

function gatesPath(sid: string) {
  return join(sessionDir(sid), 'gates.json');
}

function ulwStatePath(sid: string) {
  return join(sessionDir(sid), 'ultrawork-state.json');
}

function verifyLogPath(sid: string) {
  return join(sessionDir(sid), 'ulw-verify-log.jsonl');
}

function seedSession(sid: string, opts: { edited?: string[]; verified?: string[]; gates?: object } = {}) {
  const dir = sessionDir(sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(ulwStatePath(sid), JSON.stringify({
    active: true,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    mode: 'po-team',
    sessionId: sid,
  }, null, 2));
  writeFileSync(gatesPath(sid), JSON.stringify({
    planApproved: true,
    tddRequired: true,
    testsExist: true,
    testsRun: true,
    testsPassed: true,
    ultraworkActive: true,
    ...(opts.gates ?? {}),
  }, null, 2));
  // Always create the verify log file (even if empty) so existence checks
  // in tests can distinguish "session seeded" from "session absent".
  try { unlinkSync(verifyLogPath(sid)); } catch {}
  writeFileSync(verifyLogPath(sid), '');
  for (const f of opts.edited ?? []) markEdited(verifyLogPath(sid), f);
  for (const f of opts.verified ?? []) markVerified(verifyLogPath(sid), f);
}

function cleanSession(sid: string) {
  try { rmSync(sessionDir(sid), { recursive: true, force: true }); } catch {}
}

function runHook(script: string, input: Record<string, any>): any {
  // Does NOT auto-inject session_id — caller controls exactly what's in stdin
  // so the omitted-sessionId case can be tested.
  try {
    // Pass JSON via execSync's `input` option (stdin) to avoid shell escaping
    // pitfalls with $ or backticks inside the payload.
    const result = execSync(`node "${join(SCRIPTS, script)}"`, {
      encoding: 'utf-8',
      timeout: 8000,
      input: JSON.stringify(input),
    });
    return JSON.parse(result.trim());
  } catch (e: any) {
    const out = e.stdout?.trim() || e.stderr?.trim() || '';
    try { return JSON.parse(out); } catch { return { raw: out, exitCode: e.status }; }
  }
}

// No longer used, but kept as a no-op shim for any future test that lands
// on this helper name. Verify-log reads now go through loadUnverified /
// loadAllEdited imported from scripts/lib/ulw-verify-log.mjs.

// -----------------------------------------------------------------------------

describe('Session Isolation', () => {
  beforeEach(() => {
    cleanSession(SID_A);
    cleanSession(SID_B);
  });
  afterEach(() => {
    cleanSession(SID_A);
    cleanSession(SID_B);
  });
  afterAll(() => {
    // Defensive: remove any orphan "test-iso-*" dirs from prior failed runs.
    try {
      if (existsSync(SESSIONS_ROOT)) {
        for (const dir of readdirSync(SESSIONS_ROOT)) {
          if (dir.startsWith(`test-iso-a-${STAMP}`) || dir.startsWith(`test-iso-b-${STAMP}`)) {
            rmSync(join(SESSIONS_ROOT, dir), { recursive: true, force: true });
          }
        }
      }
    } catch {}
  });

  // ---------------------------------------------------------------------------
  // Test 1 — Two sessions' edited files are independent
  // ---------------------------------------------------------------------------
  it('Test 1: session A edits do not leak into session B or global state', () => {
    seedSession(SID_A);
    seedSession(SID_B);

    // Snapshot the global file so we can detect whether it was touched.
    const globalExistsBefore = existsSync(GLOBAL_VERIFY_LOG);
    const globalBefore = globalExistsBefore ? readFileSync(GLOBAL_VERIFY_LOG, 'utf-8') : null;

    // Session A writes a file via post-tool hook.
    runHook('sc-post-tool.mjs', {
      session_id: SID_A,
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/session-a-file.ts', content: 'x' },
      tool_response: 'ok',
    });

    // Session A's verify log contains the mark event.
    const unverifiedA = loadUnverified(verifyLogPath(SID_A));
    expect(unverifiedA.has('/tmp/session-a-file.ts')).toBe(true);

    // Session B's verify log is untouched.
    const unverifiedB = loadUnverified(verifyLogPath(SID_B));
    expect(unverifiedB.has('/tmp/session-a-file.ts')).toBe(false);
    expect(loadAllEdited(verifyLogPath(SID_B)).has('/tmp/session-a-file.ts')).toBe(false);

    // Global file was never created or modified to contain this path.
    if (existsSync(GLOBAL_VERIFY_LOG)) {
      const globalAfter = readFileSync(GLOBAL_VERIFY_LOG, 'utf-8');
      expect(globalAfter).not.toContain('/tmp/session-a-file.ts');
      // Should be byte-identical to before (if it existed) — no side effect.
      if (globalExistsBefore) {
        expect(globalAfter).toBe(globalBefore);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Test 2 — Session A's Sisyphus does not block session B
  // ---------------------------------------------------------------------------
  it("Test 2: session A's unverified files do not block session B's Stop hook", () => {
    // Session A has unverified files — its Sisyphus would block it.
    seedSession(SID_A, { edited: ['/tmp/a-unverified.ts'], verified: [] });
    // Session B has NO state at all — it's a fresh session with no ULW.
    // (No seedSession(SID_B) call.)
    expect(existsSync(sessionDir(SID_B))).toBe(false);

    const result = runHook('sc-persistent.mjs', { session_id: SID_B });
    expect(result.decision).toBe('approve');

    // Sanity: session A's state is still there (we did not accidentally delete it).
    expect(existsSync(verifyLogPath(SID_A))).toBe(true);
    expect(loadUnverified(verifyLogPath(SID_A)).has('/tmp/a-unverified.ts')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 3 — session-end on A does not delete session B's state
  // ---------------------------------------------------------------------------
  it("Test 3: session-end on A does not delete session B's state", () => {
    seedSession(SID_A);
    seedSession(SID_B);

    // Run session-end for A only.
    runHook('session-end.mjs', { session_id: SID_A });

    // A's ULW files should be gone.
    expect(existsSync(ulwStatePath(SID_A))).toBe(false);
    expect(existsSync(verifyLogPath(SID_A))).toBe(false);
    expect(existsSync(gatesPath(SID_A))).toBe(false);

    // B's files are still there — session-end must not touch other sessions.
    expect(existsSync(ulwStatePath(SID_B))).toBe(true);
    expect(existsSync(verifyLogPath(SID_B))).toBe(true);
    expect(existsSync(gatesPath(SID_B))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 4 — sessionId missing → no state written anywhere
  // ---------------------------------------------------------------------------
  it('Test 4: missing session_id → no ULW state written for orphan path', () => {
    // Snapshot global file.
    const globalExistsBefore = existsSync(GLOBAL_VERIFY_LOG);
    const globalBefore = globalExistsBefore ? readFileSync(GLOBAL_VERIFY_LOG, 'utf-8') : null;

    // Snapshot any existing session dirs so we can detect NEW ones.
    const existingSessionDirs = existsSync(SESSIONS_ROOT)
      ? new Set(readdirSync(SESSIONS_ROOT))
      : new Set<string>();

    runHook('sc-post-tool.mjs', {
      // NO session_id
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/orphan.ts', content: 'x' },
      tool_response: 'ok',
    });

    // No NEW session dir was created as a side effect of the orphan call.
    if (existsSync(SESSIONS_ROOT)) {
      const currentSessionDirs = readdirSync(SESSIONS_ROOT);
      for (const dir of currentSessionDirs) {
        if (!existingSessionDirs.has(dir)) {
          // A new dir appeared. Its verify log must not contain the orphan
          // (whether via the "ever edited" or the "unverified" replay).
          const logPath = join(SESSIONS_ROOT, dir, 'ulw-verify-log.jsonl');
          expect(loadAllEdited(logPath).has('/tmp/orphan.ts')).toBe(false);
        }
      }
    }

    // Global file untouched (or at minimum, does not contain orphan path).
    if (existsSync(GLOBAL_VERIFY_LOG)) {
      const globalAfter = readFileSync(GLOBAL_VERIFY_LOG, 'utf-8');
      expect(globalAfter).not.toContain('/tmp/orphan.ts');
      if (globalExistsBefore) {
        expect(globalAfter).toBe(globalBefore);
      }
    }
  });
});
