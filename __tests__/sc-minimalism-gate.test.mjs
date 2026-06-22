/**
 * RED tests for the minimalism gate.
 *
 * Design: ONE new field gates.minimalismConfirmed (boolean, default false).
 *
 * Three scripts are touched:
 *
 *   1. sc-keyword-detector.mjs
 *      - Fresh ULW activation MUST include minimalismConfirmed:false in gates.json.
 *      - Re-entry resetGates MUST reset minimalismConfirmed to false.
 *
 *   2. sc-persistent.mjs (Stop hook)
 *      - When everEdited>0 AND tddRequired===true AND minimalismConfirmed!==true
 *        → decision MUST be 'block' and reason MUST mention minimalism.
 *      - When minimalismConfirmed===true (and TDD gates satisfied) → MUST NOT block.
 *      - Regression guard: when tddRequired===false → MUST NOT block on minimalism.
 *
 *   3. sc-pre-tool.mjs
 *      - A Bash command containing SUPERCLAW_MINIMAL_CONFIRM MUST set
 *        gates.minimalismConfirmed=true (mirrors SUPERCLAW_RED_CONFIRM pattern).
 *      - Non-Bash tools containing the sentinel MUST NOT flip the gate.
 *      - Existing sentinels must still work (regression guard).
 *
 * All tests FAIL against current code (RED) and pass once implemented (GREEN).
 *
 * Uses node:test + node:assert/strict and drives the real scripts via
 * child_process.spawnSync with stdin JSON, matching the actual hook invocation
 * contract (Claude Code posts stdin JSON).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Script paths
// ---------------------------------------------------------------------------
const HOME = homedir();
const KEYWORD_DETECTOR  = join(HOME, 'superclaw', 'scripts', 'sc-keyword-detector.mjs');
const PRE_TOOL          = join(HOME, 'superclaw', 'scripts', 'sc-pre-tool.mjs');
const PERSISTENT        = join(HOME, 'superclaw', 'scripts', 'sc-persistent.mjs');
const SESSIONS_DIR      = join(HOME, '.claude', '.sc', 'state', 'sessions');

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------
let TEST_SID;
let SESSION_DIR;
let GATES_PATH;
let ULW_PATH;
let VERIFY_LOG_PATH;
let BOARD_PATH;

beforeEach(() => {
  TEST_SID       = `min-test-${Date.now()}-${randomUUID().slice(0, 8)}`;
  SESSION_DIR    = join(SESSIONS_DIR, TEST_SID);
  GATES_PATH     = join(SESSION_DIR, 'gates.json');
  ULW_PATH       = join(SESSION_DIR, 'ultrawork-state.json');
  VERIFY_LOG_PATH = join(SESSION_DIR, 'ulw-verify-log.jsonl');
  BOARD_PATH     = join(SESSION_DIR, 'ulw-board.jsonl');
  try { rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
});

afterEach(() => {
  try { rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
});

/** Write a minimal active ULW state file. */
function seedUlwState(overrides = {}) {
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(ULW_PATH, JSON.stringify({
    active: true,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    mode: 'po-team',
    sessionId: TEST_SID,
    iteration: 1,
    pendingTasks: 0,
    ...overrides,
  }));
}

/** Write a gates.json file with provided fields (merges over safe defaults). */
function seedGates(overrides = {}) {
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(GATES_PATH, JSON.stringify({
    ultraworkActive: true,
    planApproved: true,
    tddRequired: true,
    testsExist: true,
    testsRun: true,
    testsRedConfirmed: true,
    testsGreenConfirmed: true,
    minimalismConfirmed: false,
    ...overrides,
  }));
}

/**
 * Append a 'mark' edit event to the verify log so that everEdited.size > 0
 * (which is the condition the Stop hook uses to activate TDD/minimalism gates).
 */
function seedEditEvent(filePath = '/src/app.ts') {
  mkdirSync(SESSION_DIR, { recursive: true });
  appendFileSync(
    VERIFY_LOG_PATH,
    JSON.stringify({ mark: filePath, ts: new Date().toISOString() }) + '\n',
  );
}

function readGates() {
  if (!existsSync(GATES_PATH)) return null;
  return JSON.parse(readFileSync(GATES_PATH, 'utf-8'));
}

/** Drive a script with the given stdin payload; return parsed stdout + raw. */
function runScript(scriptPath, payload) {
  const result = spawnSync('node', [scriptPath], {
    input: JSON.stringify({ session_id: TEST_SID, ...payload }),
    encoding: 'utf-8',
    timeout: 10_000,
  });
  const stdout = (result.stdout || '').trim();
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch { parsed = { __raw: stdout }; }
  return { status: result.status, stdout, stderr: result.stderr || '', parsed };
}

