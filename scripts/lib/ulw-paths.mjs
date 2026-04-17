/**
 * Session-scoped ULW state paths.
 *
 * ALL ULW state (ultrawork-state.json, gates.json, ulw-verify-log.jsonl,
 * ulw-board.jsonl) lives under
 * ~/.claude/.sc/state/sessions/{sessionId}/.
 *
 * When sessionId is missing, every path function returns null — callers
 * MUST treat this as a no-op signal and skip their ULW operation. There
 * is NO global fallback; parallel sessions would otherwise clobber each
 * other's state.
 */
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';

export const STATE_DIR = join(homedir(), '.claude', '.sc', 'state');
export const SESSIONS_DIR = join(STATE_DIR, 'sessions');

export function sessionDir(sessionId) {
  if (!sessionId) return null;
  // Sanitize: only allow UUID-like session IDs (alphanumeric, hyphens, underscores)
  if (!/^[\w-]+$/.test(sessionId)) return null;
  const dir = join(SESSIONS_DIR, sessionId);
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { return null; }
  }
  return dir;
}

export function ulwStatePath(sessionId) {
  const d = sessionDir(sessionId);
  return d && join(d, 'ultrawork-state.json');
}

export function ulwGatesPath(sessionId) {
  const d = sessionDir(sessionId);
  return d && join(d, 'gates.json');
}

export function ulwVerifyLogPath(sessionId) {
  const d = sessionDir(sessionId);
  return d && join(d, 'ulw-verify-log.jsonl');
}

export function ulwBoardPath(sessionId) {
  const d = sessionDir(sessionId);
  return d && join(d, 'ulw-board.jsonl');
}
