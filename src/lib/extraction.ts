/**
 * Shared transcript extraction logic.
 *
 * Used by sc-daemon's TranscriptWatcher. Replaces the in-hook path that
 * called `claude -p` (which suffered permission/timeout issues tied to the
 * Claude Code parent lifecycle). Now uses `codex exec` (OAuth, no API key,
 * independent process) with a 10-minute timeout by default.
 */
import { readFileSync, existsSync, mkdirSync, symlinkSync } from 'fs';
import { execFile } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

export const MIN_TRANSCRIPT_LENGTH = 200;
const HOME = homedir();

// ─── Types ───────────────────────────────────────────────────────

export interface Learnings {
  summary?: string;
  decisions?: string[];
  failures?: string[];
  bugs_fixed?: string[];
  issues?: string[];
  gotchas?: string[];
  configs_changed?: string[];
  learnings?: string[];
  tools_used?: string[];
}

export interface TranscriptParse {
  transcriptText: string;
  userCount: number;
  assistantCount: number;
}

// ─── Transcript parsing ──────────────────────────────────────────

interface RawEntry {
  type?: string;
  message?: {
    content?: unknown;
  };
}

export function readTranscript(transcriptPath: string): TranscriptParse {
  const userMessages: string[] = [];
  const assistantMessages: string[] = [];

  try {
    const raw = readFileSync(transcriptPath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      let entry: RawEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const t = entry.type;
      if ((t === 'human' || t === 'user') && entry.message?.content) {
        const content = Array.isArray(entry.message.content)
          ? entry.message.content
              .filter((c: { type?: string }) => c.type === 'text')
              .map((c: { text?: string }) => c.text ?? '')
              .join(' ')
          : String(entry.message.content);
        if (content.trim()) userMessages.push(content);
      }

      if (t === 'assistant' && entry.message?.content) {
        const content = Array.isArray(entry.message.content)
          ? entry.message.content
              .filter((c: { type?: string }) => c.type === 'text')
              .map((c: { text?: string }) => c.text ?? '')
              .join(' ')
          : String(entry.message.content);
        if (content.trim()) assistantMessages.push(content);
      }
    }
  } catch {
    return { transcriptText: '', userCount: 0, assistantCount: 0 };
  }

  const parts: string[] = [];
  const max = Math.max(userMessages.length, assistantMessages.length);
  for (let i = 0; i < max; i++) {
    if (userMessages[i]) parts.push(`[User]: ${userMessages[i]}`);
    if (assistantMessages[i]) parts.push(`[Assistant]: ${assistantMessages[i]}`);
  }

  return {
    transcriptText: parts.join('\n\n'),
    userCount: userMessages.length,
    assistantCount: assistantMessages.length,
  };
}

