#!/usr/bin/env node
/**
 * PostToolUse hook — verifies SuperClaw tool results after execution.
 */
if (process.env.SUPERCLAW_DAEMON === '1') {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}
import { readStdin } from './lib/stdin.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { todosPath, allowlistPath, agentFailuresPath } from './lib/session.mjs';
import { trace } from './lib/hook-logger.mjs';
import { ulwStatePath, ulwGatesPath, ulwVerifyLogPath } from './lib/ulw-paths.mjs';
import { markEdited, markVerified, loadUnverified } from './lib/ulw-verify-log.mjs';

const TEST_RUNNER_RE = /\b(npm\s+test|npm\s+run\s+test|vitest|jest|playwright\s+test|pytest|cargo\s+test|pnpm\s+test|yarn\s+test|bun\s+test|go\s+test|deno\s+test|gradlew\b|gradle\s+\S*test|mvn\s+test)\b/i;
const TEST_INTERPRETER_RE = /\b(node|bun|deno|python3?|ruby)\b/i;
const TEST_PATH_RE = /(?:__tests__\/|\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb)\b)/i;

function isTestCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  if (TEST_RUNNER_RE.test(cmd)) return true;
  if (TEST_INTERPRETER_RE.test(cmd) && TEST_PATH_RE.test(cmd)) return true;
  return false;
}

function updateGates(updates, sessionId) {
  if (!sessionId) return;
  const gatesPath = ulwGatesPath(sessionId);
  if (!gatesPath) return;
  try {
    let gates = {};
    if (fs.existsSync(gatesPath)) {
      gates = JSON.parse(fs.readFileSync(gatesPath, 'utf-8'));
    }
    Object.assign(gates, updates);
    fs.writeFileSync(gatesPath, JSON.stringify(gates, null, 2), 'utf-8');
  } catch (e) {
    try { fs.appendFileSync(path.join(os.homedir(), 'superclaw', 'data', 'logs', 'hooks.log'), `[${new Date().toISOString()}] [ERROR] [post-tool/updateGates] ${e.message}\n`); } catch {}
  }
}

// --- Inbox JSONL for Claude Tycoon visualization ---
const INBOX_DIR = path.join(os.homedir(), '.claude', '.sc', 'inbox');

