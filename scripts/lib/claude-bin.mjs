import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export function findClaudeBin() {
  try {
    const p = execSync('which claude 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (p) return p;
  } catch {}
  const candidates = [
    '/Applications/cmux.app/Contents/Resources/bin/claude',
    join(homedir(), '.local/bin/claude'),
    '/usr/local/bin/claude',
  ];
  for (const c of candidates) { if (existsSync(c)) return c; }
  return 'claude';
}
