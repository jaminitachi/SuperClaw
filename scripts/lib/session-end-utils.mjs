/**
 * Shared utilities for the session-end pipeline.
 */

/**
 * Minimum transcript length (chars) required for processing.
 */
export const MIN_TRANSCRIPT_LENGTH = 200;

const AUTH_ERROR_PATTERNS = [
  /not logged in/i,
  /please run \/login/i,
  /unauthorized/i,
  /authentication.*(?:failed|expired|required)/i,
];

const AUTH_STDERR_PATTERNS = [
  /not logged in/i,
  /please run \/login/i,
  /unauthorized/i,
];

/**
 * Check if transcript text contains auth error patterns.
 * @param {string} transcriptText
 * @returns {boolean}
 */
export function isAuthErrorSession(transcriptText) {
  return AUTH_ERROR_PATTERNS.some((re) => re.test(transcriptText));
}

/**
 * Check if stderr from the claude CLI indicates an auth failure.
 * @param {string} stderr
 * @returns {boolean}
 */
export function isAuthError(stderr) {
  return AUTH_STDERR_PATTERNS.some((re) => re.test(stderr));
}

/**
 * Robustly extract a JSON object from a model response string.
 * Handles: plain JSON, ```json fences, plain ``` fences, and prose with
 * embedded JSON objects.
 * @param {string | null | undefined} text
 * @returns {object | null}
 */
export function parseJsonFromResponse(text) {
  if (!text) return null;
  // Strip optional code-fence wrapper (```json ... ``` or ``` ... ```)
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // Try direct parse first
  try { return JSON.parse(cleaned); } catch {}
  // Scan for the first '{' and walk to the matching '}'
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    else if (cleaned[i] === '}') depth--;
    if (depth === 0) {
      try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

/**
 * Clone env and sanitise it for headless `claude -p` invocations.
 * Removes claude-code re-entrancy markers and CMUX_ namespace keys,
 * then sets the two daemon sentinel variables.
 * @param {object} env
 * @returns {object}
 */
export function cleanEnvironment(env) {
  const cleaned = { ...env };

  // Remove claude-code re-entrancy markers
  delete cleaned.CLAUDECODE;
  delete cleaned.CLAUDE_CODE;
  delete cleaned.CLAUDE_CODE_RUNNING;
  delete cleaned.CLAUDE_CODE_SESSION;
  delete cleaned.CLAUDE_CODE_ENTRY_POINT;

  // Remove all CMUX_ prefixed keys
  for (const key of Object.keys(cleaned)) {
    if (key.startsWith('CMUX_')) {
      delete cleaned[key];
    }
  }

  // Mark invocation as headless daemon
  cleaned.SUPERCLAW_DAEMON = '1';
  cleaned.CMUX_CLAUDE_HOOKS_DISABLED = '1';

  return cleaned;
}
