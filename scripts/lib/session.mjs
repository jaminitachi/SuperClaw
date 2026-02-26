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

export function subagentTrackingPath(sessionId) {
  return join(getSessionDir(sessionId), 'subagent-tracking.json');
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
