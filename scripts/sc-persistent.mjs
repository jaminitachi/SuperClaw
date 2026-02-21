#!/usr/bin/env node
/**
 * Stop hook — prevents premature exit when automation pipelines are running.
 */
import { readStdin } from './lib/stdin.mjs';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

async function main() {
  await readStdin(2000);

  // Check if any SuperClaw pipelines are actively running
  const stateFile = join(homedir(), 'superclaw', 'data', 'pipeline-state.json');
  let hasActivePipeline = false;

  try {
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      hasActivePipeline = state.active === true;
    }
  } catch {}

  if (hasActivePipeline) {
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: 'SuperClaw: Active pipeline detected. Complete the pipeline before stopping, or cancel with /sc-status.',
      },
    }));
  } else {
    console.log(JSON.stringify({ continue: true }));
  }
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
