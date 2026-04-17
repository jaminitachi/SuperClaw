/**
 * ULW verification log — append-only JSONL.
 *
 * Each entry is one of:
 *   {"mark":  "<filePath>", "ts": "<iso8601>"}  // file was edited, needs verification
 *   {"clear": "<filePath>", "ts": "<iso8601>"}  // file was read, verified
 *
 * Unverified state is computed by replaying the log in order. Re-editing a
 * file after verification emits a new "mark" event, so the replay correctly
 * tracks re-verification — the previous "clear" does NOT mask the new edit.
 *
 * Writes use appendFileSync with O_APPEND. On POSIX regular files, each
 * write(2) atomically seeks to EOF and writes under the inode lock — this
 * holds on both Linux and Darwin regardless of line size (distinct from
 * the PIPE_BUF guarantee, which applies to pipes/FIFOs). Two concurrent
 * hook processes therefore cannot interleave or lose JSON lines.
 */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const HOOK_LOG_PATH = join(homedir(), 'superclaw', 'data', 'logs', 'hooks.log');

function logError(scope, err) {
  // Best-effort error log. Silent catches would drop verification events on
  // disk-full / permission-denied, leading to false "verified" reports at the
  // Stop hook. Mirrors the pattern in sc-post-tool.mjs:23 / sc-pre-tool.mjs:262.
  try {
    appendFileSync(
      HOOK_LOG_PATH,
      `[${new Date().toISOString()}] [ERROR] [ulw-verify-log/${scope}] ${err?.message ?? err}\n`,
    );
  } catch { /* the logger itself failed — nothing more we can do */ }
}

function appendEvent(logPath, event) {
  if (!logPath) return;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n');
  } catch (err) {
    logError('appendEvent', err);
  }
}

export function markEdited(logPath, filePath) {
  if (!filePath) return;
  appendEvent(logPath, { mark: filePath });
}

export function markVerified(logPath, filePath) {
  if (!filePath) return;
  appendEvent(logPath, { clear: filePath });
}

/**
 * Parse all lines from the log and find the start index after the last
 * round-marker. Returns { events, startIdx } where startIdx is the index
 * of the first event to replay (0 = full replay, N = post-marker replay).
 *
 * @param {string} parseScope - error scope prefix for logError (e.g. 'loadUnverified')
 */
function parseLogLines(logPath, parseScope) {
  const events = [];
  if (!logPath || !existsSync(logPath)) return { events, startIdx: 0 };
  try {
    const lines = readFileSync(logPath, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch (err) { logError(`${parseScope}/parse`, err); }
    }
  } catch (err) { logError(`${parseScope}/read`, err); }

  // Find the last round-marker index
  let lastMarkerIdx = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === 'round-marker') lastMarkerIdx = i;
  }

  // Replay starts after the last round-marker (or from 0 if none)
  const startIdx = lastMarkerIdx === -1 ? 0 : lastMarkerIdx + 1;
  return { events, startIdx };
}

/**
 * Returns the Set of currently unverified file paths by replaying the log.
 * "mark" adds to the set, "clear" removes. Later events override earlier ones,
 * so re-edit → re-verify → re-edit correctly lands in "unverified" state.
 *
 * If a round-marker exists, only events AFTER the last round-marker are
 * replayed (round-aware boundary).
 */
export function loadUnverified(logPath) {
  const set = new Set();
  const { events, startIdx } = parseLogLines(logPath, 'loadUnverified');
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i];
    if (typeof e.mark === 'string') set.add(e.mark);
    else if (typeof e.clear === 'string') set.delete(e.clear);
  }
  return set;
}

/**
 * Returns the Set of ALL files that were ever marked edited in the current
 * round (regardless of verification state). Useful for audit logs / compaction
 * tags.
 *
 * If a round-marker exists, only events AFTER the last round-marker are
 * considered (round-aware boundary).
 */
export function loadAllEdited(logPath) {
  const set = new Set();
  const { events, startIdx } = parseLogLines(logPath, 'loadAllEdited');
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i];
    if (typeof e.mark === 'string') set.add(e.mark);
  }
  return set;
}
