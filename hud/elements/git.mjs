import { dim, cyan } from '../colors.mjs';
import { execSync } from 'child_process';

export function renderGitRepo(cwd) {
  try {
    const name = execSync('git rev-parse --show-toplevel 2>/dev/null', { cwd, encoding: 'utf-8', timeout: 2000 })
      .trim().split('/').pop();
    return name ? `repo:${dim(name)}` : null;
  } catch { return null; }
}

export function renderGitBranch(cwd) {
  try {
    const branch = execSync('git branch --show-current 2>/dev/null', { cwd, encoding: 'utf-8', timeout: 2000 }).trim();
    return branch ? `branch:${cyan(branch)}` : null;
  } catch { return null; }
}
