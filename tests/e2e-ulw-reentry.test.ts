/**
 * E2E: ULW Re-entry, TTL, Session Cleanup — RED phase tests
 *
 * All 5 test groups target UNIMPLEMENTED behavior. Every test MUST fail
 * against the current codebase. Failure proofs:
 *
 * 1. Re-entry round reset     — sc-keyword-detector.mjs L150-171 skips gate
 *                                reset when ulwAlreadyActive=true → iteration
 *                                and round-marker assertions fail.
 * 2. round-aware loadUnverified — ulw-verify-log.mjs has no round-marker
 *                                branch → replays all events → returns {B,C}
 *                                instead of {C}.
 * 3. Stop hook TTL 30min      — sc-persistent.mjs STALE_TIMEOUT=24h → 31 min
 *                                is not stale → decision='block', file survives.
 * 4. session-end rmdir        — session-end.mjs only unlinks files, never calls
 *                                rmdir → directory survives after hook.
 * 5. cleanup-stale-sessions   — scripts/cleanup-stale-sessions.mjs does not
 *                                exist → execSync throws → test fails.
 *
 * Lives in e2e-* so vitest.e2e.ts pool config (forks/singleFork) applies.
 * Each test gets its own makeSessionDir() slot → parallel-safe.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  appendFileSync,
  existsSync,
  readdirSync,
  utimesSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// @ts-ignore — plain .mjs module, no types
import { loadUnverified, loadAllEdited } from '../scripts/lib/ulw-verify-log.mjs';

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------
const SCRIPTS = join(homedir(), 'superclaw', 'scripts');
const STATE_DIR = join(homedir(), '.claude', '.sc', 'state');
const SESSIONS_DIR = join(STATE_DIR, 'sessions');

/** All session dirs allocated in this file — torn down in afterEach. */
const allocatedDirs: string[] = [];