// ===========================================================================
// SECTION 1: sc-keyword-detector.mjs — gate initialisation
// ===========================================================================

test('keyword-detector: fresh ULW activation writes minimalismConfirmed:false to gates.json', () => {
  // Pre-condition: no session dir exists (truly fresh)
  assert.equal(existsSync(SESSION_DIR), false, 'precondition: session dir must not exist');

  const res = runScript(KEYWORD_DETECTOR, { prompt: 'ulw fix this' });
  assert.equal(res.status, 0, `hook exited non-zero: ${res.stderr}`);
  assert.equal(existsSync(GATES_PATH), true, 'gates.json must be created on fresh ULW activation');

  const gates = readGates();
  assert.ok(gates, 'gates.json must be parseable');
  // RED: current code has no minimalismConfirmed field in fresh gates serialisation
  assert.equal(
    gates.minimalismConfirmed,
    false,
    `fresh activation must include minimalismConfirmed:false; got ${JSON.stringify(gates)}`,
  );
});

test('keyword-detector: re-entry resetGates resets minimalismConfirmed to false', () => {
  // Seed an already-active ULW session with minimalismConfirmed:true
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(ULW_PATH, JSON.stringify({
    active: true,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    mode: 'po-team',
    sessionId: TEST_SID,
    iteration: 1,
  }));
  writeFileSync(GATES_PATH, JSON.stringify({
    ultraworkActive: true,
    tddRequired: true,
    planApproved: true,
    testsExist: true,
    testsRun: true,
    testsRedConfirmed: true,
    testsGreenConfirmed: true,
    minimalismConfirmed: true,   // was confirmed in previous round
  }));
  writeFileSync(BOARD_PATH, '');
  writeFileSync(VERIFY_LOG_PATH, '');

  const res = runScript(KEYWORD_DETECTOR, { prompt: 'ulw again' });
  assert.equal(res.status, 0, `hook exited non-zero: ${res.stderr}`);

  const gates = readGates();
  assert.ok(gates);
  // RED: current resetGates does not include minimalismConfirmed at all
  assert.equal(
    gates.minimalismConfirmed,
    false,
    `re-entry must reset minimalismConfirmed to false; got ${JSON.stringify(gates)}`,
  );
});

// ===========================================================================
// SECTION 2: sc-pre-tool.mjs — SUPERCLAW_MINIMAL_CONFIRM sentinel
// ===========================================================================

test('pre-tool: SUPERCLAW_MINIMAL_CONFIRM in Bash command sets minimalismConfirmed:true', () => {
  seedUlwState();
  seedGates({ minimalismConfirmed: false });

  runScript(PRE_TOOL, {
    tool_name: 'Bash',
    tool_input: { command: 'echo # SUPERCLAW_MINIMAL_CONFIRM refactor verified minimal' },
  });

  const gates = readGates();
  assert.ok(gates);
  // RED: current sc-pre-tool.mjs has no SUPERCLAW_MINIMAL_CONFIRM branch
  assert.equal(
    gates.minimalismConfirmed,
    true,
    'SUPERCLAW_MINIMAL_CONFIRM must flip minimalismConfirmed to true',
  );
});

test('pre-tool: SUPERCLAW_MINIMAL_CONFIRM does not flip other gates', () => {
  seedUlwState();
  seedGates({
    testsRedConfirmed: false,
    testsGreenConfirmed: false,
    planApproved: false,
    minimalismConfirmed: false,
  });

  runScript(PRE_TOOL, {
    tool_name: 'Bash',
    tool_input: { command: 'echo # SUPERCLAW_MINIMAL_CONFIRM only this' },
  });

  const gates = readGates();
  assert.ok(gates);
  assert.equal(gates.minimalismConfirmed, true,   'minimalismConfirmed must flip');
  assert.equal(gates.testsRedConfirmed, false,    'testsRedConfirmed must stay false');
  assert.equal(gates.testsGreenConfirmed, false,  'testsGreenConfirmed must stay false');
  assert.equal(gates.planApproved, false,         'planApproved must stay false');
});

test('pre-tool: SUPERCLAW_MINIMAL_CONFIRM in non-Bash tool does NOT flip gate', () => {
  seedUlwState();
  seedGates({ minimalismConfirmed: false });

  runScript(PRE_TOOL, {
    tool_name: 'Edit',
    tool_input: {
      file_path: '/tmp/readme.md',
      old_string: 'a',
      new_string: 'SUPERCLAW_MINIMAL_CONFIRM b',
    },
  });

  const gates = readGates();
  assert.ok(gates);
  // Sentinel escape hatch is Bash-only — Edit must not flip it
  assert.equal(
    gates.minimalismConfirmed,
    false,
    'Edit containing sentinel must NOT flip minimalismConfirmed',
  );
});