function getInboxSessionDir(sessionId) {
  if (!sessionId) return null;
  const dir = path.join(INBOX_DIR, sessionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureSessionMeta(sessionDir, taskDescription, sessionId) {
  if (!sessionDir) return;
  const metaPath = path.join(sessionDir, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    const meta = {
      sessionId: sessionId || 'unknown',
      startedAt: new Date().toISOString(),
      task: taskDescription || 'unknown',
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
}

function saveToInbox(agentType, result, sessionId) {
  const sessionDir = getInboxSessionDir(sessionId);
  if (!sessionDir) return;

  // Extract team name from agent type
  let team = 'general';
  if (agentType?.includes('dev-')) team = agentType.replace('superclaw:', '');
  else if (agentType?.includes('research-')) team = agentType.replace('superclaw:', '');
  else if (agentType?.includes('infra-')) team = agentType.replace('superclaw:', '');
  else if (agentType?.includes('verify')) team = 'verify';

  const entry = {
    timestamp: new Date().toISOString(),
    agent: agentType || 'unknown',
    team,
    status: result?.includes('BLOCKED') ? 'BLOCKED' :
            result?.includes('DONE_WITH_CONCERNS') ? 'DONE_WITH_CONCERNS' :
            result?.includes('NEEDS_CONTEXT') ? 'NEEDS_CONTEXT' : 'DONE',
    summary: result?.slice(0, 500) || '',
    fullResult: result || '',
    fullLength: result?.length || 0,
  };

  ensureSessionMeta(sessionDir, agentType, sessionId);

  fs.appendFileSync(
    path.join(sessionDir, `${team}.jsonl`),
    JSON.stringify(entry) + '\n'
  );
}

async function main() {
  const raw = await readStdin(2000);
  if (!raw.trim()) { console.log(JSON.stringify({ continue: true })); return; }

  let input;
  try { input = JSON.parse(raw); } catch { console.log(JSON.stringify({ continue: true })); return; }

  const toolName = input?.tool_name ?? input?.toolName ?? '';
  const result = input?.tool_response ?? input?.tool_result ?? input?.result ?? '';
  const sessionId = input?.session_id || input?.sessionId || null;

  // Trace tool result
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
  trace(sessionId, 'hook:PostToolUse:input', {
    toolName,
    resultPreview: resultStr.slice(0, 500),
  });

  // RULE 1: Track TODO creation
  if (toolName === 'TaskCreate') {
    try {
      fs.writeFileSync(todosPath(sessionId), new Date().toISOString());
    } catch {}

    // Extract file paths from task description and store in session allowlist
    const desc = input?.tool_input?.description || '';
    const filePattern = /(?:^|\s|[`"'])([\/\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|svelte|vue|css|scss|json|yaml|yml|toml|md))(?:\s|[`"']|$)/g;
    const files = [];
    let match;
    while ((match = filePattern.exec(desc)) !== null) {
      files.push(match[1]);
    }
    if (files.length > 0) {
      const alPath = allowlistPath(sessionId);
      let existing = [];
      try { existing = JSON.parse(fs.readFileSync(alPath, 'utf-8')); } catch {}
      const merged = [...new Set([...existing, ...files])];
      try { fs.writeFileSync(alPath, JSON.stringify(merged)); } catch {}
    }

    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Check for common failure patterns in SC tools
  if (toolName.startsWith('sc_') && typeof result === 'string') {
    if (result.includes('Not connected') || result.includes('ECONNREFUSED')) {
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: 'SuperClaw: Gateway connection failed. Run sc_status to check. Consider using gateway-debugger agent.',
        },
      }));
      return;
    }
    if (result.includes('SQLITE_ERROR') || result.includes('no such table')) {
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: 'SuperClaw: Memory database error. The database may need initialization. Check ~/superclaw/data/memory.db.',
        },
      }));
      return;
    }
  }

  // RULE: Save Agent tool results to inbox JSONL for Tycoon visualization
  if (toolName === 'Agent') {
    const agentType = input?.tool_input?.subagent_type || 'general-purpose';
    const agentResult = typeof result === 'string' ? result : JSON.stringify(result);
    try {
      saveToInbox(agentType, agentResult, sessionId);
    } catch {
      // Best-effort: don't block on inbox write failures
    }
  }

  // RULE: Record Skill tool invocations to JSONL for skill_metrics
  if (toolName === 'Skill') {
    try {
      const skillName = input?.tool_input?.skill || 'unknown';
      const stateDir = path.join(os.homedir(), '.claude', '.sc', 'state');
      if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
      const metricsPath = path.join(stateDir, 'skill-metrics.jsonl');
      const entry = {
        timestamp: new Date().toISOString(),
        skill: skillName,
        success: !resultStr?.includes('error') && !resultStr?.includes('BLOCKED'),
      };
      fs.appendFileSync(metricsPath, JSON.stringify(entry) + '\n');
    } catch { /* best effort */ }
  }

  // --- ULW File Change Tracking (session-scoped; no-op without sessionId) ---
  if (sessionId) {
    const ulwPath = ulwStatePath(sessionId);
    if (ulwPath && fs.existsSync(ulwPath)) {
      // Keep ULW session alive — atomic update of lastActivityAt
      // Uses write-to-tmp + rename to prevent R-M-W race between parallel hooks
      try {
        const ulwState = JSON.parse(fs.readFileSync(ulwPath, 'utf-8'));
        ulwState.lastActivityAt = new Date().toISOString();
        const tmpPath = ulwPath + `.tmp-${process.pid}`;
        fs.writeFileSync(tmpPath, JSON.stringify(ulwState, null, 2));
        fs.renameSync(tmpPath, ulwPath);
      } catch {}

      const logPath = ulwVerifyLogPath(sessionId);
      if (logPath) {
        if (toolName === 'Edit' || toolName === 'Write') {
          const filePath = input?.tool_input?.file_path || input?.tool_input?.filePath || input?.tool_input?.path;
          if (filePath) markEdited(logPath, filePath);
        }
        if (toolName === 'Read') {
          const filePath = input?.tool_input?.file_path || input?.tool_input?.filePath || input?.tool_input?.path;
          if (filePath) markVerified(logPath, filePath);
        }
      }

      if (toolName === 'Bash') {
        const cmd = input?.tool_input?.command || '';
        if (isTestCommand(cmd)) {
          const exitCode = input?.tool_response?.exit_code ?? input?.tool_response?.code ?? input?.tool_response?.exitCode;
          const interrupted = input?.tool_response?.interrupted === true;
          let testFailed;
          if (typeof exitCode === 'number') {
            testFailed = exitCode !== 0 && !interrupted;
          } else {
            const testResult = typeof result === 'string' ? result : JSON.stringify(result);
            testFailed = /\b(FAIL(?:ED)?|[1-9]\d*\s+failed|exit code [1-9]|Tests?:\s*\d+\s+failed)\b/i.test(testResult) && !/\b0 failed\b/i.test(testResult);
          }
          const gateUpdates = { testsRun: true, testsPassed: !testFailed };

          // RED/GREEN tracking for TDD enforcement
          if (testFailed) {
            // Tests ran and failed → RED confirmed
            gateUpdates.testsRedConfirmed = true;
          } else {
            // Tests ran and passed — if RED was already confirmed, this is GREEN
            try {
              const currentGatesPath = ulwGatesPath(sessionId);
              if (currentGatesPath && fs.existsSync(currentGatesPath)) {
                const currentGates = JSON.parse(fs.readFileSync(currentGatesPath, 'utf-8'));
                if (currentGates.testsRedConfirmed) {
                  gateUpdates.testsGreenConfirmed = true;
                }
              }
            } catch {}
          }

          updateGates(gateUpdates, sessionId);
        }
      }
    }
  }

  // Ultrawork verification enforcement
  if (toolName === 'Task') {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

    // Check if ultrawork mode is active (session-scoped; no-op without sessionId)
    let ultraworkActive = false;
    let state = null;
    const ultraworkStatePath = sessionId ? ulwStatePath(sessionId) : null;
    try {
      if (ultraworkStatePath && fs.existsSync(ultraworkStatePath)) {
        state = JSON.parse(fs.readFileSync(ultraworkStatePath, 'utf-8'));
        ultraworkActive = state.active === true;
      }
    } catch {}

    if (ultraworkActive && state && sessionId) {
      const verificationKeywords = ['screenshot', 'test', 'verified', 'lsp_diagnostics', 'PASS', 'sc_screenshot', 'verification'];
      const hasVerification = verificationKeywords.some(kw => resultStr.includes(kw));

      // Compute unverified file list for actionable 1-line summary (session-scoped)
      const logPath = ulwVerifyLogPath(sessionId);
      const unverified = [...loadUnverified(logPath)];
      const unverifiedSummary = unverified.length > 0
        ? `미검증 파일 ${unverified.length}개: ${unverified.map(f => path.basename(f)).join(', ')}`
        : '미검증 파일 없음';

      const context = hasVerification
        ? `⚡ ULW 검증 — ${unverifiedSummary} (iter ${state?.iteration ?? '?'}/${state?.maxIterations ?? '?'})`
        : `⚠️ 검증 미실행 — ${unverifiedSummary}. Read 변경파일 + 테스트 실행 필요. (iter ${state?.iteration ?? '?'}/${state?.maxIterations ?? '?'})`;

      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: context,
        },
      }));
      return;
    }

    // Agent failure detection and circuit breaker (only if not in ultrawork)
    function isAgentFailure(res) {
      if (typeof res === 'object' && res !== null) {
        if (res.success === false) return true;
        if (res.error && typeof res.error === 'string') return true;
        return false;
      }
      const s = typeof res === 'string' ? res : JSON.stringify(res);
      try { const p = JSON.parse(s); if (p.success === false || p.error) return true; return false; } catch {}
      if (/^(Error:|FAILED:|FATAL:|Exception:|Traceback|panic:)/im.test(s.trim())) return true;
      if (s.includes('Agent failed') || s.includes('agent encountered an error')) return true;
      return false;
    }
    const isFailure = isAgentFailure(result);

    if (isFailure) {
      const trackingPath = agentFailuresPath(input?.session_id);
      let failures = {};
      try {
        failures = JSON.parse(fs.readFileSync(trackingPath, 'utf-8'));
      } catch {}

      const agentType = input?.tool_input?.subagent_type || 'unknown';
      failures[agentType] = (failures[agentType] || 0) + 1;
      fs.writeFileSync(trackingPath, JSON.stringify(failures, null, 2));

      if (failures[agentType] >= 3) {
        console.log(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: `⚠️ Circuit breaker: ${agentType} has failed ${failures[agentType]} times. Consider escalating to a higher-tier agent (e.g., sonnet→opus) or delegating to superclaw:dev-architect for root-cause analysis.`,
          },
        }));
        return;
      }
    }
  }

  console.log(JSON.stringify({ continue: true }));
}

main().catch((e) => {
  try { fs.appendFileSync(path.join(os.homedir(), 'superclaw', 'data', 'logs', 'hooks.log'), `[${new Date().toISOString()}] [ERROR] [post-tool] ${e?.message ?? e}\n`); } catch {}
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
