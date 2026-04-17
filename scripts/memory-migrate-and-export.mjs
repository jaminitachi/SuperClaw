#!/usr/bin/env node
/**
 * Memory Migration & Export
 *
 * 1. migrate: Inserts Claude Code .md memory into knowledge DB (one-time)
 * 2. export: DB → individual .md files + MEMORY.md index
 *
 * MEMORY.md = index only (file path + 1-line description)
 * Individual .md files = actual content (with frontmatter)
 * SSOT = knowledge table in memory.db
 *
 * Usage:
 *   node scripts/memory-migrate-and-export.mjs migrate
 *   node scripts/memory-migrate-and-export.mjs export
 *   node scripts/memory-migrate-and-export.mjs both
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { cleanEnvironment } from './lib/session-end-utils.mjs';
import { findClaudeBin } from './lib/claude-bin.mjs';

const HOME = homedir();
const DB_PATH = join(HOME, 'superclaw', 'data', 'memory.db');
const PROJECTS_BASE = join(HOME, '.claude', 'projects');
const MEMORY_DIR = join(PROJECTS_BASE, '-Users-daehanlim', 'memory');
const MEMORY_MD = join(MEMORY_DIR, 'MEMORY.md');

/**
 * Map: project directory name → DB project names (used in weekly-digest subjects and learnings)
 * weekly-digest subject format: "Weekly Digest: <project> (date)"
 */
const PROJECT_MAP = {
  'Neo':      ['neo', 'neo-neo-server', 'neo_app'],
  'tiro':     ['tiro'],
  'quant':    ['quant-deploy'],
  'superclaw':['superclaw'],
  'AITOP100': [],
};

const command = process.argv[2] || 'export';

async function getDb() {
  const Database = (await import('better-sqlite3')).default;
  return new Database(DB_PATH);
}