test('pre-tool: existing sentinels still work after minimalism addition (regression)', () => {
  seedUlwState();
  seedGates({
    testsRedConfirmed: false,
    testsGreenConfirmed: false,
    planApproved: false,
    minimalismConfirmed: false,
  });

  runScript(PRE_TOOL, {
    tool_name: 'Bash',
    tool_input: { command: '# SUPERCLAW_RED_CONFIRM; # SUPERCLAW_GREEN_CONFIRM; # SUPERCLAW_PLAN_APPROVE' },
  });

  const gates = readGates();
  assert.ok(gates);
  assert.equal(gates.testsRedConfirmed,   true,  'SUPERCLAW_RED_CONFIRM regression');
  assert.equal(gates.testsGreenConfirmed, true,  'SUPERCLAW_GREEN_CONFIRM regression');
  assert.equal(gates.planApproved,        true,  'SUPERCLAW_PLAN_APPROVE regression');
  assert.equal(gates.minimalismConfirmed, false, 'minimalism gate must stay false (not mentioned)');
});

// ===========================================================================
// SECTION 3: sc-persistent.mjs (Stop hook) — minimalism block logic
// ===========================================================================

test('stop-hook: blocks when tddRequired:true, everEdited>0, minimalismConfirmed:false', () => {
  seedUlwState();
  seedGates({
    tddRequired: true,
    testsExist: true,
    testsRun: true,
    testsRedConfirmed: true,
    testsGreenConfirmed: true,
    minimalismConfirmed: false,  // NOT confirmed → must block
  });
  seedEditEvent('/src/feature.ts');

  const res = runScript(PERSISTENT, {});

  // RED: current sc-persistent.mjs has no minimalism gate check
  assert.equal(
    res.parsed?.decision,
    'block',
    `Stop hook must block when minimalismConfirmed is false; got ${res.stdout}`,
  );
  const reason = res.parsed?.reason ?? '';
  const mentionsMinimalism = /미니멀|minimali[sz]|MINIMAL/i.test(reason);
  assert.ok(
    mentionsMinimalism,
    `block reason must mention minimalism; got: "${reason}"`,
  );
});

test('stop-hook: does NOT block on minimalism when minimalismConfirmed:true', () => {
  seedUlwState();
  seedGates({
    tddRequired: true,
    testsExist: true,
    testsRun: true,
    testsRedConfirmed: true,
    testsGreenConfirmed: true,
    minimalismConfirmed: true,  // confirmed → must NOT block on minimalism
  });
  seedEditEvent('/src/feature.ts');

  const res = runScript(PERSISTENT, {});

  // With all TDD gates cleared and minimalism confirmed, must approve
  const reason = res.parsed?.reason ?? '';
  const blockedForMinimalism = /미니멀|minimali[sz]|MINIMAL/i.test(reason);
  assert.equal(
    blockedForMinimalism,
    false,
    `Stop hook must NOT block on minimalism when minimalismConfirmed:true; got: "${reason}"`,
  );
});

test('stop-hook: tddRequired:false → minimalism gate never blocks (non-code sessions safe)', () => {
  seedUlwState();
  seedGates({
    tddRequired: false,  // e.g. docs/research session — minimalism gate MUST be skipped
    testsExist: false,
    testsRun: false,
    testsRedConfirmed: false,
    testsGreenConfirmed: false,
    minimalismConfirmed: false,
  });
  seedEditEvent('/docs/notes.md');

  const res = runScript(PERSISTENT, {});

  const reason = res.parsed?.reason ?? '';
  const blockedForMinimalism = /미니멀|minimali[sz]|MINIMAL/i.test(reason);
  assert.equal(
    blockedForMinimalism,
    false,
    `When tddRequired:false the minimalism gate must never block; got: "${reason}"`,
  );
});

test('stop-hook: no edits (everEdited===0) → minimalism gate does not block', () => {
  seedUlwState();
  seedGates({
    tddRequired: true,
    minimalismConfirmed: false,
  });
  // Intentionally do NOT call seedEditEvent — verify log stays empty / absent

  const res = runScript(PERSISTENT, {});

  const reason = res.parsed?.reason ?? '';
  const blockedForMinimalism = /미니멀|minimali[sz]|MINIMAL/i.test(reason);
  assert.equal(
    blockedForMinimalism,
    false,
    `With no edits, minimalism gate must not block; got: "${reason}"`,
  );
});