export function extractProjectFromTranscriptPath(transcriptPath: string | null | undefined): string {
  if (!transcriptPath) return 'general';
  try {
    const dirMatch = transcriptPath.match(/\/projects\/(-Users-[^/]+)\//);
    if (!dirMatch) return 'general';
    const dirName = dirMatch[1]!;
    const homeSegments = HOME.split('/').filter(Boolean);
    const prefix = '-' + homeSegments.join('-');
    if (dirName === prefix) return 'general';
    if (dirName.startsWith(prefix + '-')) {
      return dirName.slice(prefix.length + 1).toLowerCase();
    }
    return 'general';
  } catch {
    return 'general';
  }
}

// ─── JSON response parsing ───────────────────────────────────────

export function parseJsonFromResponse(text: string | null | undefined): Learnings | null {
  if (!text) return null;
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned) as Learnings;
  } catch {
    // fall through
  }
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    else if (cleaned[i] === '}') depth--;
    if (depth === 0) {
      try {
        return JSON.parse(cleaned.slice(start, i + 1)) as Learnings;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ─── Extraction via codex exec ───────────────────────────────────

function buildExtractionPrompt(transcriptText: string): string {
  const truncated =
    transcriptText.length > 15000 ? transcriptText.slice(-15000) : transcriptText;

  return `<task>
아래 세션 트랜스크립트를 분석하고 핵심 러닝을 추출해.
반드시 JSON만 출력해. 설명이나 다른 텍스트는 절대 쓰지 마.
파일을 읽거나 쓰지 말고, 오직 프롬프트 안의 트랜스크립트만 분석해.
</task>

<format>
{"summary":"1-2문장 요약","decisions":["기술적 결정"],"failures":["실패한 것들"],"bugs_fixed":["수정한 버그"],"issues":["향후 주의 필요한 알려진 문제"],"gotchas":["의외의 엣지케이스"],"configs_changed":["변경한 설정"],"learnings":["인사이트"],"tools_used":["도구"]}
</format>

<category_guide>
- failures: Something broke, crashed, errored, or didn't work as expected
- issues: Known problems or limitations that need future attention (not actual failures)
- gotchas: Surprising edge cases or counterintuitive behaviors discovered
- decisions: Choices made and their rationale
- bugs_fixed: Bugs that were actually fixed during this session
- configs_changed: Configuration changes made
- learnings: Patterns, conventions, or insights discovered
- tools_used: Useful CLI commands or tool invocations learned
</category_guide>

<rules>
- 없는 카테고리는 빈 배열
- 항목당 1문장
- 한국어 우선
- JSON 외 텍스트 금지
- 코드 실행/파일 접근 금지 — 읽기·쓰기 없이 JSON만 반환
</rules>

<transcript>
${truncated}
</transcript>`;
}

export interface ExtractOptions {
  timeoutMs?: number;
}

/**
 * Extract the "codex" response section from codex exec stdout.
 *
 * codex exec prints: metadata header → echoed prompt → "--------" → "user" →
 * <echoed prompt> → "codex" → <actual response> → "tokens used" → <usage>.
 * We need the text between the last `\ncodex\n` marker and the next
 * `\ntokens used` marker, otherwise a naive JSON scan picks up the
 * {"format":"..."} example embedded in the echoed prompt.
 */
function extractCodexResponseSection(stdout: string): string {
  // Find the last occurrence of "\ncodex\n" which precedes the actual response
  const codexMarkers: number[] = [];
  let idx = stdout.indexOf('\ncodex\n');
  while (idx !== -1) {
    codexMarkers.push(idx);
    idx = stdout.indexOf('\ncodex\n', idx + 1);
  }
  if (codexMarkers.length === 0) return stdout;

  const start = codexMarkers[codexMarkers.length - 1]! + '\ncodex\n'.length;
  const tokensUsedIdx = stdout.indexOf('\ntokens used', start);
  const end = tokensUsedIdx === -1 ? stdout.length : tokensUsedIdx;
  return stdout.slice(start, end).trim();
}

/**
 * Ensure a dedicated, minimal CODEX_HOME directory exists that contains only
 * a symlink to the user's auth.json. This isolates extraction from the user's
 * config.toml (which loads oh-my-codex MCP servers and sets reasoning
 * defaults that cause multi-minute delays for simple JSON tasks).
 *
 * With an empty CODEX_HOME, codex runs with:
 *   - reasoning effort: none
 *   - No MCP servers loaded
 *   - Default model unless -m overrides
 */
function ensureExtractionCodexHome(): string {
  const extractionHome = join(HOME, 'superclaw', 'data', 'codex-extraction-home');
  const authLink = join(extractionHome, 'auth.json');
  const realAuth = join(HOME, '.codex', 'auth.json');

  try {
    if (!existsSync(extractionHome)) {
      mkdirSync(extractionHome, { recursive: true });
    }
    if (!existsSync(authLink) && existsSync(realAuth)) {
      symlinkSync(realAuth, authLink);
    }
  } catch {
    // Best effort — if anything fails, caller will still try codex and
    // degrade gracefully via execFile error handling.
  }
  return extractionHome;
}

/**
 * Run codex exec with the extraction prompt and parse the JSON response.
 * Returns null on any failure (timeout, non-zero exit, parse error).
 *
 * Performance strategy:
 *   - CODEX_HOME points to an isolated dir with only auth.json → skips
 *     user's config.toml (which loads 8+ oh-my-codex MCP servers and sets
 *     gpt-5.3-codex with reasoning, adding minutes of overhead per call).
 *   - -m gpt-5.4: fast non-reasoning-heavy model compatible with ChatGPT OAuth.
 *   - -s read-only: safest sandbox mode.
 */
export function extractLearningsViaCodex(
  transcriptText: string,
  opts: ExtractOptions = {}
): Promise<Learnings | null> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const prompt = buildExtractionPrompt(transcriptText);
  const codexHome = ensureExtractionCodexHome();

  return new Promise((resolve) => {
    const cleanEnv: Record<string, string | undefined> = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE;
    delete cleanEnv.CLAUDE_CODE_RUNNING;
    delete cleanEnv.CLAUDE_CODE_SESSION;
    delete cleanEnv.CLAUDE_CODE_ENTRY_POINT;
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith('CMUX_')) delete cleanEnv[key];
    }
    cleanEnv.SUPERCLAW_DAEMON = '1';
    cleanEnv.CODEX_HOME = codexHome;

    const child = execFile(
      'claude',
      ['-p', '--model', 'haiku', '--permission-mode', 'bypassPermissions', '--max-turns', '1', prompt],
      {
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
        env: cleanEnv as NodeJS.ProcessEnv,
        cwd: HOME,
      },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const text = (stdout ?? '').toString();
        if (!text.trim()) {
          resolve(null);
          return;
        }
        const learnings = parseJsonFromResponse(text);
        resolve(learnings);
      }
    );

    child.stdin?.end();

    child.on('error', () => resolve(null));
  });
}