function upsertKnowledge(db, category, subject, content, confidence = 0.95) {
  const existing = db.prepare(
    "SELECT id FROM knowledge WHERE category = ? AND subject = ?"
  ).get(category, subject);

  if (existing) {
    db.prepare(
      "UPDATE knowledge SET content = ?, confidence = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(content, confidence, existing.id);
    console.log(`  Updated: [${category}] ${subject}`);
  } else {
    db.prepare(
      'INSERT INTO knowledge (category, subject, content, confidence) VALUES (?, ?, ?, ?)'
    ).run(category, subject, content, confidence);
    console.log(`  Created: [${category}] ${subject}`);
  }
}

const CLAUDE_BIN = findClaudeBin();

/**
 * Generate 1-line descriptions for knowledge entries missing them.
 * Uses LLM to summarize content into key points + keywords.
 */
async function fillDescriptions(db) {
  const missing = db.prepare(
    "SELECT id, category, subject, content FROM knowledge WHERE (description IS NULL OR description = '') AND (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')"
  ).all();

  if (missing.length === 0) {
    console.log('  All descriptions already filled.');
    return;
  }

  console.log(`  Generating descriptions for ${missing.length} entries...`);

  // Batch all entries into one LLM call for efficiency
  const entries = missing.map(r =>
    `[ID:${r.id}] [${r.category}] ${r.subject}\n${r.content.slice(0, 300)}`
  ).join('\n---\n');

  const prompt = `아래 knowledge 항목들에 대해 각각 1줄 description을 생성해.
규칙:
- 핵심 포인트 + 주요 키워드를 포함 (검색에 도움되게)
- 80자 이내
- JSON 배열로만 출력: [{"id": 숫자, "desc": "설명"}, ...]
- 다른 텍스트 없이 JSON만

${entries}`;

  try {
    const { spawnSync } = await import('child_process');
    const cleanEnv = cleanEnvironment(process.env);

    const res = spawnSync(CLAUDE_BIN, [
      '-p', '-',
      '--model', 'haiku',
      '--output-format', 'json',
      '--max-turns', '1',
      '--tools', '',
    ], { timeout: 90000, input: prompt, env: cleanEnv, maxBuffer: 2 * 1024 * 1024 });

    const result = (res.stdout || '').toString().trim();

    // Parse result
    const parsed = JSON.parse(result);
    const text = parsed?.result || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const descs = JSON.parse(match[0]);
      const update = db.prepare("UPDATE knowledge SET description = ? WHERE id = ?");
      let count = 0;
      for (const d of descs) {
        if (d.id && d.desc) {
          update.run(d.desc, d.id);
          count++;
        }
      }
      console.log(`  Generated ${count}/${missing.length} descriptions.`);
    }
  } catch (e) {
    console.log(`  LLM description generation failed: ${e.message?.slice(0, 100)}`);
    // Fallback: use first line of content
    const update = db.prepare("UPDATE knowledge SET description = ? WHERE id = ?");
    for (const r of missing) {
      const fallback = r.content.split('\n')[0].replace(/^[-*#>\s]+/, '').slice(0, 80);
      update.run(fallback, r.id);
    }
    console.log(`  Used fallback (first line) for ${missing.length} entries.`);
  }
}

/** Convert subject to safe filename */
function toFilename(category, subject) {
  const safe = subject
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50);
  return `${category}_${safe}.md`;
}

/** First line of content, trimmed to 80 chars */
function firstLine(content) {
  return content.split('\n')[0].replace(/^[-*#>\s]+/, '').slice(0, 80);
}

async function migrate() {
  console.log('=== Migrating .md → DB ===');
  const db = await getDb();

  upsertKnowledge(db, 'user', 'User Profile & Preferences',
`- Language: Korean (한국어), hates jargon
- Communication: direct, no BS, autonomous action preferred
- Gets frustrated when asked to repeat context — ALWAYS check memory first
- Wants triple-verification on important claims
- SuperClaw cron/memory/Telegram actively used
- Mac: Apple Silicon, 10 cores, 32GB RAM, macOS, 듀얼 모니터 환경
- Email: limdehan@gmail.com`);

  upsertKnowledge(db, 'feedback', 'ULW = Always Delegate',
`ULW/ultrawork 시 반드시 multi-model delegate. 예외 없음.
- codex/gemini/claude agents 병렬 디스패치 + cross-validate
- 솔로 분석 금지 — 2026-03-17 세션에서 codex가 잡은 7개 이슈 놓침
- Phase 2 검증은 실행 결과 evidence 필수`);

  upsertKnowledge(db, 'feedback', '지우자 ≠ 삭제',
`"지우자" = 프로세스 종료(닫기). 앱 삭제 아님.
- 삭제는 "삭제", "언인스톨", "완전히 지워" 등 명확한 지시 필요
- 삭제 전 반드시 재확인. Why: Wallper/Comet 삭제 사고`);

  upsertKnowledge(db, 'feedback', 'Cron CRLF/PATH Debugging',
`Cron 디버깅: 1) file script.sh로 CRLF 확인 2) PATH 설정 확인
- /var/mail/daehanlim에서 에러 로그 확인
- Why: CRLF로 2주간 전체 cron 사망 (2026-03-23)`);

  upsertKnowledge(db, 'feedback', 'Critical Rules',
`- NEVER deploy toy/placeholder code
- ALWAYS check ~/quant/ before deployment
- After SuperClaw change: npm run qa
- "test" = COMPREHENSIVE, not minimal
- 절대 다른 앱 숨기기 금지 (듀얼 모니터)
- 스크린샷 시 특정 앱 창만 캡처`);

  upsertKnowledge(db, 'reference', 'Infrastructure & Environment',
`- Python: 3.14 (system), uv 3.12 for quant
- HF Space: jamintachi-quant-trading-bot.hf.space
- Oracle Cloud: Chuncheon, PAYG, no ARM capacity
- SSH: ~/.ssh/id_ed25519.pub
- Calendar: icalBuddy (macOS Calendar Google 동기화)`);

  upsertKnowledge(db, 'reference', 'Automation & Cron Status',
`시스템 crontab (2026-03-24 확인):
- hf-keepalive.sh 매6시간 — HF Space ping
- claude-keepalive.sh 매2시간 — OAuth 토큰 갱신
- morning-brief.sh 매일 07:50
- trading-report.sh 매일 21:00
- weekly-digest.sh 일요일 23:00
- learning-consolidate.mjs 일요일 03:00
- kill-orphans.sh 매6시간`);

  upsertKnowledge(db, 'project', 'SuperClaw Platform',
`~/superclaw/ — MCP automation platform
- OMO: codex exec / gemini -p 풀 코딩 에이전트
- Plugin: ~/.claude/plugins/cache/superclaw/superclaw/3.0.0/
- ULW v2 (2026-03-16): PO(Opus)+Teams(gemini+codex+sonnet)
- Memory: SSOT = knowledge 테이블, MEMORY.md는 자동 생성 캐시`);

  upsertKnowledge(db, 'project', 'Quant Trading System',
`~/quant/ — Python 3.12, 28 strategies
- Funding Rate Alpha: DOT 0.17%/day@3x (validated 3yr OOS)
- Liquidation Approach: +0.112%/day, Sharpe +0.59 (Bot C)
- Paper trading 중단 (2026-03-04~06), Bot cron 미등록
- HF Space: running, trade history 제한 수정됨 (push 필요)`);

  upsertKnowledge(db, 'project', 'Claude Tycoon',
`~/claude-tycoon/ — Gather Town-style agent visualization
- HTML ~2200 lines, server.mjs port 3456
- OMO live, team clustering, Activity Feed`);

  db.close();
  console.log('Migration complete.');
}

async function exportMemoryMd() {
  console.log('=== Exporting DB → .md files + MEMORY.md ===');
  const db = await getDb();

  // Fill missing descriptions via LLM
  await fillDescriptions(db);

  // Query all active knowledge entries
  const allCategories = ['user', 'feedback', 'project', 'reference', 'core-digest', 'weekly-digest'];
  const allRows = db.prepare(
    `SELECT id, category, subject, content, description, confidence, updated_at
     FROM knowledge
     WHERE (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')
     AND category IN (${allCategories.map(() => '?').join(',')})
     ORDER BY category, updated_at DESC`
  ).all(...allCategories);

  // Clean up old auto-generated .md files (keep MEMORY.md)
  const existing = readdirSync(MEMORY_DIR).filter(f => f !== 'MEMORY.md' && f.endsWith('.md'));
  for (const f of existing) {
    unlinkSync(join(MEMORY_DIR, f));
  }

  // Generate individual .md files and collect index entries
  const index = {};  // category → [{filename, description}]
  let fileCount = 0;

  for (const row of allRows) {
    const filename = toFilename(row.category, row.subject);
    const filepath = join(MEMORY_DIR, filename);
    const description = row.description || firstLine(row.content);

    // Write individual .md file with frontmatter
    const mdContent = `---
name: ${row.subject}
description: ${description}
type: ${row.category}
---

${row.content}
`;
    writeFileSync(filepath, mdContent);
    fileCount++;

    // Collect for index
    if (!index[row.category]) index[row.category] = [];
    index[row.category].push({ filename, subject: row.subject, description });
  }

  // Build MEMORY.md index
  let md = '# Memory Index (Auto-generated from DB)\n';
  md += '> SSOT: ~/superclaw/data/memory.db knowledge 테이블\n';
  md += '> 이 파일과 개별 .md는 DB에서 자동 생성됩니다. 직접 수정하지 마세요.\n\n';

  const sectionLabels = {
    'user': 'User',
    'feedback': 'Feedback Rules',
    'project': 'Active Projects',
    'reference': 'References',
    'core-digest': 'Core Knowledge',
    'weekly-digest': 'Weekly Digests',
  };

  for (const cat of allCategories) {
    const entries = index[cat];
    if (!entries || entries.length === 0) continue;

    md += `## ${sectionLabels[cat]}\n`;
    for (const e of entries) {
      md += `- [${e.filename}](${e.filename}) — ${e.description}\n`;
    }
    md += '\n';
  }

  writeFileSync(MEMORY_MD, md);

  const lines = md.split('\n').length;
  console.log(`Generated ${fileCount} .md files + MEMORY.md (${lines} lines)`);

  if (lines > 190) {
    console.warn(`  WARNING: ${lines} lines — approaching 200-line limit!`);
  }

  db.close();
}

/**
 * Export project-specific memory to each project's memory directory.
 * Includes: global (user/feedback/reference) + project-specific digests.
 */
async function exportProjectMemories() {
  console.log('=== Exporting project-specific memories ===');
  const db = await getDb();

  // Global entries (shared across all projects)
  const globalRows = db.prepare(
    `SELECT id, category, subject, content, description FROM knowledge
     WHERE category IN ('user', 'feedback', 'reference')
     AND (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')
     ORDER BY category, updated_at DESC`
  ).all();

  for (const [dirName, dbProjects] of Object.entries(PROJECT_MAP)) {
    const memDir = join(PROJECTS_BASE, `-Users-daehanlim-${dirName}`, 'memory');
    if (!existsSync(join(PROJECTS_BASE, `-Users-daehanlim-${dirName}`))) {
      continue; // Skip if project dir doesn't exist in Claude
    }
    mkdirSync(memDir, { recursive: true });

    // Clean old auto-generated files
    try {
      const old = readdirSync(memDir).filter(f => f !== 'MEMORY.md' && f.endsWith('.md'));
      for (const f of old) unlinkSync(join(memDir, f));
    } catch {}

    // Project-specific entries: weekly-digest/core-digest matching project names
    const projectRows = [];
    if (dbProjects.length > 0) {
      const likeConditions = dbProjects.map(() => "subject LIKE ?").join(' OR ');
      const likeParams = dbProjects.map(p => `%${p}%`);
      const rows = db.prepare(
        `SELECT id, category, subject, content, description FROM knowledge
         WHERE category IN ('weekly-digest', 'core-digest', 'project')
         AND (${likeConditions})
         AND (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')
         ORDER BY category, updated_at DESC`
      ).all(...likeParams);
      projectRows.push(...rows);
    }

    // Combine: global + project-specific
    const allRows = [...globalRows, ...projectRows];
    const index = {};
    let fileCount = 0;

    for (const row of allRows) {
      const filename = toFilename(row.category, row.subject);
      const filepath = join(memDir, filename);
      const description = row.description || firstLine(row.content);

      writeFileSync(filepath, `---
name: ${row.subject}
description: ${description}
type: ${row.category}
---

${row.content}
`);
      fileCount++;

      if (!index[row.category]) index[row.category] = [];
      index[row.category].push({ filename, subject: row.subject, description });
    }

    // Build project MEMORY.md
    let md = `# Memory Index: ${dirName} (Auto-generated from DB)\n`;
    md += '> SSOT: ~/superclaw/data/memory.db\n\n';

    const sectionLabels = {
      'user': 'User', 'feedback': 'Feedback Rules', 'reference': 'References',
      'project': 'Project', 'core-digest': 'Core Knowledge', 'weekly-digest': 'Weekly Digests',
    };

    for (const cat of ['user', 'feedback', 'reference', 'project', 'core-digest', 'weekly-digest']) {
      const entries = index[cat];
      if (!entries || entries.length === 0) continue;
      md += `## ${sectionLabels[cat]}\n`;
      for (const e of entries) {
        md += `- [${e.filename}](${e.filename}) — ${e.description}\n`;
      }
      md += '\n';
    }

    writeFileSync(join(memDir, 'MEMORY.md'), md);
    console.log(`  ${dirName}: ${fileCount} files, ${md.split('\n').length} lines`);
  }

  db.close();
}

async function main() {
  if (command === 'migrate' || command === 'both') await migrate();
  if (command === 'export' || command === 'both') {
    await exportMemoryMd();       // 홈 디렉토리 (전체)
    await exportProjectMemories(); // 프로젝트별 (global + 프로젝트 관련만)
  }
}

main().catch(async (e) => {
  console.error(e);
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), 'superclaw', 'superclaw.json'), 'utf-8'));
    const token = cfg?.telegram?.botToken;
    const chatId = cfg?.telegram?.defaultChatId;
    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `⚠️ memory-migrate-and-export 실패: ${e.message?.slice(0, 200)}` }),
      });
    }
  } catch {}
  process.exit(1);
});
