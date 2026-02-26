#!/usr/bin/env node
/**
 * PostToolUse hook — verifies SuperClaw tool results after execution.
 */
import { readStdin } from './lib/stdin.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { todosPath, allowlistPath, agentFailuresPath } from './lib/session.mjs';

async function main() {
  const raw = await readStdin(2000);
  if (!raw.trim()) { console.log(JSON.stringify({ continue: true })); return; }

  let input;
  try { input = JSON.parse(raw); } catch { console.log(JSON.stringify({ continue: true })); return; }

  const toolName = input?.tool_name ?? input?.toolName ?? '';
  const result = input?.tool_response ?? input?.tool_result ?? input?.result ?? '';

  // RULE 1: Track TODO creation
  if (toolName === 'TaskCreate') {
    const sessionId = input?.session_id;
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

  // Ultrawork verification enforcement
  if (toolName === 'Task') {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

    // Check if ultrawork mode is active
    const ultraworkStatePath = path.join(os.homedir(), 'superclaw', 'data', 'ultrawork-state.json');
    let ultraworkActive = false;
    let state = null;
    try {
      if (fs.existsSync(ultraworkStatePath)) {
        state = JSON.parse(fs.readFileSync(ultraworkStatePath, 'utf-8'));
        ultraworkActive = state.active === true;
      }
    } catch {}

    if (ultraworkActive && state) {
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: [
            '⚡ ULTRAWORK MODE ACTIVE — Verification Protocol:',
            '1. NEVER trust this subagent result at face value',
            '2. Read changed files yourself (Read tool)',
            '3. Run lsp_diagnostics_directory on affected dirs',
            '4. Run tests if they exist',
            '5. Log verification via sc_verification_log',
            '6. Store learnings via sc_learning_store',
            `Current iteration: ${state?.iteration ?? '?'}/${state?.maxIterations ?? '?'}`,
            `Completion promise: ${state?.completionPromise ?? 'not set'}`,
          ].join('\n'),
        },
      }));
      return;
    }

    // Agent failure detection and circuit breaker (only if not in ultrawork)
    const isFailure = /error|failed|unable|timeout|could not/i.test(resultStr);

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
            additionalContext: `⚠️ Circuit breaker: ${agentType} has failed ${failures[agentType]} times. Consider escalating to a higher-tier agent (e.g., sonnet→opus) or delegating to superclaw:sc-architect for root-cause analysis.`,
          },
        }));
        return;
      }
    }
  }

  console.log(JSON.stringify({ continue: true }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
