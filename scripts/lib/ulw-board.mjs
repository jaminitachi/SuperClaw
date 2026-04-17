/**
 * ULW shared message board — agents read/write during parallel execution.
 * Session-scoped: each ULW session has its own board under
 * ~/.claude/.sc/state/sessions/{sessionId}/ulw-board.jsonl.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { ulwBoardPath } from './ulw-paths.mjs';

export function postToBoard(sessionId, entry) {
  const path = ulwBoardPath(sessionId);
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
  } catch {}
}

export function readBoard(sessionId) {
  const path = ulwBoardPath(sessionId);
  if (!path) return [];
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

export function clearBoard(sessionId) {
  const path = ulwBoardPath(sessionId);
  if (!path) return;
  try {
    if (existsSync(path)) writeFileSync(path, '');
  } catch {}
}
