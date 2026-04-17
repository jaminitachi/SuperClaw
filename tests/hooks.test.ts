import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

const SCRIPTS = join(homedir(), 'superclaw', 'scripts');
const STATE_DIR = join(homedir(), '.claude', '.sc', 'state');

// Each test file gets a unique session ID so parallel runs don't collide.
const TEST_SID = `test-${Date.now()}-${randomUUID().slice(0, 8)}`;
const SESSION_DIR = join(STATE_DIR, 'sessions', TEST_SID);
const GATES_PATH = join(SESSION_DIR, 'gates.json');
const ULW_PATH = join(SESSION_DIR, 'ultrawork-state.json');
// NOTE: ULW file tracking state lives in a single append-only JSONL log at
// SESSION_DIR/ulw-verify-log.jsonl (see scripts/lib/ulw-verify-log.mjs).
// hooks.test.ts does not assert on its contents directly — those assertions
// live in e2e-ulw-lifecycle.test.ts and verify-log.test.ts.

function runHook(script: string, input: Record<string, any>): any {
  // Auto-inject session_id so every hook call is session-scoped.
  const payload = { session_id: TEST_SID, ...input };
  const json = JSON.stringify(payload);
  try {
    // Pass JSON via execSync's `input` option (stdin) to avoid shell escaping
    // pitfalls with $ or backticks inside the payload.
    const result = execSync(`node "${join(SCRIPTS, script)}"`, {
      encoding: 'utf-8',
      timeout: 8000,
      input: json,
    });
    return JSON.parse(result.trim());
  } catch (e: any) {
    // Hook may exit non-zero but still emit valid JSON on stdout
    const stdout = e.stdout?.trim();
    if (stdout) {
      try { return JSON.parse(stdout); } catch {}
    }
    return {};
  }
}

function writeGates(overrides: object) {
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(GATES_PATH, JSON.stringify({
    planApproved: false,
    tddRequired: true,
    testsExist: false,
    testsRun: false,
    ultraworkActive: true,
    ...overrides,
  }));
}

function writeUlwState(overrides: object = {}) {
  mkdirSync(SESSION_DIR, { recursive: true });
  writeFileSync(ULW_PATH, JSON.stringify({
    active: true,
    startedAt: new Date().toISOString(),
    mode: 'po-team',
    sessionId: TEST_SID,
    ...overrides,
  }));
}

function cleanState() {
  try { rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
}

// ---------------------------------------------------------------------------
// sc-keyword-detector.mjs
// ---------------------------------------------------------------------------

describe('sc-keyword-detector: ultrawork keyword', () => {
  afterEach(cleanState);

  it('detects ulw keyword in Korean prompt', () => {
    cleanState();
    const result = runHook('sc-keyword-detector.mjs', { prompt: '이거 ulw 해줘' });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput.additionalContext).toContain('superclaw:ultrawork');
  });

  it('detects ultrawork keyword in English prompt', () => {
    cleanState();
    const result = runHook('sc-keyword-detector.mjs', { prompt: 'please ultrawork this task' });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toContain('superclaw:ultrawork');
  });

  it('includes activation announcement in ultrawork output', () => {
    cleanState();
    const result = runHook('sc-keyword-detector.mjs', { prompt: 'ulw this project' });
    const ctx = result.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('IMPORTANT');
    expect(ctx).toContain('ultrawork!');
  });
});

describe('sc-keyword-detector: mac-control keyword', () => {
  it('detects screenshot keyword', () => {
    const result = runHook('sc-keyword-detector.mjs', { prompt: 'take a screenshot' });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toContain('superclaw:mac-control');
  });

  it('detects capture screen variant', () => {
    const result = runHook('sc-keyword-detector.mjs', { prompt: 'capture screen please' });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toContain('superclaw:mac-control');
  });

  it('detects Korean 스크린샷 keyword', () => {
    const result = runHook('sc-keyword-detector.mjs', { prompt: '스크린샷 찍어줘' });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toContain('superclaw:mac-control');
  });
});

describe('sc-keyword-detector: telegram keyword', () => {
  it('detects send to phone keyword', () => {
    const result = runHook('sc-keyword-detector.mjs', { prompt: 'send to phone the results' });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toContain('superclaw:telegram-control');
  });

  it('detects telegram keyword', () => {
    const result = runHook('sc-keyword-detector.mjs', { prompt: 'telegram this to me' });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toContain('superclaw:telegram-control');
  });
});

