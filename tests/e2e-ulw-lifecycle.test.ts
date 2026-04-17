/**
 * E2E Behavioral Tests — Superpowers-style
 *
 * Tests the BEHAVIOR of SuperClaw's hook system, not individual functions.
 * Each test simulates a real hook invocation via stdin→stdout and verifies
 * that the system enforces rules correctly.
 *
 * Pressure scenarios test that gates hold under adversarial conditions.
 *
 * All state is session-scoped under ~/.claude/.sc/state/sessions/{TEST_SID}/.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, appendFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
// @ts-ignore — plain .mjs module, no types
import { loadUnverified, loadAllEdited } from '../scripts/lib/ulw-verify-log.mjs';

const SCRIPTS = join(homedir(), 'superclaw', 'scripts');
const STATE_DIR = join(homedir(), '.claude', '.sc', 'state');

const TEST_SID = `test-${Date.now()}-${randomUUID().slice(0, 8)}`;
const SESSION_DIR = join(STATE_DIR, 'sessions', TEST_SID);
const GATES_PATH = join(SESSION_DIR, 'gates.json');
const ULW_PATH = join(SESSION_DIR, 'ultrawork-state.json');
const VERIFY_LOG_PATH = join(SESSION_DIR, 'ulw-verify-log.jsonl');

// --- verify-log seeding helpers -------------------------------------------
// Append-only event format matching scripts/lib/ulw-verify-log.mjs.
// These bypass the production API so tests can craft exact log states
// without depending on the hook pipeline.
function seedEdited(files: string[]) {
  mkdirSync(SESSION_DIR, { recursive: true });
  for (const f of files) {
    appendFileSync(VERIFY_LOG_PATH, JSON.stringify({ mark: f, ts: new Date().toISOString() }) + '\n');
  }
}
function seedVerified(files: string[]) {
  mkdirSync(SESSION_DIR, { recursive: true });
  for (const f of files) {
    appendFileSync(VERIFY_LOG_PATH, JSON.stringify({ clear: f, ts: new Date().toISOString() }) + '\n');
  }
}
function resetVerifyLog() {
  try { unlinkSync(VERIFY_LOG_PATH); } catch {}
}

// Helper: run a hook script with JSON stdin, return parsed JSON output.
// Auto-injects session_id so every hook call is session-scoped.
function runHook(script: string, input: Record<string, any>): any {
  const payload = { session_id: TEST_SID, ...input };
  try {
    // Pass JSON via execSync's `input` option (stdin) to avoid shell escaping
    // pitfalls with $ or backticks inside the payload.
    const result = execSync(`node "${join(SCRIPTS, script)}"`, {
      encoding: 'utf-8',
      timeout: 8000,
      input: JSON.stringify(payload),
    });
    return JSON.parse(result.trim());
  } catch (e: any) {
    const out = e.stdout?.trim() || e.stderr?.trim() || '';
    try { return JSON.parse(out); } catch { return { raw: out, exitCode: e.status }; }
  }
}

function writeGates(gates: object) {
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(GATES_PATH, JSON.stringify(gates, null, 2));
}

function readGates(): any {
  return JSON.parse(readFileSync(GATES_PATH, 'utf-8'));
}

function writeUlwState(state: object = {}) {
  mkdirSync(SESSION_DIR, { recursive: true });
  const merged = { sessionId: TEST_SID, ...state };
  writeFileSync(ULW_PATH, JSON.stringify(merged, null, 2));
}

function cleanup() {
  try { rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// 1. ULW LIFECYCLE E2E
// ============================================================================
describe('E2E: ULW Full Lifecycle', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('keyword-detector creates gates.json + ultrawork-state.json on "ulw"', () => {
    const result = runHook('sc-keyword-detector.mjs', { prompt: 'ulw 해줘' });

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toContain('ultrawork');
    expect(existsSync(GATES_PATH)).toBe(true);
    expect(existsSync(ULW_PATH)).toBe(true);

    const gates = readGates();
    expect(gates.planApproved).toBe(false);
    expect(gates.testsExist).toBe(false);
    expect(gates.testsRun).toBe(false);
    expect(gates.ultraworkActive).toBe(true);
  });

  it('full lifecycle: init → TDD gate → test write → prod write → test run → verify → stop', () => {
    // Step 1: Init ULW
    runHook('sc-keyword-detector.mjs', { prompt: 'ultrawork' });
    expect(readGates().ultraworkActive).toBe(true);

    // Step 2: TDD Gate — production Write should be warned/blocked
    const prodWrite = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/test-app.ts' },
    });
    // With block:true, pre-tool should block when testsExist=false
    const gates1 = readGates();
    expect(gates1.testsExist).toBe(false); // still false, no test written yet

    // Step 3: Test file Write — should pass and set testsExist=true
    runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/test-app.test.ts' },
    });
    const gates2 = readGates();
    expect(gates2.testsExist).toBe(true); // NOW true

    // Step 4: Post-tool Edit tracking — Edit emits a "mark" event
    runHook('sc-post-tool.mjs', {
      tool_name: 'Edit',
      tool_input: { file_path: '/tmp/test-app.ts' },
      tool_response: 'File edited successfully',
    });
    const allEdited = loadAllEdited(VERIFY_LOG_PATH);
    expect(allEdited.has('/tmp/test-app.ts')).toBe(true);

    // Step 5: Test execution detection
    runHook('sc-post-tool.mjs', {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: '✓ 5 tests passed',
    });
    const gates3 = readGates();
    expect(gates3.testsRun).toBe(true);
    expect(gates3.testsPassed).toBe(true);

    // Step 6: PO Read verification — Read emits a "clear" event, so the file
    // is no longer in the unverified set. It remains in loadAllEdited though.
    runHook('sc-post-tool.mjs', {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test-app.ts' },
      tool_response: 'file contents...',
    });
    const unverified = loadUnverified(VERIFY_LOG_PATH);
    expect(unverified.has('/tmp/test-app.ts')).toBe(false);
    expect(loadAllEdited(VERIFY_LOG_PATH).has('/tmp/test-app.ts')).toBe(true);

    // Step 7: Stop hook — still blocks because ULW is active (Sisyphus intent)
    const stop1 = runHook('sc-persistent.mjs', { stop_hook_active: false });
    expect(stop1.decision).toBe('block');

    // Step 8: Delete ULW state (Step 5 COMPLETE) → now approves
    try { unlinkSync(ULW_PATH); } catch {}
    const stop2 = runHook('sc-persistent.mjs', {});
    expect(stop2.decision).toBe('approve');
  });
});

// ============================================================================
// 2. HARD GATE BEHAVIORAL TESTS
// ============================================================================
describe('E2E: HARD GATE Enforcement', () => {
  beforeEach(() => {
    cleanup();
    writeGates({ planApproved: false, tddRequired: true, testsExist: false, testsRun: false, ultraworkActive: true });
    writeUlwState({ active: true, startedAt: new Date().toISOString(), mode: 'po-team' });
  });
  afterEach(() => cleanup());

  it('blocks production code Write when gates are closed', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/app.ts' },
    });
    // New schema: deny via hookSpecificOutput.permissionDecision
    const hso = result.hookSpecificOutput;
    expect(hso?.permissionDecision).toBe('deny');
    expect(hso?.permissionDecisionReason ?? '').toContain('GATE');
  });

  it('allows test file Write even when gates are closed', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/app.test.ts' },
    });
    expect(result.continue).toBe(true);
  });

  it('allows Read/Grep without any gate check', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/anything.ts' },
    });
    expect(result.continue).toBe(true);
  });

  it('allows plan file Write even when gates are closed', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: join(homedir(), '.claude', 'plans', 'test-plan.md') },
    });
    expect(result.continue).toBe(true);
  });
});

// ============================================================================
// 3. SISYPHUS BEHAVIORAL TESTS
// ============================================================================
describe('E2E: Sisyphus Stop Hook', () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(SESSION_DIR, { recursive: true });
  });
  afterEach(() => cleanup());

  it('blocks exit when ULW is active', () => {
    writeUlwState({ active: true, startedAt: new Date().toISOString(), mode: 'po-team' });
    // Empty verify log — the file is created by the hook on first event, so
    // "no edits yet" is represented by the log being absent/empty.
    resetVerifyLog();
    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('ULW');
  });

  it('blocks exit when files are unverified', () => {
    writeUlwState({ active: true, startedAt: new Date().toISOString(), mode: 'po-team' });
    resetVerifyLog();
    seedEdited(['/tmp/unverified.ts']); // mark only, no clear
    writeGates({ testsRun: true, testsPassed: true });

    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('미검증');
  });

  it('blocks exit when tests not run', () => {
    writeUlwState({ active: true, startedAt: new Date().toISOString(), mode: 'po-team' });
    resetVerifyLog();
    seedEdited(['/tmp/app.ts']);
    seedVerified(['/tmp/app.ts']); // cleared → unverified is empty, but log is non-empty
    writeGates({ testsRun: false });

    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('테스트');
  });

  it('blocks exit when tests failed', () => {
    writeUlwState({ active: true, startedAt: new Date().toISOString(), mode: 'po-team' });
    resetVerifyLog();
    seedEdited(['/tmp/app.ts']);
    seedVerified(['/tmp/app.ts']);
    writeGates({ testsRun: true, testsPassed: false });

    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('실패');
  });

  it('blocks exit even when verified — ULW must be explicitly completed', () => {
    writeUlwState({ active: true, startedAt: new Date().toISOString(), mode: 'po-team' });
    resetVerifyLog();
    seedEdited(['/tmp/app.ts']);
    seedVerified(['/tmp/app.ts']);
    writeGates({ testsRun: true, testsPassed: true });

    const result = runHook('sc-persistent.mjs', {});
    // Sisyphus: ULW active = always block (even when all verified)
    // PO must delete ultrawork-state.json to complete
    expect(result.decision).toBe('block');
  });

  it('approves exit after ULW state is deleted (Step 5 COMPLETE)', () => {
    // No ULW state, no gates
    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('approve');
  });

  it('approves exit when no ULW state exists', () => {
    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('approve');
  });

  it('auto-cleans stale ULW state (>24h)', () => {
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeUlwState({ active: true, startedAt: staleTime, lastActivityAt: staleTime, mode: 'po-team' });

    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('approve');
    expect(existsSync(ULW_PATH)).toBe(false); // auto-deleted
  });
});

// ============================================================================
// 4. TEST RESULT DETECTION
// ============================================================================
describe('E2E: Test Result Detection', () => {
  beforeEach(() => {
    cleanup();
    writeGates({ planApproved: true, tddRequired: true, testsExist: true, testsRun: false, ultraworkActive: true });
    writeUlwState({ active: true, startedAt: new Date().toISOString(), mode: 'po-team' });
    // Verify log starts empty — hooks will append events as needed.
  });
  afterEach(() => cleanup());

  it('detects passing tests → testsPassed=true', () => {
    runHook('sc-post-tool.mjs', {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: '10 passed, 0 failed. All tests passed.',
    });
    const gates = readGates();
    expect(gates.testsRun).toBe(true);
    expect(gates.testsPassed).toBe(true);
  });

  it('detects failing tests → testsPassed=false', () => {
    runHook('sc-post-tool.mjs', {
      tool_name: 'Bash',
      tool_input: { command: 'vitest run' },
      tool_response: 'Tests: 3 passed, 2 FAIL',
    });
    const gates = readGates();
    expect(gates.testsRun).toBe(true);
    expect(gates.testsPassed).toBe(false);
  });

  it('detects various test frameworks', () => {
    const frameworks = ['pnpm test', 'yarn test', 'bun test', 'pytest', 'cargo test', 'go test', 'deno test'];
    for (const cmd of frameworks) {
      writeGates({ testsRun: false, ultraworkActive: true });
      runHook('sc-post-tool.mjs', {
        tool_name: 'Bash',
        tool_input: { command: cmd },
        tool_response: 'All tests passed',
      });
      const gates = readGates();
      expect(gates.testsRun).toBe(true);
    }
  });

  it('ignores non-test Bash commands', () => {
    runHook('sc-post-tool.mjs', {
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      tool_response: 'total 42',
    });
    const gates = readGates();
    expect(gates.testsRun).toBe(false);
  });
});

// ============================================================================
// 5. FILE TRACKING
// ============================================================================
describe('E2E: File Edit/Verify Tracking', () => {
  beforeEach(() => {
    cleanup();
    writeGates({ ultraworkActive: true });
    writeUlwState({ active: true, startedAt: new Date().toISOString(), mode: 'po-team' });
    // No verify-log seeding — hooks append events themselves.
  });
  afterEach(() => cleanup());

  it('tracks Edit → appends mark event to verify log', () => {
    runHook('sc-post-tool.mjs', {
      tool_name: 'Edit',
      tool_input: { file_path: '/tmp/tracked.ts' },
      tool_response: 'OK',
    });
    const unverified = loadUnverified(VERIFY_LOG_PATH);
    expect(unverified.has('/tmp/tracked.ts')).toBe(true);
    expect(loadAllEdited(VERIFY_LOG_PATH).has('/tmp/tracked.ts')).toBe(true);
  });

  it('tracks Write → appends mark event to verify log', () => {
    runHook('sc-post-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/new-file.ts' },
      tool_response: 'OK',
    });
    const unverified = loadUnverified(VERIFY_LOG_PATH);
    expect(unverified.has('/tmp/new-file.ts')).toBe(true);
  });

  it('Read of edited file → clear event removes it from unverified', () => {
    seedEdited(['/tmp/tracked.ts']);
    runHook('sc-post-tool.mjs', {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/tracked.ts' },
      tool_response: 'contents',
    });
    const unverified = loadUnverified(VERIFY_LOG_PATH);
    expect(unverified.has('/tmp/tracked.ts')).toBe(false);
    // But it should still be in "all ever edited" — used for compaction tags.
    expect(loadAllEdited(VERIFY_LOG_PATH).has('/tmp/tracked.ts')).toBe(true);
  });

  it('Read of non-edited file still emits clear event (no-op on replay)', () => {
    // Production hook unconditionally appends a clear on Read. Since the
    // file was never marked, replay still produces an empty unverified set.
    runHook('sc-post-tool.mjs', {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/random.ts' },
      tool_response: 'contents',
    });
    const unverified = loadUnverified(VERIFY_LOG_PATH);
    expect(unverified.has('/tmp/random.ts')).toBe(false);
    // It's not in the "ever marked" set either.
    expect(loadAllEdited(VERIFY_LOG_PATH).has('/tmp/random.ts')).toBe(false);
  });
});

// ============================================================================
// 6. PRESSURE TESTS (Superpowers-style)
// ============================================================================
describe('E2E: Pressure Tests — Adversarial Scenarios', () => {
  beforeEach(() => {
    cleanup();
    writeGates({ planApproved: true, tddRequired: true, testsExist: false, testsRun: false, ultraworkActive: true });
    writeUlwState({ active: true, startedAt: new Date().toISOString(), mode: 'po-team' });
  });
  afterEach(() => cleanup());

  it('PRESSURE: cannot bypass TDD by writing prod code before tests', () => {
    // Adversary: "I already wrote the code, let me skip tests"
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/bypass-attempt.ts' },
    });
    const hso = result.hookSpecificOutput;
    expect(hso?.permissionDecision).toBe('deny');
    expect(hso?.permissionDecisionReason ?? '').toContain('TDD');
    expect(readGates().testsExist).toBe(false); // gate still closed
  });

  it('PRESSURE: cannot claim tests passed when they failed', () => {
    writeGates({ planApproved: true, tddRequired: true, testsExist: true, testsRun: false, ultraworkActive: true });
    runHook('sc-post-tool.mjs', {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: 'FAIL 3 tests failed',
    });
    const gates = readGates();
    expect(gates.testsPassed).toBe(false);

    // Try to exit — should be blocked. Seed verify log so the Sisyphus
    // reasons branch is exercised (reasons only emit when ever-edited > 0).
    seedEdited(['/tmp/app.ts']);
    seedVerified(['/tmp/app.ts']);
    const stop = runHook('sc-persistent.mjs', {});
    expect(stop.decision).toBe('block');
    expect(stop.reason).toContain('실패');
  });

  it('PRESSURE: cannot exit without reading edited files', () => {
    writeGates({ ...readGates(), testsExist: true, testsRun: true, testsPassed: true });
    seedEdited(['/tmp/sneaky.ts']); // PO never Read it → mark with no clear

    const stop = runHook('sc-persistent.mjs', {});
    expect(stop.decision).toBe('block');
    expect(stop.reason).toContain('미검증');
  });

  it('PRESSURE: stale detection does not trigger within 24h of activity', () => {
    // Session started 23 hours ago but had recent activity
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    writeUlwState({
      active: true,
      startedAt: twentyThreeHoursAgo,
      lastActivityAt: fiveMinAgo,
      mode: 'po-team',
    });
    // Fresh verify log — no events yet; Sisyphus still blocks on ULW active.
    resetVerifyLog();

    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('block'); // should still be active
    expect(existsSync(ULW_PATH)).toBe(true); // NOT deleted
  });

  it('PRESSURE: OMO does not suggest codex/gemini during ULW', () => {
    const result = runHook('sc-keyword-detector.mjs', { prompt: '코드 구현해줘' });
    // Should NOT contain OMO routing to codex/gemini
    const ctx = result.hookSpecificOutput?.additionalContext || '';
    expect(ctx).not.toContain('codex');
    expect(ctx).not.toContain('gemini');
  });
});
