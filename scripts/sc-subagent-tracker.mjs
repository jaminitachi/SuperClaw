#!/usr/bin/env node
/**
 * SubagentStart/SubagentStop hook — tracks SuperClaw agent lifecycle.
 */
import { readStdin } from './lib/stdin.mjs';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { subagentTrackingPath } from './lib/session.mjs';

function loadState(trackingPath) {
  try {
    return JSON.parse(readFileSync(trackingPath, 'utf-8'));
  } catch {
    return { active: [], completed: 0, total: 0 };
  }
}

function saveState(state, trackingPath) {
  const dir = join(trackingPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(trackingPath, JSON.stringify(state, null, 2));
}

const action = process.argv[2]; // 'start' or 'stop'

async function main() {
  const raw = await readStdin(2000);
  if (!raw.trim()) { console.log(JSON.stringify({ continue: true })); return; }

  let input;
  try { input = JSON.parse(raw); } catch { console.log(JSON.stringify({ continue: true })); return; }

  const trackingPath = subagentTrackingPath(input?.session_id);
  const state = loadState(trackingPath);
  const agentType = input?.agent_type ?? input?.tool_input?.subagent_type ?? input?.agentType ?? 'unknown';
  const agentName = agentType.replace('superclaw:', '');

  if (action === 'start') {
    state.active.push({ name: agentName, startedAt: new Date().toISOString() });
    state.total++;
    saveState(state, trackingPath);

    const activeNames = state.active.map(a => a.name).join(', ');
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SubagentStart',
        additionalContext: `SuperClaw: Agent started: ${agentName} | Active: ${state.active.length} [${activeNames}] | Total: ${state.total}`,
      },
    }));
  } else if (action === 'stop') {
    const idx = state.active.findIndex(a => a.name === agentName);
    if (idx >= 0) state.active.splice(idx, 1);
    state.completed++;
    saveState(state, trackingPath);

    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SubagentStop',
        additionalContext: `SuperClaw: Agent completed: ${agentName} | Running: ${state.active.length} | Completed: ${state.completed}`,
      },
    }));
  } else {
    console.log(JSON.stringify({ continue: true }));
  }
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
