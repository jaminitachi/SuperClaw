#!/usr/bin/env node
/**
 * PreToolUse hook — injects SuperClaw-specific reminders and HARD GATE enforcement.
 *
 * HARD GATES (ultrawork mode only):
 *   1. PLAN GATE: Write/Edit blocked until plan is approved (ExitPlanMode)
 *   2. TDD GATE:  Write/Edit blocked until tests exist (test files written first)
 *
 * Gate state persisted in ~/.claude/.sc/state/sessions/{sessionId}/gates.json
 */
if (process.env.SUPERCLAW_DAEMON === '1') {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}
import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { readStdin } from './lib/stdin.mjs';
import { trace } from './lib/hook-logger.mjs';
import { ulwGatesPath, ulwStatePath } from './lib/ulw-paths.mjs';

// ---------------------------------------------------------------------------
// Gate state management (session-scoped; no global fallback)
// ---------------------------------------------------------------------------

const DEFAULT_GATES = {
  planApproved: false,
  tddRequired: true,
  testsExist: false,
  testsRun: false,
  testsRedConfirmed: false,
  testsGreenConfirmed: false,
  ultraworkActive: false,
};

function loadGates(currentSessionId) {
  // Without a session, nothing to load and nothing authoritative to cache.
  if (!currentSessionId) return { ...DEFAULT_GATES };

  let gates = { ...DEFAULT_GATES };

  // 1. Load session-scoped gates (no global fallback)
  const gatesFile = ulwGatesPath(currentSessionId);
  if (gatesFile && existsSync(gatesFile)) {
    try { gates = { ...DEFAULT_GATES, ...JSON.parse(readFileSync(gatesFile, 'utf-8')) }; }
    catch { /* use defaults */ }
  }

  // 2. Check session-scoped ultrawork-state (no global fallback).
  // Since we only read our own session's file, the isThisSession check
  // collapses — presence of the file implies it's ours.
  const ulwFile = ulwStatePath(currentSessionId);
  if (ulwFile && existsSync(ulwFile)) {
    try {
      const ulwState = JSON.parse(readFileSync(ulwFile, 'utf-8'));
      // Defensive: verify sessionId matches if recorded. Otherwise trust path.
      const ulwSessionId = ulwState.sessionId || null;
      gates.ultraworkActive = !ulwSessionId || ulwSessionId === currentSessionId;
    } catch {
      gates.ultraworkActive = false;
    }
  } else {
    gates.ultraworkActive = false;
  }

  return gates;
}

