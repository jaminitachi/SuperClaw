/**
 * Ratchet Engine — commit-on-success / reset-on-failure loop for sc-daemon.
 *
 * Each successful task iteration is committed (ratcheted forward).
 * Failures trigger a git reset to the last known-good state.
 * Consecutive failures escalate to dev-architect.
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface RatchetState {
  taskId: string;
  iteration: number;
  consecutiveFailures: number;
  status: 'running' | 'complete' | 'escalated';
  lastCheckpoint: string;
}

const STATE_PATH = join(process.env.HOME!, '.claude', '.sc', 'state', 'ratchet.json');

export function loadRatchetState(): RatchetState | null {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf-8')); }
  catch { return null; }
}

export function saveRatchetState(state: RatchetState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function ratchetCommit(projectDir: string, message: string): boolean {
  try {
    execFileSync('git', ['-C', projectDir, 'add', '-A'], { timeout: 15000 });
    execFileSync('git', ['-C', projectDir, 'commit', '-m', message], { timeout: 15000 });
    return true;
  } catch { return false; }
}

export function ratchetReset(projectDir: string): boolean {
  try {
    execFileSync('git', ['-C', projectDir, 'reset', '--hard', 'HEAD'], { timeout: 10000 });
    return true;
  } catch { return false; }
}

export function appendChangelog(projectDir: string, entry: string): void {
  const changelogPath = join(projectDir, 'CHANGELOG.md');
  const timestamp = new Date().toISOString();
  const line = `\n## ${timestamp}\n${entry}\n`;
  if (existsSync(changelogPath)) {
    appendFileSync(changelogPath, line);
  } else {
    writeFileSync(changelogPath, `# CHANGELOG\n${line}`);
  }
}

export function shouldEscalate(state: RatchetState): boolean {
  return state.consecutiveFailures >= 3;
}
