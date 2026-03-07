#!/usr/bin/env node
/**
 * Stop hook — Sisyphus pattern: prevents premature exit when
 * ultrawork/ralph/autopilot modes or pipelines are active.
 * Create ~/.claude/.sc/state/{mode}-state.json to block exit.
 * Use /cancel skill or delete state files to allow exit.
 */
import { readStdin } from './lib/stdin.mjs';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

async function main() {
  const raw = await readStdin(2000);
  let input = {};
  try { input = JSON.parse(raw); } catch {}

  // Prevent infinite loop — if stop_hook_active is already set, allow exit
  if (input?.stop_hook_active) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const reasons = [];

  // Check 1: Active mode state files (Sisyphus pattern)
  const stateDir = join(homedir(), '.claude', '.sc', 'state');
  try {
    if (existsSync(stateDir)) {
      const files = readdirSync(stateDir).filter(f => f.endsWith('-state.json'));
      for (const f of files) {
        try {
          const state = JSON.parse(readFileSync(join(stateDir, f), 'utf-8'));
          if (state.active) {
            const mode = f.replace('-state.json', '');
            reasons.push(`${mode} mode is active (tasks: ${state.pendingTasks ?? '?'})`);
          }
        } catch {}
      }
    }
  } catch {}

  // Check 2: Active pipeline
  const pipelineFile = join(homedir(), 'superclaw', 'data', 'pipeline-state.json');
  try {
    if (existsSync(pipelineFile)) {
      const state = JSON.parse(readFileSync(pipelineFile, 'utf-8'));
      if (state.active) reasons.push('pipeline is running');
    }
  } catch {}

  if (reasons.length > 0) {
    console.log(JSON.stringify({
      decision: 'block',
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: `SuperClaw Sisyphus: ${reasons.join(', ')}. Continue working on pending tasks. To force exit, delete state files in ~/.claude/.sc/state/ or use /cancel.`,
      },
    }));
  } else {
    console.log(JSON.stringify({ continue: true }));
  }
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
