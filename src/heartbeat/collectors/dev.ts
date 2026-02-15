import { execSync } from 'child_process';
import { existsSync } from 'fs';

export interface DevMetrics {
  git?: { branch: string; uncommitted: number; ahead: number; behind: number };
  build?: { status: 'ok' | 'fail' | 'unknown'; output?: string };
  test?: { status: 'ok' | 'fail' | 'unknown'; passed?: number; failed?: number; output?: string };
  lint?: { status: 'ok' | 'fail' | 'unknown'; errors?: number; warnings?: number };
}

function tryExec(cmd: string, cwd?: string, timeoutMs = 15000): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd, timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export async function collect(projectDir?: string): Promise<DevMetrics> {
  const cwd = projectDir ?? process.cwd();
  const metrics: DevMetrics = {};

  // Git status
  if (existsSync(`${cwd}/.git`)) {
    const branch = tryExec('git rev-parse --abbrev-ref HEAD', cwd);
    const status = tryExec('git status --porcelain', cwd);
    const uncommitted = status ? status.split('\n').filter(Boolean).length : 0;

    let ahead = 0, behind = 0;
    const abOutput = tryExec('git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null', cwd);
    if (abOutput) {
      const parts = abOutput.split(/\s+/);
      ahead = parseInt(parts[0]) || 0;
      behind = parseInt(parts[1]) || 0;
    }

    metrics.git = { branch: branch ?? 'unknown', uncommitted, ahead, behind };
  }

  // Build check (try common build commands)
  if (existsSync(`${cwd}/package.json`)) {
    const result = tryExec('npm run build --dry-run 2>&1 | tail -1', cwd, 5000);
    metrics.build = { status: 'unknown', output: result ?? undefined };
  }

  return metrics;
}
