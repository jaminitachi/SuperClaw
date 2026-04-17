/**
 * Session-scoped state utilities.
 * All hooks receive session_id in stdin JSON — use it to isolate state per session.
 */
import { existsSync, mkdirSync, unlinkSync, readdirSync, rmdirSync } from 'fs';
import { join } from 'path';

const STATE_DIR = '/tmp/sc-sessions';

export function getSessionDir(sessionId) {
  const id = sessionId || 'default';
  const dir = join(STATE_DIR, id);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function todosPath(sessionId) {
  return join(getSessionDir(sessionId), 'todos-created');
}

export function allowlistPath(sessionId) {
  return join(getSessionDir(sessionId), 'file-allowlist.json');
}

export function agentFailuresPath(sessionId) {
  return join(getSessionDir(sessionId), 'agent-failures.json');
}

export function getSessionAge(startedAt) {
  if (!startedAt) return '0m';
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return '0m';
  const elapsed = Date.now() - start;
  if (elapsed < 0) return '0m';

  const days = Math.floor(elapsed / 86_400_000);
  const hours = Math.floor((elapsed % 86_400_000) / 3_600_000);
  const minutes = Math.floor((elapsed % 3_600_000) / 60_000);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function cleanupSession(sessionId) {
  if (!sessionId) return;
  const dir = join(STATE_DIR, sessionId);
  if (existsSync(dir)) {
    try {
      const files = readdirSync(dir);
      for (const f of files) unlinkSync(join(dir, f));
      rmdirSync(dir);
    } catch {}
  }
}
