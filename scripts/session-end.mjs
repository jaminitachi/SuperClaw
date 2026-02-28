#!/usr/bin/env node
/**
 * SessionEnd hook — extracts learnings from the session and persists them
 * to both SC memory (via MCP reminder) and SC notepad working memory.
 */
import { readStdin } from './lib/stdin.mjs';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOOK_LOG_PATH = join(homedir(), 'superclaw', 'data', 'logs', 'hooks.log');

function logError(context, err) {
  try {
    const ts = new Date().toISOString();
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.split('\n')[1]?.trim() || '' : '';
    const line = `[${ts}] [ERROR] [${context}] ${msg}${stack ? ' | ' + stack : ''}\n`;
    mkdirSync(join(homedir(), 'superclaw', 'data', 'logs'), { recursive: true });
    appendFileSync(HOOK_LOG_PATH, line);
  } catch {
    // Last-resort: cannot even log the error
  }
}

/**
 * Read transcript JSONL and return combined text plus separated message arrays.
 * Returns { transcriptText, userMessages, assistantMessages }.
 */
function readTranscript(data) {
  const transcriptPath = data.transcript_path;
  if (!transcriptPath) return { transcriptText: '', userMessages: [], assistantMessages: [] };

  const userMessages = [];
  const assistantMessages = [];

  try {
    const raw = readFileSync(transcriptPath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if ((entry.type === 'human' || entry.type === 'user') && entry.message?.content) {
          const content = Array.isArray(entry.message.content)
            ? entry.message.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join(' ')
            : String(entry.message.content);
          if (content.trim()) userMessages.push(content);
        }

        if (entry.type === 'assistant' && entry.message?.content) {
          const content = Array.isArray(entry.message.content)
            ? entry.message.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join(' ')
            : String(entry.message.content);
          if (content.trim()) assistantMessages.push(content);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (e) { logError('readTranscript', e); return { transcriptText: '', userMessages: [], assistantMessages: [] }; }

  const allParts = [];
  for (let i = 0; i < Math.max(userMessages.length, assistantMessages.length); i++) {
    if (userMessages[i]) allParts.push(`[User]: ${userMessages[i]}`);
    if (assistantMessages[i]) allParts.push(`[Assistant]: ${assistantMessages[i]}`);
  }

  const transcriptText = allParts.join('\n\n');
  return { transcriptText, userMessages, assistantMessages };
}

/**
 * Extract session learnings using Claude Haiku via claude CLI spawn.
 * Uses Claude Code's own authentication — no API key required.
 * Falls back to direct API if ANTHROPIC_API_KEY is available.
 * Returns a structured learnings object, or null on failure.
 */
async function extractLearningsWithLLM(transcriptText) {
  // Take the last 30000 chars — most recent context is most valuable
  const truncated = transcriptText.length > 30000
    ? transcriptText.slice(-30000)
    : transcriptText;

  const fullPrompt = `<task>
아래 세션 트랜스크립트를 분석하고 핵심 러닝을 추출해.
반드시 JSON만 출력해. 설명이나 다른 텍스트는 절대 쓰지 마.
</task>

<format>
{"summary":"1-2문장 요약","decisions":["기술적 결정"],"bugs_fixed":["수정한 버그"],"configs_changed":["변경한 설정"],"learnings":["인사이트"],"tools_used":["도구"]}
</format>

<rules>
- 없는 카테고리는 빈 배열
- 항목당 1문장
- 한국어 우선
- JSON 외 텍스트 금지
</rules>

<transcript>
${truncated}
</transcript>`;

  // Strategy 1: Direct API call if ANTHROPIC_API_KEY is available (fastest)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: fullPrompt }],
        }),
      });

      if (response.ok) {
        const json = await response.json();
        const text = json?.content?.[0]?.text;
        if (text) {
          return parseJsonFromResponse(text);
        }
      }
    } catch (e) { logError('extractLearnings/api', e); }
  }

  // Strategy 2: Spawn claude CLI (uses Claude Code's OAuth auth)
  try {
    const { spawn } = await import('child_process');

    const result = await new Promise((resolve) => {
      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;
      delete cleanEnv.CLAUDE_CODE;
      delete cleanEnv.CLAUDE_CODE_RUNNING;
      delete cleanEnv.CLAUDE_CODE_SESSION;
      delete cleanEnv.CLAUDE_CODE_ENTRY_POINT;
      // Prevent recursive SessionEnd hooks in the spawned claude process
      cleanEnv.SUPERCLAW_DAEMON = '1';

      const child = spawn('claude', [
        '-p', fullPrompt,
        '--model', 'haiku',
        '--output-format', 'json',
        '--max-turns', '1',
        '--tools', '',
      ], {
        env: cleanEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.on('close', () => resolve(stdout.trim()));
      child.on('error', () => resolve(''));

      // Hard timeout — kill after 25 seconds
      setTimeout(() => { child.kill('SIGTERM'); resolve(''); }, 25000);
    });

    if (!result) return null;

    // Parse claude CLI JSON output: {"type":"result","result":"...","session_id":"..."}
    const cliOutput = JSON.parse(result);
    const modelResponse = cliOutput?.result;
    if (!modelResponse) return null;

    // The model's response should be JSON — extract it robustly
    return parseJsonFromResponse(modelResponse);
  } catch (e) { logError('extractLearnings/cli', e); return null; }
}

/**
 * Robustly extract JSON from a model response that may contain surrounding text.
 */
function parseJsonFromResponse(text) {
  if (!text) return null;

  // Strip markdown code fences
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  // Try direct parse first
  try { return JSON.parse(cleaned); } catch {}

  // Find JSON object in the text using brace matching
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
 * Extract session learnings from transcript text using regex patterns.
 * Kept as fallback when LLM extraction is unavailable.
 * Returns an array of insight strings.
 */
function extractLearningsRegex(transcriptText) {
  const insights = [];

  if (!transcriptText) return insights;

  // Extract error resolutions
  const errorPatterns = transcriptText.match(/(?:fixed|resolved|solved|debugged)\s+(.{10,80})/gi);
  if (errorPatterns) {
    for (const match of errorPatterns.slice(0, 3)) {
      insights.push(match.trim());
    }
  }

  // Extract configuration changes
  const configPatterns = transcriptText.match(/(?:configured|set up|installed|enabled)\s+(.{10,60})/gi);
  if (configPatterns) {
    for (const match of configPatterns.slice(0, 2)) {
      insights.push(match.trim());
    }
  }

  return insights;
}

/**
 * Persist structured learnings to ~/superclaw/data/memory.db.
 * Silently skips if better-sqlite3 is unavailable or the DB is inaccessible.
 */
async function saveToMemoryDb(learnings) {
  try {
    const dbPath = join(homedir(), 'superclaw', 'data', 'memory.db');
    if (!existsSync(dbPath)) return;

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);

    // Ensure learnings table exists
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

    const categoryMap = {
      decisions: 'decisions',
      bugs_fixed: 'issues',
      configs_changed: 'commands',
      learnings: 'conventions',
      tools_used: 'conventions',
    };

    const insertLearning = db.prepare(
      'INSERT INTO learnings (category, content, project, tags) VALUES (?, ?, ?, ?)'
    );

    for (const [key, dbCategory] of Object.entries(categoryMap)) {
      const items = learnings[key];
      if (!Array.isArray(items) || items.length === 0) continue;
      for (const item of items) {
        if (typeof item === 'string' && item.trim()) {
          const exists = db.prepare('SELECT 1 FROM learnings WHERE content = ? LIMIT 1').get(item.trim());
          if (!exists) {
            insertLearning.run(dbCategory, item.trim(), 'superclaw', key);
          }
        }
      }
    }

    // Insert summary into knowledge table (may or may not exist)
    try {
      const insertKnowledge = db.prepare(
        'INSERT INTO knowledge (category, subject, content, confidence) VALUES (?, ?, ?, ?)'
      );
      insertKnowledge.run(
        'session-summary',
        `Session summary ${new Date().toISOString().slice(0, 10)}`,
        JSON.stringify(learnings),
        0.7
      );
    } catch (e) { logError('saveToMemoryDb/knowledge', e); }

    db.close();
  } catch (e) { logError('saveToMemoryDb', e); }
}

/**
 * Trigger Obsidian incremental sync if configured.
 */
async function triggerObsidianSync() {
  try {
    const configPath = join(homedir(), 'superclaw', 'superclaw.json');
    if (!existsSync(configPath)) return;

    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));

    // Check if obsidian sync is configured for session_end
    if (!cfg.obsidian?.vaultPath || !cfg.obsidian?.syncOn?.includes('session_end')) return;

    const dbPath = join(homedir(), 'superclaw', 'data', 'memory.db');
    if (!existsSync(dbPath)) return;

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    const vaultPath = cfg.obsidian.vaultPath.startsWith('~')
      ? join(homedir(), cfg.obsidian.vaultPath.slice(1))
      : cfg.obsidian.vaultPath;

    // Load sync state for incremental sync
    const syncStatePath = join(homedir(), 'superclaw', 'data', 'obsidian-sync-state.json');
    let lastSync = null;
    if (existsSync(syncStatePath)) {
      try {
        const state = JSON.parse(readFileSync(syncStatePath, 'utf-8'));
        lastSync = state.lastSync || null;
      } catch {}
    }

    const include = cfg.obsidian.include || ['knowledge', 'entities', 'conversations'];

    // Export knowledge entries
    if (include.includes('knowledge')) {
      const query = lastSync
        ? 'SELECT * FROM knowledge WHERE updated_at > ? ORDER BY updated_at DESC'
        : 'SELECT * FROM knowledge ORDER BY updated_at DESC';
      const rows = lastSync ? db.prepare(query).all(lastSync) : db.prepare(query).all();

      for (const row of rows) {
        const catDir = join(vaultPath, 'Knowledge', row.category || 'uncategorized');
        mkdirSync(catDir, { recursive: true });
        const safeName = row.subject.replace(/[/\\:*?"<>|]/g, '_').slice(0, 80);
        const filePath = join(catDir, `${safeName}.md`);
        const content = [
          '---',
          `category: ${row.category}`,
          `confidence: ${row.confidence}`,
          `access_count: ${row.access_count}`,
          `updated_at: ${row.updated_at}`,
          `created_at: ${row.created_at}`,
          '---',
          '',
          `# ${row.subject}`,
          '',
          row.content,
        ].join('\n');
        writeFileSync(filePath, content, 'utf-8');
      }
    }

    db.close();

    // Update sync state
    mkdirSync(join(homedir(), 'superclaw', 'data'), { recursive: true });
    writeFileSync(syncStatePath, JSON.stringify({ lastSync: new Date().toISOString() }), 'utf-8');

  } catch (e) { logError('triggerObsidianSync', e); }
}

async function main() {
  const input = await readStdin();
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    data = {};
  }

  // Skip learning extraction for daemon-spawned sessions (Telegram)
  // Only run when user explicitly ends a session (e.g., /new command)
  if (process.env.SUPERCLAW_DAEMON === '1') {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Read transcript
  const transcript = readTranscript(data);
  if (!transcript.transcriptText) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Try LLM extraction first (handles both API key and CLI strategies), fall back to regex
  let learnings = await extractLearningsWithLLM(transcript.transcriptText);

  if (!learnings) {
    // Fallback to regex
    const regexInsights = extractLearningsRegex(transcript.transcriptText);
    if (regexInsights.length > 0) {
      learnings = {
        summary: regexInsights.join('; '),
        decisions: [],
        bugs_fixed: regexInsights,
        configs_changed: [],
        learnings: [],
        tools_used: [],
      };
    }
  }

  if (learnings) {
    await saveToMemoryDb(learnings);
  }

  await triggerObsidianSync();
  console.log(JSON.stringify({ continue: true }));
}

main().catch((e) => { logError('main', e); console.log(JSON.stringify({ continue: true, suppressOutput: true })); });