describe('sc-keyword-detector: OMO routing', () => {
  beforeEach(cleanState);
  afterEach(cleanState);

  it('returns OMO hint for coding task when ULW is not active', () => {
    // No ultrawork-state.json present
    const result = runHook('sc-keyword-detector.mjs', { prompt: 'implement a new class for user authentication' });
    expect(result.continue).toBe(true);
    const ctx = result.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('SUPERCLAW OMO ROUTING');
    expect(ctx).toContain('codex');
  });

  it('suppresses OMO hint when ULW is active', () => {
    // isUltraworkActive() in sc-keyword-detector reads gates.json for ultraworkActive flag
    writeGates({ ultraworkActive: true });
    writeUlwState();
    // coding prompt but ULW is active — OMO routing should be suppressed
    const result = runHook('sc-keyword-detector.mjs', { prompt: 'implement a new class for user authentication' });
    expect(result.continue).toBe(true);
    // No keyword match and ULW suppresses OMO → no hookSpecificOutput
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('passes through normal prompts with no output', () => {
    const result = runHook('sc-keyword-detector.mjs', { prompt: 'hello world' });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('strips code blocks before keyword matching to avoid false positives', () => {
    // ulw keyword inside backtick code block should NOT trigger ultrawork
    const result = runHook('sc-keyword-detector.mjs', {
      prompt: 'here is some code: ```\nconst ulw = true;\n```\nwhat does it do?',
    });
    expect(result.continue).toBe(true);
    // After stripping code blocks, 'ulw' is removed — hookSpecificOutput absent or no ultrawork skill
    const ctx = result.hookSpecificOutput?.additionalContext;
    if (ctx !== undefined) {
      expect(ctx).not.toContain('superclaw:ultrawork');
    } else {
      expect(result.hookSpecificOutput).toBeUndefined();
    }
  });
});

describe('sc-keyword-detector: edge cases', () => {
  it('returns continue:true for empty prompt', () => {
    const result = runHook('sc-keyword-detector.mjs', { prompt: '' });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('accepts message field as prompt alias', () => {
    const result = runHook('sc-keyword-detector.mjs', { message: 'ulw this' });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toContain('superclaw:ultrawork');
  });
});

// ---------------------------------------------------------------------------
// sc-pre-tool.mjs — Write/Edit HARD GATE
// ---------------------------------------------------------------------------

describe('sc-pre-tool: Write gate when ultrawork inactive', () => {
  beforeEach(cleanState);
  afterEach(cleanState);

  it('allows Write when ultrawork is not active (no state files)', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/test/app.ts' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});

describe('sc-pre-tool: PLAN GATE when ultrawork active', () => {
  beforeEach(() => {
    cleanState();
    writeGates({ planApproved: false });
    writeUlwState();
  });
  afterEach(cleanState);

  it('BLOCKS Write when plan not approved (HARD GATE)', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/test/app.ts' },
    });
    // New schema: deny via hookSpecificOutput.permissionDecision
    const hso = result.hookSpecificOutput;
    expect(hso).toBeDefined();
    expect(hso?.permissionDecision).toBe('deny');
    const reason = hso?.permissionDecisionReason ?? '';
    expect(reason).toContain('GATE');
  });

  it('BLOCKS Edit when plan not approved (HARD GATE)', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Edit',
      tool_input: { file_path: '/test/app.ts' },
    });
    const hso = result.hookSpecificOutput;
    expect(hso?.permissionDecision).toBe('deny');
    expect(hso?.permissionDecisionReason ?? '').toContain('GATE');
  });

  it('allows test file Write even when plan not approved', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/test/app.test.ts' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('allows spec file Write even when plan not approved', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/test/app.spec.ts' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('allows __tests__ directory Write even when plan not approved', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/src/__tests__/app.ts' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('allows plan file Write even when plan not approved', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/Users/daehanlim/.claude/plans/my-plan.md' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});

describe('sc-pre-tool: TDD GATE when plan approved but no tests', () => {
  beforeEach(() => {
    cleanState();
    writeGates({ planApproved: true, testsExist: false });
    writeUlwState();
  });
  afterEach(cleanState);

  it('BLOCKS Write when tests do not exist (TDD HARD GATE)', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/test/app.ts' },
    });
    const hso = result.hookSpecificOutput;
    expect(hso?.permissionDecision).toBe('deny');
    expect(hso?.permissionDecisionReason ?? '').toContain('GATE');
  });

  it('allows production Write after tests exist and RED confirmed', () => {
    writeGates({ planApproved: true, testsExist: true, testsRedConfirmed: true });
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/test/app.ts' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});

describe('sc-pre-tool: RED GATE — tests must fail before implementation', () => {
  beforeEach(() => {
    cleanState();
    writeGates({ planApproved: true, testsExist: true, testsRedConfirmed: false });
    writeUlwState();
  });
  afterEach(cleanState);

  it('BLOCKS Write when tests exist but RED not confirmed', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/test/app.ts' },
    });
    const hso = result.hookSpecificOutput;
    expect(hso?.permissionDecision).toBe('deny');
    expect(hso?.permissionDecisionReason ?? '').toContain('RED GATE');
  });

  it('BLOCKS Edit when tests exist but RED not confirmed', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Edit',
      tool_input: { file_path: '/test/app.ts' },
    });
    const hso = result.hookSpecificOutput;
    expect(hso?.permissionDecision).toBe('deny');
    expect(hso?.permissionDecisionReason ?? '').toContain('RED GATE');
  });

  it('allows Write after RED confirmed (tests ran and failed)', () => {
    writeGates({ planApproved: true, testsExist: true, testsRedConfirmed: true });
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/test/app.ts' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('allows test file Write even when RED not confirmed', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/test/app.test.ts' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('skips RED gate when tddRequired is false (research tasks)', () => {
    writeGates({ planApproved: true, tddRequired: false, testsExist: false, testsRedConfirmed: false });
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: '/test/app.ts' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});

describe('sc-post-tool: RED/GREEN state tracking', () => {
  beforeEach(() => {
    cleanState();
    writeGates({ planApproved: true, testsExist: true, testsRedConfirmed: false, testsGreenConfirmed: false });
    writeUlwState();
  });
  afterEach(cleanState);

  it('sets testsRedConfirmed when test command fails', () => {
    // Simulate a test run that produces failure output
    runHook('sc-post-tool.mjs', {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: 'FAIL src/app.test.ts\n  Tests: 2 failed, 1 passed\n  exit code 1',
    });
    const gates = JSON.parse(readFileSync(GATES_PATH, 'utf-8'));
    expect(gates.testsRun).toBe(true);
    expect(gates.testsRedConfirmed).toBe(true);
  });

  it('sets testsGreenConfirmed when test command passes after RED', () => {
    // First: RED state
    writeGates({ planApproved: true, testsExist: true, testsRedConfirmed: true, testsGreenConfirmed: false });
    // Then: test passes
    runHook('sc-post-tool.mjs', {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: 'PASS src/app.test.ts\n  Tests: 3 passed\n  0 failed',
    });
    const gates = JSON.parse(readFileSync(GATES_PATH, 'utf-8'));
    expect(gates.testsRun).toBe(true);
    expect(gates.testsGreenConfirmed).toBe(true);
  });

  it('does not set RED for non-test bash commands', () => {
    runHook('sc-post-tool.mjs', {
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      tool_response: 'hello',
    });
    const gates = JSON.parse(readFileSync(GATES_PATH, 'utf-8'));
    expect(gates.testsRedConfirmed).toBe(false);
  });
});

describe('sc-pre-tool: ExitPlanMode gate transition', () => {
  beforeEach(() => {
    cleanState();
    writeGates({ planApproved: false });
    writeUlwState();
  });
  afterEach(cleanState);

  it('sets planApproved=true when ExitPlanMode is called', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'ExitPlanMode',
      tool_input: {},
    });
    expect(result.continue).toBe(true);
    // No warning context for ExitPlanMode
    expect(result.hookSpecificOutput).toBeUndefined();
    // Verify state file was updated
    const gates = JSON.parse(readFileSync(GATES_PATH, 'utf-8'));
    expect(gates.planApproved).toBe(true);
  });

  it('sets planApproved=false when EnterPlanMode is called', () => {
    writeGates({ planApproved: true });
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'EnterPlanMode',
      tool_input: {},
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
    const gates = JSON.parse(readFileSync(GATES_PATH, 'utf-8'));
    expect(gates.planApproved).toBe(false);
  });
});

describe('sc-pre-tool: non-gated tools', () => {
  beforeEach(cleanState);
  afterEach(cleanState);

  it('allows Read without gate check', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Read',
      tool_input: { file_path: '/test/app.ts' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('allows Grep without gate check', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Grep',
      tool_input: { pattern: 'foo', path: '/test' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('allows Bash without gate check', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('emits model routing hint for Task tool without model param', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Task',
      tool_input: { description: 'find all files', subagent_type: 'general' },
    });
    expect(result.continue).toBe(true);
    const ctx = result.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('SuperClaw');
    expect(ctx).toContain('Spawning agent');
  });

  it('suggests opus model for complex Task prompt', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Task',
      tool_input: { description: 'debug the race condition in the scheduler', subagent_type: 'general' },
    });
    const ctx = result.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('opus');
  });

  it('suggests haiku model for simple Task prompt', () => {
    const result = runHook('sc-pre-tool.mjs', {
      tool_name: 'Task',
      tool_input: { description: 'list all the files in src/', subagent_type: 'general' },
    });
    const ctx = result.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('haiku');
  });
});
