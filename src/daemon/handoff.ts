/**
 * Context Handoff — checkpoint/resume for daemon task continuations.
 *
 * Saves task progress (completed steps, pending steps, failed approaches)
 * so that a new Claude session can resume without redoing completed work.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface CheckpointData {
  taskDescription: string;
  completedSteps: string[];
  pendingSteps: string[];
  failedApproaches: string[];
  currentBranch: string;
  lastCommitHash: string;
  timestamp: string;
}

const CHECKPOINT_PATH = join(process.env.HOME!, '.claude', '.sc', 'state', 'checkpoint.json');

export function saveCheckpoint(data: CheckpointData): void {
  mkdirSync(dirname(CHECKPOINT_PATH), { recursive: true });
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(data, null, 2));
}

export function loadCheckpoint(): CheckpointData | null {
  if (!existsSync(CHECKPOINT_PATH)) return null;
  try { return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8')); }
  catch { return null; }
}

export function buildResumePrompt(checkpoint: CheckpointData): string {
  const lines: string[] = [
    `## Resuming Task: ${checkpoint.taskDescription}`,
    '',
    '### Completed:',
    ...checkpoint.completedSteps.map(s => `- [done] ${s}`),
    '',
    '### Pending:',
    ...checkpoint.pendingSteps.map(s => `- [pending] ${s}`),
    '',
  ];

  if (checkpoint.failedApproaches.length > 0) {
    lines.push(
      '### Failed Approaches (DO NOT RETRY):',
      ...checkpoint.failedApproaches.map(s => `- [failed] ${s}`),
      '',
    );
  }

  lines.push(
    `Branch: ${checkpoint.currentBranch}, Last commit: ${checkpoint.lastCommitHash}`,
    'Continue from where you left off. Do not redo completed steps.',
  );

  return lines.join('\n');
}
