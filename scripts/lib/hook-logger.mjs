/**
 * Hook Trace Logger — records the FULL lifecycle of each user turn.
 *
 * Trace file: ~/.claude/.sc/state/traces/{sessionId}.jsonl
 * Summary:    ~/.claude/.sc/state/traces/{sessionId}.md  (human-readable)
 *
 * JSONL = every event (fast, append-only)
 * MD   = human-readable (only for low-frequency events: UserPromptSubmit, SessionStart)
 *        Pre/PostToolUse write JSONL only (called per tool, must be fast)
 */
import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TRACES_DIR = join(homedir(), '.claude', '.sc', 'state', 'traces');
let dirEnsured = false;

function ensureDir() {
  if (dirEnsured) return;
  if (!existsSync(TRACES_DIR)) {
    mkdirSync(TRACES_DIR, { recursive: true });
  }
  dirEnsured = true;
}

function sanitizeSessionId(sessionId) {
  // Prevent path traversal — strip anything that's not alphanumeric, dash, or underscore
  return (sessionId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

function traceFilePath(sessionId) {
  return join(TRACES_DIR, `${sanitizeSessionId(sessionId)}.jsonl`);
}

function mdFilePath(sessionId) {
  return join(TRACES_DIR, `${sanitizeSessionId(sessionId)}.md`);
}

const ROTATION_LIMIT = 1 * 1024 * 1024; // 1MB
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * If the current trace file exceeds 1MB, rotate it by renaming with a timestamp suffix.
 */
function maybeRotate(sessionId) {
  try {
    const current = traceFilePath(sessionId);
    if (!existsSync(current)) return;
    const { size } = statSync(current);
    if (size > ROTATION_LIMIT) {
      const ts = Date.now();
      renameSync(current, join(TRACES_DIR, `${sanitizeSessionId(sessionId)}.${ts}.jsonl`));
    }
  } catch { /* rotation must never break hooks */ }
}

/**
 * Delete trace files (*.jsonl and *.md) older than 7 days.
 */
function cleanupOldTraces() {
  try {
    const now = Date.now();
    const entries = readdirSync(TRACES_DIR);
    for (const name of entries) {
      if (!name.endsWith('.jsonl') && !name.endsWith('.md')) continue;
      const fullPath = join(TRACES_DIR, name);
      try {
        const { mtimeMs } = statSync(fullPath);
        if (now - mtimeMs > MAX_AGE_MS) {
          unlinkSync(fullPath);
        }
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* cleanup must never break hooks */ }
}

/**
 * Append a trace event. JSONL always, MD only for low-frequency events.
 */
export function trace(sessionId, event, data) {
  try {
    ensureDir();
    maybeRotate(sessionId);
    if (Math.random() < 0.01) cleanupOldTraces();
    const entry = { ts: new Date().toISOString(), event, ...data };
    appendFileSync(traceFilePath(sessionId), JSON.stringify(entry) + '\n');

    // MD only for low-frequency events (not per-tool-call)
    if (!event.startsWith('hook:PreToolUse') && !event.startsWith('hook:PostToolUse')) {
      appendToMd(sessionId, event, entry);
    }
  } catch { /* logging must never break hooks */ }
}

function appendToMd(sessionId, event, entry) {
  try {
    const mdPath = mdFilePath(sessionId);
    let line = '';

    if (event === 'hook:UserPromptSubmit:input') {
      line = `\n---\n\n## Turn @ ${entry.ts}\n\n### 1. User Prompt\n\`\`\`\n${entry.prompt || '(empty)'}\n\`\`\`\n`;
    } else if (event === 'hook:UserPromptSubmit:output') {
      const ctx = entry.additionalContext || '(none)';
      const teamsDetected = entry.teamsDetected || [];
      const skillsMatched = entry.skillsMatched || [];
      const taskType = entry.taskType || 'unknown';
      line = `\n### 2. Hook Injection (UserPromptSubmit)\n`;
      line += `- **Teams detected**: ${teamsDetected.length > 0 ? teamsDetected.join(', ') : 'none'}\n`;
      line += `- **Skills matched**: ${skillsMatched.length > 0 ? skillsMatched.join(', ') : 'none'}\n`;
      line += `- **Task type**: ${taskType}\n`;
      line += `- **Context length**: ${ctx.length} chars\n`;
      line += `<details><summary>Full additionalContext</summary>\n\n\`\`\`\n${ctx}\n\`\`\`\n</details>\n`;
    } else if (event === 'hook:SessionStart:output') {
      const ctx = entry.additionalContext || '';
      line = `\n### SessionStart Context\n- **Context length**: ${ctx.length} chars\n`;
    }

    if (line) {
      appendFileSync(mdPath, line);
    }
  } catch { /* non-critical */ }
}