// ─── Save to memory.db ───────────────────────────────────────────

const CATEGORY_MAP: Record<keyof Learnings, string> = {
  summary: '',
  decisions: 'decisions',
  failures: 'failures',
  bugs_fixed: 'issues',
  issues: 'issues',
  gotchas: 'gotchas',
  configs_changed: 'commands',
  learnings: 'conventions',
  tools_used: 'conventions',
};

interface LearningRow {
  category: string;
  content: string;
  project: string;
  tags: string;
}

interface DbLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    run: (...args: unknown[]) => unknown;
  };
  close: () => void;
}

export async function saveToMemoryDb(
  learnings: Learnings,
  project: string,
  dbPath?: string
): Promise<number> {
  const finalDbPath = dbPath ?? join(HOME, 'superclaw', 'data', 'memory.db');
  if (!existsSync(finalDbPath)) return 0;

  // Dynamic import — better-sqlite3 is marked external by esbuild and
  // resolved at runtime from node_modules.
  const mod = await import('better-sqlite3');
  const Database = (mod as unknown as { default: new (p: string) => DbLike }).default;
  const db = new Database(finalDbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      project TEXT DEFAULT '',
      session_id TEXT DEFAULT '',
      iteration INTEGER DEFAULT 0,
      tags TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const insertStmt = db.prepare(
    'INSERT INTO learnings (category, content, project, tags) VALUES (?, ?, ?, ?)'
  );
  const existsStmt = db.prepare('SELECT 1 FROM learnings WHERE content = ? LIMIT 1');

  let count = 0;
  const keys: (keyof Learnings)[] = [
    'decisions',
    'failures',
    'bugs_fixed',
    'issues',
    'gotchas',
    'configs_changed',
    'learnings',
    'tools_used',
  ];

  for (const key of keys) {
    const items = learnings[key];
    if (!Array.isArray(items) || items.length === 0) continue;
    const dbCategory = CATEGORY_MAP[key];
    if (!dbCategory) continue;
    for (const item of items) {
      if (typeof item === 'string' && item.trim()) {
        const row: LearningRow = {
          category: dbCategory,
          content: item.trim(),
          project,
          tags: String(key),
        };
        const already = existsStmt.get(row.content);
        if (!already) {
          insertStmt.run(row.category, row.content, row.project, row.tags);
          count++;
        }
      }
    }
  }

  db.close();
  return count;
}

// ─── Sync to SC notepad ──────────────────────────────────────────

export function syncToScNotepad(learnings: Learnings, notepadPath?: string): void {
  const finalPath =
    notepadPath ?? join(HOME, '.claude', '.sc', 'notepad.json');
  try {
    const { mkdirSync, writeFileSync } = require('fs') as typeof import('fs');
    const notepadDir = join(HOME, '.claude', '.sc');

    let notepad: { priority: string; entries: Record<string, unknown> } = {
      priority: '',
      entries: {},
    };
    if (existsSync(finalPath)) {
      try {
        const rawParsed = JSON.parse(readFileSync(finalPath, 'utf-8'));
        notepad.priority = rawParsed.priority || '';
        notepad.entries = rawParsed.entries || {};
      } catch {
        // ignore — use fresh notepad
      }
    } else {
      mkdirSync(notepadDir, { recursive: true });
    }

    const summaryLines = [
      learnings.summary || '',
      ...(learnings.decisions || []).map((d) => `[decision] ${d}`),
      ...(learnings.failures || []).map((f) => `[failure] ${f}`),
      ...(learnings.bugs_fixed || []).map((b) => `[fix] ${b}`),
      ...(learnings.learnings || []).map((l) => `[learning] ${l}`),
    ].filter(Boolean);

    notepad.entries['last-session'] = {
      content: summaryLines.join('\n').slice(0, 2000),
      updated_at: new Date().toISOString(),
    };

    writeFileSync(finalPath, JSON.stringify(notepad, null, 2), 'utf-8');
  } catch {
    // Non-critical — notepad sync failure should not block extraction
  }
}
