/**
 * Pressure Tests — Adversarial / Bypass Scenarios
 *
 * Standalone suite that stress-tests the hook enforcement layer under
 * adversarial conditions: gate bypasses, premature exits, OMO suppression,
 * and stale-session edge cases.
 *
 * Follows the same pattern as e2e-ulw-lifecycle.test.ts:
 * each test simulates a real hook invocation via stdin→stdout and verifies
 * that the system enforces rules correctly.
 *
 * All state is session-scoped under ~/.claude/.sc/state/sessions/{TEST_SID}/.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

const SCRIPTS = join(homedir(), 'superclaw', 'scripts');
const STATE_DIR = join(homedir(), '.claude', '.sc', 'state');

const TEST_SID = `test-${Date.now()}-${randomUUID().slice(0, 8)}`;
const SESSION_DIR = join(STATE_DIR, 'sessions', TEST_SID);
const GATES_PATH = join(SESSION_DIR, 'gates.json');
const ULW_PATH = join(SESSION_DIR, 'ultrawork-state.json');
const VERIFY_LOG_PATH = join(SESSION_DIR, 'ulw-verify-log.jsonl');

// Append-only event helpers matching scripts/lib/ulw-verify-log.mjs.
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

function runHook(script: string, input: Record<string, any>): any {
  // Auto-inject session_id so every hook call is session-scoped.
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
    const out = e.stdout?.trim() || '';
    try { return JSON.parse(out); } catch { return { raw: out, exitCode: e.status }; }
  }
}

function cleanup() {
  try { rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
}

describe('Pressure Tests: Gate Bypass Attempts', () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(SESSION_DIR, { recursive: true });
    writeFileSync(GATES_PATH, JSON.stringify({
      planApproved: false,
      tddRequired: true,
      testsExist: false,
      testsRun: false,
      ultraworkActive: true,
    }));
    writeFileSync(ULW_PATH, JSON.stringify({
      active: true,
      startedAt: new Date().toISOString(),
      mode: 'po-team',
      sessionId: TEST_SID,
    }));
  });
  afterEach(() => cleanup());

  // -------------------------------------------------------------------------
  // Gate 1: PLAN GATE — planApproved=false blocks production Write
  // -------------------------------------------------------------------------
  it('PRESSURE: Write production code without plan approval → BLOCKED (deny)', () => {
    // planApproved=false, ultraworkActive=true → PLAN GATE fires
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/bypass.ts' },
    });
    const hso = result.hookSpecificOutput;
    expect(hso?.permissionDecision).toBe('deny');
    expect(hso?.permissionDecisionReason ?? '').toContain('GATE');
  });

  // -------------------------------------------------------------------------
  // Gate 2: TDD GATE — planApproved=true but testsExist=false blocks prod Write
  // -------------------------------------------------------------------------
  it('PRESSURE: Write production code without tests → BLOCKED (deny)', () => {
    writeFileSync(GATES_PATH, JSON.stringify({
      planApproved: true,
      tddRequired: true,
      testsExist: false,
      testsRun: false,
      ultraworkActive: true,
    }));
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/bypass.ts' },
    });
    const hso = result.hookSpecificOutput;
    expect(hso?.permissionDecision).toBe('deny');
    expect(hso?.permissionDecisionReason ?? '').toContain('TDD');
  });

  // -------------------------------------------------------------------------
  // Test files bypass all gates — TDD red-phase must always be writable
  // -------------------------------------------------------------------------
  it('PRESSURE: Write test file always allowed even when gates are closed', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/bypass.test.ts' },
    });
    expect(result.continue).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Plan files bypass all gates — plan mode writes must not be blocked
  // -------------------------------------------------------------------------
  it('PRESSURE: Write plan file always allowed even when gates are closed', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: join(homedir(), '.claude', 'plans', 'test.md') },
    });
    expect(result.continue).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Sisyphus: failed tests prevent exit
  // editedFiles==verifiedFiles (no unverified), but testsPassed=false
  // -------------------------------------------------------------------------
  it('PRESSURE: Exit with failed tests → BLOCKED, reason contains "실패"', () => {
    // Seed verify log with a mark+clear pair so loadAllEdited() > 0 (which
    // is what gates the Sisyphus test-status reason branch).
    resetVerifyLog();
    seedEdited(['/tmp/a.ts']);
    seedVerified(['/tmp/a.ts']);
    writeFileSync(GATES_PATH, JSON.stringify({
      testsRun: true,
      testsPassed: false,
    }));

    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('실패');
  });

  // -------------------------------------------------------------------------
  // Sisyphus: unverified files prevent exit
  // editedFiles has entries but verifiedFiles is empty
  // -------------------------------------------------------------------------
  it('PRESSURE: Exit without reading edited files → BLOCKED, reason contains "미검증"', () => {
    resetVerifyLog();
    seedEdited(['/tmp/sneaky.ts']); // mark only → unverified set contains it
    writeFileSync(GATES_PATH, JSON.stringify({
      testsRun: true,
      testsPassed: true,
    }));

    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('미검증');
  });

  // -------------------------------------------------------------------------
  // OMO: codex/gemini routing must be suppressed while ULW is active
  // gates.json has ultraworkActive=true → isUltraworkActive() returns true
  // -------------------------------------------------------------------------
  it('PRESSURE: OMO codex/gemini routing suppressed during ULW', () => {
    const result = runHook('sc-keyword-detector.mjs', { prompt: '코드 구현해줘' });
    const ctx = result.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).not.toContain('codex');
    expect(ctx).not.toContain('gemini');
  });

  // -------------------------------------------------------------------------
  // Stale detection boundary: 23h old session with 5-min-ago activity
  // must NOT be cleaned up — ULW still active, exit still blocked
  // -------------------------------------------------------------------------
  it('PRESSURE: 23h session with recent activity → NOT stale, exit still blocked', () => {
    writeFileSync(ULW_PATH, JSON.stringify({
      active: true,
      startedAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
      lastActivityAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      mode: 'po-team',
      sessionId: TEST_SID,
    }));
    resetVerifyLog(); // no events yet — Sisyphus still blocks on active ULW

    const result = runHook('sc-persistent.mjs', {});
    expect(result.decision).toBe('block');
    expect(existsSync(ULW_PATH)).toBe(true);
  });
});