function saveGates(gates, sessionId) {
  // Silent no-op without a session — no global fallback.
  if (!sessionId) return;
  const target = ulwGatesPath(sessionId);
  if (!target) return;
  try {
    const dir = dirname(target);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(target, JSON.stringify(gates, null, 2));
  } catch {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isTestFile(filePath) {
  if (!filePath) return false;
  return (
    /\.(test|spec)\./i.test(filePath) ||
    /__tests__\//i.test(filePath) ||
    /\/src\/(test|integrationTest|scenarioTest)\//.test(filePath) ||
    /(Test|Tests|Spec|IT)\.(kt|java|scala|groovy)$/.test(filePath)
  );
}

function block(message) {
  return { block: true, message };
}

function allow(message) {
  return message || null;
}

// ---------------------------------------------------------------------------
// HARD GATE check for Write/Edit tools
// ---------------------------------------------------------------------------
function checkWriteEditGate(input, gates, sessionId) {
  const filePath = input?.tool_input?.file_path
    || input?.tool_input?.filePath
    || input?.tool_input?.path
    || '';

  // Test files are always allowed — and mark testsExist
  if (isTestFile(filePath)) {
    if (!gates.testsExist) {
      gates.testsExist = true;
      saveGates(gates, sessionId);
    }
    trace(sessionId, 'hook:PreToolUse:ALLOW', { toolName: 'Write/Edit', reason: 'test-file', filePath });
    return allow();
  }

  // Allow plan file writes even when planApproved is false (plan mode needs to write plans)
  if (filePath.includes('/.claude/plans/') && filePath.endsWith('.md')) {
    trace(sessionId, 'hook:PreToolUse:ALLOW', { toolName: 'Write/Edit', reason: 'plan-file', filePath });
    return allow();
  }

  // Allow writes to CURRENT session's SuperClaw state dir — skill activation needs to
  // write its own state files without being gated. Cross-session writes are denied to
  // prevent parallel sessions from clobbering each other's state.
  if (sessionId && filePath.includes(`/.claude/.sc/state/sessions/${sessionId}/`)) {
    trace(sessionId, 'hook:PreToolUse:ALLOW', { toolName: 'Write/Edit', reason: 'session-state-dir', filePath });
    return allow();
  }

  // Fallback: when sessionId is missing (legacy/boot paths), allow global state files
  // that are NOT inside any session subdirectory.
  if (!sessionId && filePath.includes('/.claude/.sc/state/') && !filePath.includes('/.claude/.sc/state/sessions/')) {
    trace(null, 'hook:PreToolUse:ALLOW', { toolName: 'Write/Edit', reason: 'global-state-dir', filePath });
    return allow();
  }

  // Gates only enforced when ultrawork is active
  if (!gates.ultraworkActive) {
    trace(sessionId, 'hook:PreToolUse:ALLOW', { toolName: 'Write/Edit', reason: 'ulw-inactive', filePath });
    return allow();
  }

  // GATE 1: Plan must be approved before any production code edit
  if (!gates.planApproved) {
    return block('PLAN GATE: Use EnterPlanMode first. Production code edits are blocked until the plan is approved (ExitPlanMode).');
  }

  // GATE 2: TDD — tests must exist before production code edit
  if (gates.tddRequired && !gates.testsExist) {
    return block('TDD GATE: Write tests first. Production code edits are blocked until test files (*.test.*, *.spec.*, __tests__/) are written.');
  }

  // GATE 3: RED — tests must have been run and FAILED before implementation code edit
  if (gates.tddRequired && gates.testsExist && !gates.testsRedConfirmed) {
    return block('RED GATE: Run tests and confirm they FAIL before writing implementation code. TDD requires RED (failing test) → GREEN (passing implementation) → REFACTOR.');
  }

  trace(sessionId, 'hook:PreToolUse:ALLOW', { toolName: 'Write/Edit', reason: 'gates-passed', filePath });
  return allow();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const raw = await readStdin(2000);
  if (!raw.trim()) { console.log(JSON.stringify({ continue: true })); return; }

  let input;
  try { input = JSON.parse(raw); } catch { console.log(JSON.stringify({ continue: true })); return; }

  const toolName = input?.tool_name ?? input?.toolName ?? '';
  const sessionId = input?.session_id || input?.sessionId || null;

  // Trace every tool call Claude makes
  trace(sessionId, 'hook:PreToolUse:input', {
    toolName,
    toolInput: JSON.stringify(input?.tool_input ?? {}).slice(0, 500),
  });

  // ----- Gate state transitions (side-effects) -----
  const gates = loadGates(sessionId);

  if (toolName === 'ExitPlanMode') {
    gates.planApproved = true;
    saveGates(gates, sessionId);
    // allow through, no reminder needed
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  if (toolName === 'EnterPlanMode') {
    gates.planApproved = false;
    saveGates(gates, sessionId);
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // ----- Bash sentinel escape hatch (manual gate flips) -----
  if (toolName === 'Bash') {
    const command = typeof input?.tool_input?.command === 'string' ? input.tool_input.command : '';
    if (command) {
      const flipped = {};
      if (command.includes('SUPERCLAW_RED_CONFIRM')) {
        gates.testsRedConfirmed = true;
        flipped.testsRedConfirmed = true;
      }
      if (command.includes('SUPERCLAW_GREEN_CONFIRM')) {
        gates.testsGreenConfirmed = true;
        flipped.testsGreenConfirmed = true;
      }
      if (command.includes('SUPERCLAW_PLAN_APPROVE')) {
        gates.planApproved = true;
        flipped.planApproved = true;
      }
      if (command.includes('SUPERCLAW_MINIMAL_CONFIRM')) {
        gates.minimalismConfirmed = true;
        flipped.minimalismConfirmed = true;
      }
      if (Object.keys(flipped).length > 0) {
        saveGates(gates, sessionId);
        trace(sessionId, 'hook:PreToolUse:ESCAPE', flipped);
      }
    }
  }

  // ----- HARD GATE: Write / Edit -----
  if (toolName === 'Write' || toolName === 'Edit') {
    const result = checkWriteEditGate(input, gates, sessionId);
    if (result && result.block) {
      // Deny this specific tool call — Claude can see the reason and retry differently
      trace(sessionId, 'hook:PreToolUse:BLOCKED', { toolName, reason: result.message });
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `SuperClaw HARD GATE: ${result.message}`,
        },
      }));
      return;
    }
    if (result && result.message) {
      // Warning only (block: false case, if ever used)
      trace(sessionId, 'hook:PreToolUse:WARN', { toolName, reason: result.message });
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `SuperClaw HARD GATE (warning): ${result.message}`,
        },
      }));
      return;
    }
    // Write/Edit allowed — no additional reminder needed
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // ----- Tool-specific reminders (non-gated) -----
  const reminders = {
    'Task': (input) => {
      const model = input?.tool_input?.model;
      const prompt = input?.tool_input?.description || input?.tool_input?.prompt || '';
      const agentType = input?.tool_input?.subagent_type ?? 'unknown';

      let message = `Spawning agent: ${agentType} (${model ?? 'inherit'}) | Task: ${prompt.substring(0, 80)}`;

      // Model suggestion if not specified
      if (!model) {
        const complexKeywords = /\b(debug|architecture|security|race condition|refactor|complex)\b/i;
        const simpleKeywords = /\b(find|list|check|status|lookup)\b/i;
        let suggestion = 'sonnet';
        if (complexKeywords.test(prompt)) suggestion = 'opus';
        else if (simpleKeywords.test(prompt)) suggestion = 'haiku';
        message += `\n⚠️ Model parameter not specified. Based on task complexity, consider using model="${suggestion}". Smart Model Routing: haiku (simple lookup), sonnet (standard work), opus (complex reasoning).`;
      }

      return message;
    },
  };

  const reminderFn = reminders[toolName];
  if (!reminderFn) { console.log(JSON.stringify({ continue: true })); return; }

  const reminder = typeof reminderFn === 'function' ? reminderFn(input) : reminderFn;
  if (!reminder) { console.log(JSON.stringify({ continue: true })); return; }

  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `SuperClaw: ${reminder}`,
    },
  }));
}

main().catch((e) => {
  try { appendFileSync(join(homedir(), 'superclaw', 'data', 'logs', 'hooks.log'), `[${new Date().toISOString()}] [ERROR] [pre-tool] ${e?.message ?? e}\n`); } catch {}
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
