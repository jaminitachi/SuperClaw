/**
 * ULW Verify Log — Event Log Semantics + Bug Regression Tests
 *
 * These tests pin down the behavior of the single append-only JSONL verify
 * log that replaced the previous 2-set (edited/verified) design. The 2-set
 * design had a correctness bug: once a file appeared in the verified set,
 * Set.add() was a no-op and the re-edit after verification was invisible.
 *
 * The bug regression test (the RE-EDIT scenario) walks the full hook
 * pipeline: Write → Read → Write → Stop, and asserts that the Stop hook
 * correctly blocks on the re-edit. Without the fix this test would report
 * unverified=∅ and the Stop hook would approve — both wrong.
 *
 * Lives in the e2e suite (filename prefix e2e-*) so pool:'forks' +
 * singleFork serialization applies, matching the rest of the hook tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
// @ts-ignore — plain .mjs module, no types
import { loadUnverified, loadAllEdited, markEdited, markVerified } from '../scripts/lib/ulw-verify-log.mjs';

const SCRIPTS = join(homedir(), 'superclaw', 'scripts');
const STATE_DIR = join(homedir(), '.claude', '.sc', 'state');

// Track every session dir we create so afterEach can tear them all down
// even if a test allocates multiple.
const createdSessionDirs: string[] = [];

function makeSessionDir(): { sid: string; sessionDir: string; logPath: string } {
  const sid = `verify-log-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const sessionDir = join(STATE_DIR, 'sessions', sid);
  mkdirSync(sessionDir, { recursive: true });
  createdSessionDirs.push(sessionDir);
  return { sid, sessionDir, logPath: join(sessionDir, 'ulw-verify-log.jsonl') };
}

function seedUlw(sessionDir: string, sid: string, gatesOverride: object = {}) {
  writeFileSync(join(sessionDir, 'ultrawork-state.json'), JSON.stringify({
    active: true,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    mode: 'po-team',
    sessionId: sid,
  }));
  writeFileSync(join(sessionDir, 'gates.json'), JSON.stringify({
    planApproved: true,
    tddRequired: false,
    testsExist: true,
    testsRun: true,
    testsPassed: true,
    ultraworkActive: true,
    ...gatesOverride,
  }));
}

function runHook(script: string, input: Record<string, any>): any {
  try {
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

afterEach(() => {
  while (createdSessionDirs.length > 0) {
    const dir = createdSessionDirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// ===========================================================================
// Unit-level event log semantics — exercises the lib module directly.
// ===========================================================================
describe('ulw-verify-log: event replay semantics', () => {
  it('returns empty sets for nonexistent log file', () => {
    const logPath = join(STATE_DIR, 'sessions', `nonexistent-${Date.now()}`, 'ulw-verify-log.jsonl');
    expect(loadUnverified(logPath).size).toBe(0);
    expect(loadAllEdited(logPath).size).toBe(0);
  });

  it('returns empty sets for empty log file', () => {
    const { logPath } = makeSessionDir();
    writeFileSync(logPath, '');
    expect(loadUnverified(logPath).size).toBe(0);
    expect(loadAllEdited(logPath).size).toBe(0);
  });

  it('single mark event → file is unverified + ever-edited', () => {
    const { logPath } = makeSessionDir();
    markEdited(logPath, '/a.ts');
    expect([...loadUnverified(logPath)]).toEqual(['/a.ts']);
    expect([...loadAllEdited(logPath)]).toEqual(['/a.ts']);
  });

  it('mark then clear → not unverified, still ever-edited', () => {
    const { logPath } = makeSessionDir();
    markEdited(logPath, '/a.ts');
    markVerified(logPath, '/a.ts');
    expect(loadUnverified(logPath).size).toBe(0);
    expect([...loadAllEdited(logPath)]).toEqual(['/a.ts']);
  });

  it('mark → clear → mark → unverified contains file (REGRESSION)', () => {
    // This is the exact semantic the old 2-set code got wrong.
    // In the old design, verified.add('/a.ts') made the file permanently
    // verified; the second edit did not re-open it.
    const { logPath } = makeSessionDir();
    markEdited(logPath, '/a.ts');
    markVerified(logPath, '/a.ts');
    markEdited(logPath, '/a.ts');
    expect([...loadUnverified(logPath)]).toEqual(['/a.ts']);
    expect([...loadAllEdited(logPath)]).toEqual(['/a.ts']);
  });

  it('interleaved events across multiple files replay correctly', () => {
    const { logPath } = makeSessionDir();
    markEdited(logPath, '/a.ts');
    markEdited(logPath, '/b.ts');
    markVerified(logPath, '/a.ts');
    markEdited(logPath, '/c.ts');
    markVerified(logPath, '/b.ts');
    markEdited(logPath, '/a.ts'); // re-edit
    // Final unverified: a (re-edited), c (never verified)
    const unverified = new Set(loadUnverified(logPath));
    expect(unverified).toEqual(new Set(['/a.ts', '/c.ts']));
    // Ever-edited: all three
    const everEdited = new Set(loadAllEdited(logPath));
    expect(everEdited).toEqual(new Set(['/a.ts', '/b.ts', '/c.ts']));
  });

  it('tolerates corrupt lines without losing valid events', () => {
    const { logPath } = makeSessionDir();
    appendFileSync(logPath, JSON.stringify({ mark: '/a.ts', ts: 't' }) + '\n');
    appendFileSync(logPath, 'this is not json\n');
    appendFileSync(logPath, '{"broken":\n'); // truncated JSON
    appendFileSync(logPath, JSON.stringify({ mark: '/b.ts', ts: 't' }) + '\n');
    const unverified = new Set(loadUnverified(logPath));
    expect(unverified).toEqual(new Set(['/a.ts', '/b.ts']));
  });

  it('ignores events with non-string mark/clear values', () => {
    const { logPath } = makeSessionDir();
    appendFileSync(logPath, JSON.stringify({ mark: 42, ts: 't' }) + '\n');
    appendFileSync(logPath, JSON.stringify({ mark: null, ts: 't' }) + '\n');
    appendFileSync(logPath, JSON.stringify({ clear: {}, ts: 't' }) + '\n');
    appendFileSync(logPath, JSON.stringify({ mark: '/valid.ts', ts: 't' }) + '\n');
    expect([...loadUnverified(logPath)]).toEqual(['/valid.ts']);
  });
});

// ===========================================================================
// BUG REGRESSION — full hook pipeline: Write → Read → Write → Stop
// ===========================================================================
describe('ULW re-edit after verify (bug regression)', () => {
  it('correctly flags re-edited file as unverified even after prior verification', () => {
    const { sid, sessionDir, logPath } = makeSessionDir();
    seedUlw(sessionDir, sid);

    const target = `/tmp/test-reedit-target-${Date.now()}.ts`;

    // ---- T0: first Write → should append a "mark" event ----
    runHook('sc-post-tool.mjs', {
      session_id: sid,
      tool_name: 'Write',
      tool_input: { file_path: target, content: 'v1' },
      tool_response: 'ok',
    });
    expect([...loadUnverified(logPath)]).toEqual([target]);

    // ---- T1: Read → should append a "clear" event ----
    runHook('sc-post-tool.mjs', {
      session_id: sid,
      tool_name: 'Read',
      tool_input: { file_path: target },
      tool_response: 'v1',
    });
    // Sanity: between T1 and T2, unverified is empty.
    expect(loadUnverified(logPath).size).toBe(0);
    // But the file IS in the "ever edited" set — this is what gates the
    // Sisyphus "미검증" branch in sc-persistent.mjs.
    expect(loadAllEdited(logPath).has(target)).toBe(true);

    // ---- T2: second Write (the re-edit the old code missed) ----
    runHook('sc-post-tool.mjs', {
      session_id: sid,
      tool_name: 'Write',
      tool_input: { file_path: target, content: 'v2' },
      tool_response: 'ok',
    });
    // The CORE ASSERTION — the old 2-set code failed here.
    expect([...loadUnverified(logPath)]).toEqual([target]);
    expect([...loadAllEdited(logPath)]).toEqual([target]);

    // ---- T3: Stop hook must block ----
    // (Old 2-set code: verified.has(target) was true, so the unverified
    // computation yielded ∅ and Stop hook would approve. Wrong.)
    const stopResult = runHook('sc-persistent.mjs', {
      session_id: sid,
      stop_hook_active: false,
    });
    expect(stopResult.decision).toBe('block');
    // Reason string format: "SuperClaw Sisyphus: ULW 모드 진행 중 ..., PO 검증 미완료 — 미검증 파일 1개: ..."
    expect(stopResult.reason).toContain('미검증');
    // basename(target) should appear in the reason string
    const basename = target.split('/').pop()!;
    expect(stopResult.reason).toContain(basename);
  });

  it('verified → re-edit → re-verify → Stop approves (the "fixed" path)', () => {
    const { sid, sessionDir, logPath } = makeSessionDir();
    seedUlw(sessionDir, sid);

    const target = `/tmp/test-reedit-resolved-${Date.now()}.ts`;

    // Write → Read → Write → Read → Stop
    runHook('sc-post-tool.mjs', { session_id: sid, tool_name: 'Write', tool_input: { file_path: target, content: 'v1' }, tool_response: 'ok' });
    runHook('sc-post-tool.mjs', { session_id: sid, tool_name: 'Read',  tool_input: { file_path: target },                tool_response: 'v1' });
    runHook('sc-post-tool.mjs', { session_id: sid, tool_name: 'Write', tool_input: { file_path: target, content: 'v2' }, tool_response: 'ok' });
    runHook('sc-post-tool.mjs', { session_id: sid, tool_name: 'Read',  tool_input: { file_path: target },                tool_response: 'v2' });

    // After the final Read, unverified is empty (file is re-verified).
    expect(loadUnverified(logPath).size).toBe(0);
    // But the file remains in the "ever-edited" audit trail.
    expect(loadAllEdited(logPath).has(target)).toBe(true);

    // Stop hook still blocks because ULW is active (Sisyphus intent) —
    // but the reason must NOT contain "미검증" because everything is
    // re-verified.
    const stopResult = runHook('sc-persistent.mjs', { session_id: sid, stop_hook_active: false });
    expect(stopResult.decision).toBe('block');
    expect(stopResult.reason).not.toContain('미검증');
  });
});

// ===========================================================================
// Race safety — smoke test for many interleaved appends
// ===========================================================================
describe('ulw-verify-log: append safety under many writes', () => {
  it('200 serial markEdited calls do not lose writes', () => {
    const { logPath } = makeSessionDir();
    const N = 200;
    const files = Array.from({ length: N }, (_, i) => `/tmp/race-${i}.ts`);
    // Serial appends — exercises the append-only path and replay for a
    // realistic-sized log. This is NOT a real concurrency test; it
    // establishes that no data is lost in the common case.
    for (const f of files) markEdited(logPath, f);
    const unverified = loadUnverified(logPath);
    expect(unverified.size).toBe(N);
    for (const f of files) expect(unverified.has(f)).toBe(true);
  });

  it('interleaved mark/clear pairs for 100 files leave unverified empty', () => {
    const { logPath } = makeSessionDir();
    const N = 100;
    const files = Array.from({ length: N }, (_, i) => `/tmp/pair-${i}.ts`);
    for (const f of files) {
      markEdited(logPath, f);
      markVerified(logPath, f);
    }
    expect(loadUnverified(logPath).size).toBe(0);
    expect(loadAllEdited(logPath).size).toBe(N);
  });

  it('raw appendFileSync interleaved with markEdited produces the same replay', () => {
    // Mixes the high-level API with a direct appendFileSync to prove that
    // the wire format is stable and both entry points land in the same
    // replay semantics.
    const { logPath } = makeSessionDir();
    markEdited(logPath, '/x.ts');
    appendFileSync(logPath, JSON.stringify({ mark: '/y.ts', ts: new Date().toISOString() }) + '\n');
    markVerified(logPath, '/x.ts');
    appendFileSync(logPath, JSON.stringify({ clear: '/y.ts', ts: new Date().toISOString() }) + '\n');
    markEdited(logPath, '/x.ts'); // re-edit via API
    appendFileSync(logPath, JSON.stringify({ mark: '/y.ts', ts: new Date().toISOString() }) + '\n'); // re-edit raw
    const unverified = new Set(loadUnverified(logPath));
    expect(unverified).toEqual(new Set(['/x.ts', '/y.ts']));
  });
});

describe('ulw-verify-log: error logging (L4)', () => {
  const HOOK_LOG = join(homedir(), 'superclaw', 'data', 'logs', 'hooks.log');

  // Snapshot hooks.log as a Buffer (bytes, not chars) so multibyte content
  // in the existing log doesn't offset our diff.
  async function snapshotHookLog(): Promise<Buffer> {
    const fs = await import('fs');
    try { return fs.readFileSync(HOOK_LOG); }
    catch { return Buffer.alloc(0); }
  }

  async function diffSince(before: Buffer): Promise<string> {
    const fs = await import('fs');
    const after = fs.readFileSync(HOOK_LOG);
    return after.slice(before.length).toString('utf-8');
  }

  it('logs appendEvent failures to hooks.log instead of silently dropping', async () => {
    // Force an append failure by passing a path whose parent is a FILE, not a dir.
    // mkdirSync({recursive:true}) on a path whose segment is a file → ENOTDIR.
    const { sessionDir } = makeSessionDir();
    const blocker = join(sessionDir, 'blocker');
    writeFileSync(blocker, 'I am a file, not a directory');
    const unreachable = join(blocker, 'ulw-verify-log.jsonl');

    const before = await snapshotHookLog();
    markEdited(unreachable, '/tmp/trigger-failure.ts');
    await new Promise(r => setTimeout(r, 20));
    const diff = await diffSince(before);

    expect(diff).toContain('[ERROR] [ulw-verify-log/appendEvent]');
  });

  it('loadUnverified corrupt-line errors are logged (not silently swallowed)', async () => {
    const { logPath } = makeSessionDir();
    // Valid + garbage mix
    writeFileSync(logPath, '{"mark":"/a.ts","ts":"2026-01-01T00:00:00Z"}\nGARBAGE NOT JSON\n{"mark":"/b.ts","ts":"2026-01-01T00:00:01Z"}\n');

    const before = await snapshotHookLog();
    const unverified = loadUnverified(logPath);
    await new Promise(r => setTimeout(r, 20));
    const diff = await diffSince(before);

    expect(unverified).toEqual(new Set(['/a.ts', '/b.ts']));
    expect(diff).toContain('[ERROR] [ulw-verify-log/loadUnverified/parse]');
  });
});
