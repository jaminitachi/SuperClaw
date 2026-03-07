#!/usr/bin/env node
/**
 * Learning Consolidation — compresses raw learnings into weekly digests.
 *
 * Runs weekly via cron. Takes 1000+ raw learnings, groups by category,
 * sends to Haiku for compression, stores result as "weekly-digest" knowledge.
 *
 * Usage:
 *   node scripts/learning-consolidate.mjs           # Full consolidation
 *   node scripts/learning-consolidate.mjs --dry-run  # Preview without writing
 */
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
// child_process.spawn used inline for claude CLI calls

const HOME = homedir();
const DB_PATH = join(HOME, 'superclaw', 'data', 'memory.db');
const LOG_PATH = join(HOME, 'superclaw', 'data', 'logs', 'consolidation.log');
const DRY_RUN = process.argv.includes('--dry-run');

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(join(HOME, 'superclaw', 'data', 'logs'), { recursive: true });
    appendFileSync(LOG_PATH, line + '\n');
  } catch {}
}

async function main() {
  log('=== Learning Consolidation Start ===');

  if (!existsSync(DB_PATH)) {
    log('ERROR: memory.db not found');
    process.exit(1);
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(DB_PATH);

  // Get all learnings grouped by category
  const categories = db.prepare(
    'SELECT DISTINCT category FROM learnings ORDER BY category'
  ).all().map(r => r.category);

  log(`Categories found: ${categories.join(', ')}`);

  const allLearnings = {};
  let totalCount = 0;

  for (const cat of categories) {
    const rows = db.prepare(
      'SELECT id, content, project, created_at FROM learnings WHERE category = ? ORDER BY created_at DESC'
    ).all(cat);
    allLearnings[cat] = rows;
    totalCount += rows.length;
    log(`  ${cat}: ${rows.length} entries`);
  }

  if (totalCount < 20) {
    log('Too few learnings to consolidate. Skipping.');
    db.close();
    return;
  }

  // Build consolidation prompt per category
  for (const cat of categories) {
    const entries = allLearnings[cat];
    if (entries.length < 5) {
      log(`  Skipping ${cat} (only ${entries.length} entries)`);
      continue;
    }

    log(`Consolidating ${cat} (${entries.length} → ~10 insights)...`);

    // Take up to 200 entries (most recent first), truncate each to 200 chars
    const sample = entries.slice(0, 200).map(e =>
      `- ${e.content.slice(0, 200)}${e.content.length > 200 ? '...' : ''}`
    ).join('\n');

    const prompt = `<task>
아래는 "${cat}" 카테고리의 학습 항목 ${entries.length}개 중 샘플입니다.
이것들을 분석하고, 가장 중요하고 반복적인 패턴/인사이트를 최대 10개로 압축해주세요.

규칙:
- 각 인사이트는 1-2문장
- 구체적이고 실행 가능한 형태 (예: "X할 때는 반드시 Y해야 함")
- 중복이나 사소한 것은 버림
- 프로젝트별로 묶을 수 있으면 묶음
- JSON 배열만 출력. 다른 텍스트 금지.

출력 형식: ["인사이트1", "인사이트2", ...]
</task>

<entries>
${sample}
</entries>`;

    if (DRY_RUN) {
      log(`  [DRY RUN] Would consolidate ${entries.length} → prompt length ${prompt.length}`);
      continue;
    }

    // Call Haiku via claude CLI (using spawn to avoid shell escaping issues)
    let insights = null;

    // Strategy 1: Direct API (fastest, no shell issues)
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: AbortSignal.timeout(30000),
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (res.ok) {
          const json = await res.json();
          const text = json?.content?.[0]?.text || '';
          const match = text.match(/\[[\s\S]*\]/);
          if (match) insights = JSON.parse(match[0]);
        }
      } catch (e) {
        log(`  API error for ${cat}: ${e.message}`);
      }
    }

    // Strategy 2: claude CLI via spawn (no shell interpretation)
    if (!insights) {
      try {
        const { spawn: spawnChild } = await import('child_process');
        const result = await new Promise((resolve) => {
          const cleanEnv = { ...process.env };
          delete cleanEnv.CLAUDECODE;
          delete cleanEnv.CLAUDE_CODE;
          delete cleanEnv.CLAUDE_CODE_RUNNING;
          cleanEnv.SUPERCLAW_DAEMON = '1';

          const child = spawnChild('claude', [
            '-p', prompt,
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
          setTimeout(() => { child.kill('SIGTERM'); resolve(''); }, 60000);
        });

        if (result) {
          const parsed = JSON.parse(result);
          const text = parsed?.result || '';
          const match = text.match(/\[[\s\S]*\]/);
          if (match) insights = JSON.parse(match[0]);
        }
      } catch (e) {
        log(`  CLI error for ${cat}: ${e.message}`);
      }
    }

    if (!insights || !Array.isArray(insights) || insights.length === 0) {
      log(`  Failed to consolidate ${cat}. Skipping.`);
      continue;
    }

    log(`  Compressed ${entries.length} → ${insights.length} insights`);

    // Store digest in knowledge table
    const digestContent = insights.map((ins, i) => `${i + 1}. ${ins}`).join('\n');
    const subject = `Weekly Digest: ${cat} (${new Date().toISOString().slice(0, 10)})`;

    db.prepare(
      'INSERT INTO knowledge (category, subject, content, confidence) VALUES (?, ?, ?, ?)'
    ).run('weekly-digest', subject, digestContent, 0.9);

    log(`  Stored digest: "${subject}"`);

    // Archive processed learnings (mark with tag)
    const ids = entries.map(e => e.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE learnings SET tags = CASE
        WHEN tags = '' OR tags IS NULL THEN 'archived'
        WHEN tags NOT LIKE '%archived%' THEN tags || ',archived'
        ELSE tags
      END
      WHERE id IN (${placeholders})`
    ).run(...ids);

    log(`  Archived ${ids.length} raw learnings`);
  }

  // Summary
  const remaining = db.prepare(
    "SELECT COUNT(*) as cnt FROM learnings WHERE tags NOT LIKE '%archived%' OR tags IS NULL OR tags = ''"
  ).get();
  const archived = db.prepare(
    "SELECT COUNT(*) as cnt FROM learnings WHERE tags LIKE '%archived%'"
  ).get();
  const digests = db.prepare(
    "SELECT COUNT(*) as cnt FROM knowledge WHERE category = 'weekly-digest'"
  ).get();

  log(`\n=== Consolidation Complete ===`);
  log(`Active learnings: ${remaining.cnt}`);
  log(`Archived learnings: ${archived.cnt}`);
  log(`Weekly digests: ${digests.cnt}`);

  db.close();
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