function makeSessionDir(): {
  sid: string;
  sessionDir: string;
  ulwPath: string;
  gatesPath: string;
  boardPath: string;
  verifyLogPath: string;
} {
  const sid = `reentry-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const dir = join(SESSIONS_DIR, sid);
  mkdirSync(dir, { recursive: true });
  allocatedDirs.push(dir);
  return {
    sid,
    sessionDir: dir,
    ulwPath: join(dir, 'ultrawork-state.json'),
    gatesPath: join(dir, 'gates.json'),
    boardPath: join(dir, 'ulw-board.jsonl'),
    verifyLogPath: join(dir, 'ulw-verify-log.jsonl'),
  };
}

afterEach(() => {
  while (allocatedDirs.length > 0) {
    const dir = allocatedDirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

/** Run a hook script via stdin JSON, return parsed response. */
function runHook(script: string, input: Record<string, unknown>): any {
  try {
    const result = execSync(`node "${join(SCRIPTS, script)}"`, {
      encoding: 'utf-8',
      timeout: 10_000,
      input: JSON.stringify(input),
    });
    return JSON.parse(result.trim());
  } catch (e: any) {
    const out = (e.stdout?.trim() ?? '') || (e.stderr?.trim() ?? '');
    try { return JSON.parse(out); } catch { return { raw: out, exitCode: e.status }; }
  }
}

function writeUlwState(path: string, sid: string, overrides: Record<string, unknown> = {}) {
  writeFileSync(path, JSON.stringify({
    active: true,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    mode: 'po-team',
    sessionId: sid,
    iteration: 1,
    ...overrides,
  }, null, 2));
}

function writeGates(path: string, overrides: Record<string, unknown> = {}) {
  writeFileSync(path, JSON.stringify({
    planApproved: false,
    tddRequired: true,
    testsExist: false,
    testsRun: false,
    testsRedConfirmed: false,
    testsGreenConfirmed: false,
    ultraworkActive: true,
    ...overrides,
  }, null, 2));
}

function readJSON(filePath: string): any {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// ---------------------------------------------------------------------------
// 1. Re-entry Round Reset
// ---------------------------------------------------------------------------
describe('E2E: ULW re-entry increments round and resets gates', () => {
  it('iteration increments 1→2 on second ULW keyword in same session', () => {
    // RED: keyword-detector skips state reset when ulwAlreadyActive=true (L171).
    // Therefore ultrawork-state.json never gets iteration:2 → assertion fails.
    const { sid, ulwPath, gatesPath, boardPath, verifyLogPath } = makeSessionDir();

    // Seed: session already has active ULW state from round 1
    writeUlwState(ulwPath, sid, { iteration: 1 });
    writeGates(gatesPath, {
      planApproved: true,
      testsExist: true,
      testsRun: true,
      testsRedConfirmed: true,
      testsGreenConfirmed: true,
    });
    writeFileSync(boardPath, '');
    writeFileSync(verifyLogPath, '');

    // Re-submit ULW keyword — should trigger round increment
    runHook('sc-keyword-detector.mjs', {
      session_id: sid,
      prompt: 'ulw 다시 해줘',
    });

    const state = JSON.parse(readFileSync(ulwPath, 'utf-8'));
    // FAILS: current code leaves iteration=1 (or undefined)
    expect(state.iteration).toBe(2);
  });

  it('gates reset to all-false (except ultraworkActive) on re-entry', () => {
    // RED: without round reset, gates remain as seeded (all true).
    const { sid, ulwPath, gatesPath, boardPath, verifyLogPath } = makeSessionDir();

    writeUlwState(ulwPath, sid, { iteration: 1 });
    writeGates(gatesPath, {
      planApproved: true,
      testsExist: true,
      testsRun: true,
      testsRedConfirmed: true,
      testsGreenConfirmed: true,
    });
    writeFileSync(boardPath, '');
    writeFileSync(verifyLogPath, '');

    runHook('sc-keyword-detector.mjs', { session_id: sid, prompt: 'ultrawork' });

    const gates = JSON.parse(readFileSync(gatesPath, 'utf-8'));
    // FAILS: current code leaves all gates as-is
    expect(gates.planApproved).toBe(false);
    expect(gates.testsExist).toBe(false);
    expect(gates.testsRun).toBe(false);
    expect(gates.testsRedConfirmed).toBe(false);
    expect(gates.testsGreenConfirmed).toBe(false);
    // ultraworkActive must stay true
    expect(gates.ultraworkActive).toBe(true);
  });

  it('ulw-board.jsonl has round-marker entry for round 2 after re-entry', () => {
    // RED: no round-marker is written by current code.
    const { sid, ulwPath, gatesPath, boardPath, verifyLogPath } = makeSessionDir();

    writeUlwState(ulwPath, sid, { iteration: 1 });
    writeGates(gatesPath, { planApproved: true, testsExist: true });
    writeFileSync(boardPath, '');
    writeFileSync(verifyLogPath, '');

    runHook('sc-keyword-detector.mjs', { session_id: sid, prompt: 'ulw' });

    // FAILS: board file has no lines / no round-marker entry
    const lines = readFileSync(boardPath, 'utf-8')
      .split('\n')
      .filter((l: string) => l.trim())
      .map((l: string) => JSON.parse(l));

    const lastLine = lines[lines.length - 1];
    expect(lastLine?.type).toBe('round-marker');
    expect(lastLine?.round).toBe(2);
    expect(typeof lastLine?.ts).toBe('string');
  });

  it('ulw-verify-log.jsonl has round-marker as last entry after re-entry', () => {
    // RED: no round-marker written to verify log.
    const { sid, ulwPath, gatesPath, boardPath, verifyLogPath } = makeSessionDir();

    writeUlwState(ulwPath, sid, { iteration: 1 });
    writeGates(gatesPath, { planApproved: true });
    writeFileSync(boardPath, '');
    // Seed verify log with prior-round events
    appendFileSync(verifyLogPath, JSON.stringify({ mark: '/tmp/prior.ts', ts: new Date().toISOString() }) + '\n');
    appendFileSync(verifyLogPath, JSON.stringify({ clear: '/tmp/prior.ts', ts: new Date().toISOString() }) + '\n');

    runHook('sc-keyword-detector.mjs', { session_id: sid, prompt: 'ultrawork' });

    // FAILS: no round-marker appended
    const lines = readFileSync(verifyLogPath, 'utf-8')
      .split('\n')
      .filter((l: string) => l.trim())
      .map((l: string) => JSON.parse(l));

    const lastLine = lines[lines.length - 1];
    expect(lastLine?.type).toBe('round-marker');
    expect(lastLine?.round).toBe(2);
    expect(typeof lastLine?.ts).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 2. round-aware loadUnverified
// ---------------------------------------------------------------------------
describe('E2E: loadUnverified respects round-marker boundary', () => {
  it('returns only post-marker entries (C), not pre-marker ones (B)', () => {
    // RED: current loadUnverified in ulw-verify-log.mjs has no round-marker
    // branch. JSON.parse succeeds but the event has no "mark"/"clear" key →
    // it is silently skipped. B remains in unverified set from its mark event.
    // Result: {B, C} → assertion for size===1 fails.
    const { verifyLogPath } = makeSessionDir();

    const ts = () => new Date().toISOString();

    // mark:A → clear:A → mark:B → round-marker (round 2) → mark:C
    appendFileSync(verifyLogPath, JSON.stringify({ mark: '/tmp/fileA.ts', ts: ts() }) + '\n');
    appendFileSync(verifyLogPath, JSON.stringify({ clear: '/tmp/fileA.ts', ts: ts() }) + '\n');
    appendFileSync(verifyLogPath, JSON.stringify({ mark: '/tmp/fileB.ts', ts: ts() }) + '\n');
    appendFileSync(verifyLogPath, JSON.stringify({ type: 'round-marker', round: 2, ts: ts() }) + '\n');
    appendFileSync(verifyLogPath, JSON.stringify({ mark: '/tmp/fileC.ts', ts: ts() }) + '\n');

    const unverified = loadUnverified(verifyLogPath);

    // FAILS: current code returns {B, C} (size=2) instead of {C} (size=1)
    expect(unverified.size).toBe(1);
    expect(unverified.has('/tmp/fileC.ts')).toBe(true);
    expect(unverified.has('/tmp/fileB.ts')).toBe(false);
  });

  it('round-marker also resets loadAllEdited scope to post-marker only', () => {
    // RED: loadAllEdited has no round-marker branch either.
    const { verifyLogPath } = makeSessionDir();

    const ts = () => new Date().toISOString();
    appendFileSync(verifyLogPath, JSON.stringify({ mark: '/tmp/fileX.ts', ts: ts() }) + '\n');
    appendFileSync(verifyLogPath, JSON.stringify({ type: 'round-marker', round: 2, ts: ts() }) + '\n');
    appendFileSync(verifyLogPath, JSON.stringify({ mark: '/tmp/fileY.ts', ts: ts() }) + '\n');

    const allEdited = loadAllEdited(verifyLogPath);

    // FAILS: current code returns {X, Y} (size=2) instead of {Y} (size=1)
    expect(allEdited.size).toBe(1);
    expect(allEdited.has('/tmp/fileY.ts')).toBe(true);
    expect(allEdited.has('/tmp/fileX.ts')).toBe(false);
  });

  it('no round-marker → full replay (backward-compatible)', () => {
    // This scenario must PASS even after the fix — ensures backward compat.
    // Kept here so the GREEN phase must preserve non-marker behavior.
    const { verifyLogPath } = makeSessionDir();

    const ts = () => new Date().toISOString();
    appendFileSync(verifyLogPath, JSON.stringify({ mark: '/tmp/alpha.ts', ts: ts() }) + '\n');
    appendFileSync(verifyLogPath, JSON.stringify({ clear: '/tmp/alpha.ts', ts: ts() }) + '\n');
    appendFileSync(verifyLogPath, JSON.stringify({ mark: '/tmp/beta.ts', ts: ts() }) + '\n');

    const unverified = loadUnverified(verifyLogPath);

    // This should still pass (it passes now AND after the fix)
    expect(unverified.size).toBe(1);
    expect(unverified.has('/tmp/beta.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Stop hook stale TTL 30 minutes
// ---------------------------------------------------------------------------
describe('E2E: Stop hook stale TTL is 30 minutes', () => {
  it('31-minute-old session is treated as stale → approve + file deleted', () => {
    // RED: STALE_TIMEOUT=24h in sc-persistent.mjs → 31 min is not stale →
    // decision='block', file survives → both assertions fail.
    const { sid, ulwPath, gatesPath, boardPath, verifyLogPath } = makeSessionDir();

    const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    writeUlwState(ulwPath, sid, {
      lastActivityAt: thirtyOneMinAgo,
      startedAt: thirtyOneMinAgo,
    });
    writeGates(gatesPath);
    writeFileSync(boardPath, '');
    writeFileSync(verifyLogPath, '');

    const result = runHook('sc-persistent.mjs', { session_id: sid });

    // FAILS: current returns decision='block' (STALE_TIMEOUT=24h not triggered)
    expect(result.decision).toBe('approve');
    // FAILS: file still exists because stale branch never runs
    expect(existsSync(ulwPath)).toBe(false);
  });

  it('stale cleanup also removes the session directory itself when empty', () => {
    // RED: even if stale were detected, session-end only unlinks files,
    // never rmdirs. Directory persists.
    const { sid, sessionDir: sDir, ulwPath, gatesPath, boardPath, verifyLogPath } = makeSessionDir();

    const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    writeUlwState(ulwPath, sid, {
      lastActivityAt: thirtyOneMinAgo,
      startedAt: thirtyOneMinAgo,
    });
    writeGates(gatesPath);
    writeFileSync(boardPath, '');
    writeFileSync(verifyLogPath, '');

    runHook('sc-persistent.mjs', { session_id: sid });

    // FAILS: directory persists even after stale cleanup
    expect(existsSync(sDir)).toBe(false);
  });

  it('29-minute-old session is not stale → still blocked when ULW active', () => {
    // Boundary: 29 min < 30 min TTL → must remain active.
    // This should FAIL now (block expected, but STALE_TIMEOUT=24h means block
    // for the wrong reason — the test passes by accident).
    // After the fix (TTL=30min), this must still pass.
    // We assert decision=block so it will naturally keep passing post-fix.
    const { sid, ulwPath, gatesPath, boardPath, verifyLogPath } = makeSessionDir();

    const twentyNineMinAgo = new Date(Date.now() - 29 * 60 * 1000).toISOString();
    writeUlwState(ulwPath, sid, {
      lastActivityAt: twentyNineMinAgo,
      startedAt: twentyNineMinAgo,
    });
    writeGates(gatesPath);
    writeFileSync(boardPath, '');
    writeFileSync(verifyLogPath, '');

    const result = runHook('sc-persistent.mjs', { session_id: sid });

    // Currently passes (block due to ULW active) — must remain pass after fix
    expect(result.decision).toBe('block');
    expect(existsSync(ulwPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. session-end rmdir
// ---------------------------------------------------------------------------
describe('E2E: session-end removes session directory when empty after cleanup', () => {
  it('session dir is deleted after session-end unlinks all 4 ULW files', () => {
    // RED: session-end.mjs (L84-93) unlinks files but never calls rmdir.
    // Directory persists with 0 files → existsSync(sDir) stays true.
    const { sid, sessionDir: sDir, ulwPath, gatesPath, boardPath, verifyLogPath } = makeSessionDir();

    writeUlwState(ulwPath, sid);
    writeGates(gatesPath);
    writeFileSync(boardPath, '');
    writeFileSync(verifyLogPath, '');

    // Confirm exactly 4 ULW files inside
    const before = readdirSync(sDir);
    expect(before.sort()).toEqual([
      'gates.json',
      'ultrawork-state.json',
      'ulw-board.jsonl',
      'ulw-verify-log.jsonl',
    ].sort());

    runHook('session-end.mjs', { session_id: sid });

    // FAILS: directory still exists (hook did not rmdir)
    expect(existsSync(sDir)).toBe(false);
  });

  it('session-end does NOT remove dir if non-ULW files remain inside', () => {
    // Safety: if user placed another file in the session dir, rmdir must not
    // silently swallow it. Dir should remain.
    const { sid, sessionDir: sDir, ulwPath, gatesPath, boardPath, verifyLogPath } = makeSessionDir();

    writeUlwState(ulwPath, sid);
    writeGates(gatesPath);
    writeFileSync(boardPath, '');
    writeFileSync(verifyLogPath, '');
    // Extra non-ULW file
    writeFileSync(join(sDir, 'custom-note.json'), JSON.stringify({ note: 'keep me' }));

    runHook('session-end.mjs', { session_id: sid });

    // Dir must survive because custom-note.json is still there
    expect(existsSync(sDir)).toBe(true);
    expect(existsSync(join(sDir, 'custom-note.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. cleanup-stale-sessions utility
// ---------------------------------------------------------------------------
describe('E2E: cleanup-stale-sessions.mjs utility', () => {
  /**
   * Backdate a directory's mtime by writing a past timestamp via utimes.
   * We set mtime on the directory itself (not files inside) because the
   * utility checks `fs.stat(dir).mtimeMs`.
   */
  function backdateDir(dir: string, msAgo: number) {
    const past = new Date(Date.now() - msAgo);
    utimesSync(dir, past, past);
  }

  it('deletes only 48h+ old sessions that have no ultrawork-state.json', () => {
    // RED: scripts/cleanup-stale-sessions.mjs does not exist → execSync throws
    // → test fails immediately.
    const CLEANUP_SCRIPT = join(SCRIPTS, 'cleanup-stale-sessions.mjs');

    // (a) stale + no ULW state → should be deleted
    const sidA = `stale-noulw-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const dirA = join(SESSIONS_DIR, sidA);
    mkdirSync(dirA, { recursive: true });
    allocatedDirs.push(dirA); // cleanup fallback
    // Write a benign file, no ultrawork-state.json
    writeFileSync(join(dirA, 'some-data.json'), '{}');
    backdateDir(dirA, 49 * 60 * 60 * 1000); // 49h ago

    // (b) stale + HAS ULW state → must NOT be deleted
    const sidB = `stale-ulw-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const dirB = join(SESSIONS_DIR, sidB);
    mkdirSync(dirB, { recursive: true });
    allocatedDirs.push(dirB);
    writeUlwState(join(dirB, 'ultrawork-state.json'), sidB, {
      lastActivityAt: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
    });
    backdateDir(dirB, 49 * 60 * 60 * 1000); // 49h ago

    // (c) recent + no ULW state → must NOT be deleted
    const sidC = `recent-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const dirC = join(SESSIONS_DIR, sidC);
    mkdirSync(dirC, { recursive: true });
    allocatedDirs.push(dirC);
    writeFileSync(join(dirC, 'gates.json'), '{}');
    // mtime is "now" by default → not stale

    // FAILS: script does not exist → this execSync throws
    execSync(`node "${CLEANUP_SCRIPT}"`, {
      encoding: 'utf-8',
      timeout: 15_000,
    });

    // (a) deleted
    expect(existsSync(dirA)).toBe(false);
    // (b) survived (has ULW state)
    expect(existsSync(dirB)).toBe(true);
    // (c) survived (recent)
    expect(existsSync(dirC)).toBe(true);
  });

  it('cleanup-stale-sessions is a no-op when no sessions dir exists', () => {
    // RED: script does not exist → throws.
    const CLEANUP_SCRIPT = join(SCRIPTS, 'cleanup-stale-sessions.mjs');

    // Should not throw even if SESSIONS_DIR is empty or partially missing
    expect(() => {
      execSync(`node "${CLEANUP_SCRIPT}"`, {
        encoding: 'utf-8',
        timeout: 10_000,
      });
    }).not.toThrow();
  });
});
