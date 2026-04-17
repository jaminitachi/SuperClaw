#!/usr/bin/env node
/**
 * Learning Consolidation — compresses raw learnings into project-based digests.
 *
 * Two-layer architecture:
 *   Layer 1: weekly-digest — per-project weekly compression of raw learnings
 *   Layer 2: core-digest — per-project evergreen compression of all weekly-digests
 *
 * Runs weekly via cron. Uses lock file to prevent duplicate execution.
 * Uses UPSERT to prevent duplicate digests for the same subject.
 *
 * Usage:
 *   node scripts/learning-consolidate.mjs           # Full consolidation
 *   node scripts/learning-consolidate.mjs --dry-run  # Preview without writing
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { cleanEnvironment } from './lib/session-end-utils.mjs';
import { rotateIfNeeded } from './lib/log-rotate.mjs';
import { findClaudeBin } from './lib/claude-bin.mjs';

const HOME = homedir();
const DB_PATH = join(HOME, 'superclaw', 'data', 'memory.db');
const LOG_PATH = join(HOME, 'superclaw', 'data', 'logs', 'consolidation.log');
const LOCK_PATH = '/tmp/sc-consolidation.lock';
const DRY_RUN = process.argv.includes('--dry-run');
const CLAUDE_BIN = findClaudeBin();

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(join(HOME, 'superclaw', 'data', 'logs'), { recursive: true });
    appendFileSync(LOG_PATH, line + '\n');
  } catch {}
}

/**
 * Acquire lock file. Returns true if lock acquired, false if already locked.
 */
function acquireLock() {
  if (existsSync(LOCK_PATH)) {
    // Check if lock is stale (> 30 minutes old)
    try {
      const stat = readFileSync(LOCK_PATH, 'utf-8');
      const lockTime = new Date(stat.trim()).getTime();
      if (Date.now() - lockTime < 30 * 60 * 1000) {
        return false; // Fresh lock, another instance is running
      }
      log('Stale lock detected (>30min), overriding...');
    } catch {}
  }
  writeFileSync(LOCK_PATH, new Date().toISOString());
  return true;
}

function releaseLock() {
  try { unlinkSync(LOCK_PATH); } catch {}
}

/**
 * Call Sonnet 4.6 for consolidation via claude CLI spawn.
 * Uses Claude Code's OAuth auth — no API key required.
 */
async function callSonnet(prompt) {
  const t0 = Date.now();
  try {
    const { spawn: spawnChild } = await import('child_process');
    const { code, stdout, stderr } = await new Promise((resolve) => {
      const cleanEnv = cleanEnvironment(process.env);

      let stderr = '';
      const child = spawnChild(CLAUDE_BIN, [
        '-p', prompt,
        '--model', 'haiku',
        '--output-format', 'json',
        '--max-turns', '1',
        '--tools', '',
        '--settings', '{"hooks":{}}',
      ], {
        env: cleanEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('close', (c) => {
        clearTimeout(timer);
        resolve({ code: c, stdout: stdout.trim(), stderr });
      });
      child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout: '', stderr: err.message }); });
      const timer = setTimeout(() => { child.kill('SIGTERM'); resolve({ code: -1, stdout: '', stderr: 'TIMEOUT' }); }, 240000);
    });

    if (code !== 0) {
      log(`  CLI exit=${code} stdout(500)=${stdout.slice(0, 500)} stderr(500)=${stderr.slice(0, 500)}`);
      return null;
    }
    if (!stdout) {
      log(`  CLI empty stdout`);
      return null;
    }

    try {
      const parsed = JSON.parse(stdout);
      const text = parsed?.result || '';
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) {
        log(`  no JSON array in result. text (300): ${text.slice(0, 300)}`);
        return null;
      }
      const arr = JSON.parse(match[0]);
      if (!Array.isArray(arr) || arr.length === 0) {
        log(`  parsed array empty/non-array`);
        return null;
      }
      return arr;
    } catch (e) {
      log(`  parse error: ${e.message}. stdout (300): ${stdout.slice(0, 300)}`);
      return null;
    }
  } catch (e) {
    log(`  CLI error: ${e.message}`);
  }

  return null;
}

async function main() {
  log('=== Learning Consolidation Start ===');
  rotateIfNeeded(LOG_PATH);

  // Task 7: Lock file to prevent duplicate execution
  if (!acquireLock()) {
    log('Another consolidation is running (lock exists). Exiting.');
    process.exit(0);
  }

  try {
    if (!existsSync(DB_PATH)) {
      log('ERROR: memory.db not found');
      process.exit(1);
    }

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(DB_PATH);

    // Migrate: ensure knowledge table has tags column
    const knowledgeCols = db.prepare('PRAGMA table_info(knowledge)').all().map(c => c.name);
    if (!knowledgeCols.includes('tags')) {
      db.exec("ALTER TABLE knowledge ADD COLUMN tags TEXT DEFAULT ''");
      log('Migrated knowledge table: added tags column');
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    let totalArchivedLearnings = 0;
    let totalArchivedDigests = 0;

    // ============================================================
    // STEP 1: Existing weekly-digests → core-digest
    // (저번주 weekly-digest를 core-digest로 압축 & 아카이브)
    // ============================================================
    log('--- Step 1: Weekly Digests → Core Digest ---');

    const digestProjects = db.prepare(
      `SELECT DISTINCT
         CASE
           WHEN subject LIKE 'Weekly Digest: % (%'
           THEN SUBSTR(subject, 16, INSTR(SUBSTR(subject, 16), ' (') - 1)
           ELSE 'general'
         END as proj
       FROM knowledge
       WHERE category = 'weekly-digest'
         AND (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')`
    ).all().map(r => r.proj);

    const failedProjects = [];
    for (const proj of digestProjects) {
      const coreSubject = `Core Digest: ${proj}`;
      const existingCore = db.prepare(
        "SELECT id, content FROM knowledge WHERE category = 'core-digest' AND subject = ?"
      ).get(coreSubject);

      const weeklyDigests = db.prepare(
        `SELECT id, subject, content FROM knowledge
         WHERE category = 'weekly-digest'
           AND subject LIKE ?
           AND (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')
         ORDER BY updated_at DESC`
      ).all(`Weekly Digest: ${proj} (%`);

      if (weeklyDigests.length === 0) continue;

      log(`  Building core-digest for "${proj}" from ${weeklyDigests.length} weekly-digest(s)...`);

      if (DRY_RUN) {
        log(`  [DRY RUN] Would compress ${weeklyDigests.length} weekly-digests into core-digest`);
        continue;
      }

      const existingCoreContent = existingCore ? existingCore.content : '';
      const weeklyContent = weeklyDigests.map(d => `[${d.subject}]\n${d.content}`).join('\n\n');

      const corePrompt = `<task>
You are consolidating knowledge for project "${proj}".

${existingCoreContent ? `EXISTING CORE DIGEST (update/merge with new info):\n${existingCoreContent}\n\n` : ''}NEW WEEKLY DIGESTS TO INCORPORATE:
${weeklyContent}

Produce a single comprehensive core digest with the top 15 most critical insights.
Rules:
- Merge overlapping insights
- Keep the most actionable and frequently recurring patterns
- 1-2 sentences per insight
- Output ONLY a JSON array. No other text.

Format: ["insight1", "insight2", ...]
</task>`;

      const coreInsights = await callSonnet(corePrompt);

      if (!coreInsights || !Array.isArray(coreInsights) || coreInsights.length === 0) {
        log(`  Failed to generate core-digest for "${proj}". Skipping.`);
        failedProjects.push(proj);
        continue;
      }

      const coreContent = coreInsights.map((ins, i) => `${i + 1}. ${ins}`).join('\n');

      if (existingCore) {
        db.prepare(
          "UPDATE knowledge SET content = ?, confidence = 0.95, updated_at = datetime('now') WHERE id = ?"
        ).run(coreContent, existingCore.id);
        log(`  Updated core-digest: "${coreSubject}" (${coreInsights.length} insights)`);
      } else {
        db.prepare(
          'INSERT INTO knowledge (category, subject, content, confidence) VALUES (?, ?, ?, ?)'
        ).run('core-digest', coreSubject, coreContent, 0.95);
        log(`  Created core-digest: "${coreSubject}" (${coreInsights.length} insights)`);
      }

      // Archive ALL consumed weekly-digests (they're now in core-digest)
      for (const wd of weeklyDigests) {
        db.prepare(
          `UPDATE knowledge SET tags = CASE
            WHEN tags = '' OR tags IS NULL THEN 'archived'
            WHEN tags NOT LIKE '%archived%' THEN tags || ',archived'
            ELSE tags
          END
          WHERE id = ?`
        ).run(wd.id);
      }
      totalArchivedDigests += weeklyDigests.length;
      log(`  Archived ${weeklyDigests.length} weekly-digest(s)`);
    }

    if (failedProjects.length > 0) {
      await sendTelegramAlert(`⚠️ Consolidation: ${failedProjects.length}개 프로젝트 core-digest 생성 실패: ${failedProjects.join(', ')}`);
    }

    if (digestProjects.length === 0) {
      log('  No unarchived weekly-digests found. Skipping.');
    }

    // ============================================================
    // STEP 2: Learnings → new weekly-digest
    // (이번주 learnings를 새 weekly-digest로 압축)
    // ============================================================
    log('\n--- Step 2: Learnings → Weekly Digest ---');

    const projects = db.prepare(
      `SELECT DISTINCT COALESCE(NULLIF(project, ''), 'general') as proj
       FROM learnings
       WHERE tags NOT LIKE '%archived%' OR tags IS NULL OR tags = ''
       ORDER BY proj`
    ).all().map(r => r.proj);

    log(`Projects with unarchived learnings: ${projects.join(', ') || 'none'}`);

    const failedConsolidations = [];
    for (const proj of projects) {
      const entries = db.prepare(
        `SELECT id, content, category, created_at FROM learnings
         WHERE (COALESCE(NULLIF(project, ''), 'general') = ?)
         AND (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')
         ORDER BY created_at DESC`
      ).all(proj);

      if (entries.length < 5) {
        log(`  Skipping ${proj} (only ${entries.length} unarchived entries, need 5+)`);
        continue;
      }

      log(`  Consolidating "${proj}" (${entries.length} learnings)...`);

      const sample = entries.slice(0, 200).map(e =>
        `- [${e.category}] ${e.content.slice(0, 200)}${e.content.length > 200 ? '...' : ''}`
      ).join('\n');

      const prompt = `<task>
Below are ${entries.length} learning entries for project "${proj}".
Analyze and compress into the top 10 most important, recurring patterns/insights.

Rules:
- 1-2 sentences per insight
- Specific and actionable (e.g., "When doing X, always do Y")
- Drop duplicates and trivial items
- Group by theme if possible
- Output ONLY a JSON array. No other text.

Format: ["insight1", "insight2", ...]
</task>

<entries>
${sample}
</entries>`;

      if (DRY_RUN) {
        log(`  [DRY RUN] Would consolidate ${entries.length} entries for "${proj}"`);
        continue;
      }

      const insights = await callSonnet(prompt);

      if (!insights || !Array.isArray(insights) || insights.length === 0) {
        log(`  Failed to consolidate "${proj}". Skipping.`);
        failedConsolidations.push(proj);
        continue;
      }

      log(`  Compressed ${entries.length} → ${insights.length} insights`);

      const digestContent = insights.map((ins, i) => `${i + 1}. ${ins}`).join('\n');
      const subject = `Weekly Digest: ${proj} (${dateStr})`;

      const existing = db.prepare(
        "SELECT id FROM knowledge WHERE category = 'weekly-digest' AND subject = ?"
      ).get(subject);

      if (existing) {
        db.prepare(
          "UPDATE knowledge SET content = ?, confidence = 0.9, updated_at = datetime('now') WHERE id = ?"
        ).run(digestContent, existing.id);
        log(`  Updated existing digest: "${subject}"`);
      } else {
        db.prepare(
          'INSERT INTO knowledge (category, subject, content, confidence) VALUES (?, ?, ?, ?)'
        ).run('weekly-digest', subject, digestContent, 0.9);
        log(`  Created new digest: "${subject}"`);
      }

      // Archive processed learnings
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

      totalArchivedLearnings += ids.length;
      log(`  Archived ${ids.length} raw learnings`);
    }

    if (failedConsolidations.length > 0) {
      await sendTelegramAlert(`⚠️ Weekly digest: ${failedConsolidations.length}개 프로젝트 통합 실패: ${failedConsolidations.join(', ')}`);
    }

    // Summary
    const remaining = db.prepare(
      "SELECT COUNT(*) as cnt FROM learnings WHERE tags NOT LIKE '%archived%' OR tags IS NULL OR tags = ''"
    ).get();
    const archived = db.prepare(
      "SELECT COUNT(*) as cnt FROM learnings WHERE tags LIKE '%archived%'"
    ).get();
    const digests = db.prepare(
      "SELECT COUNT(*) as cnt FROM knowledge WHERE category = 'weekly-digest' AND (tags NOT LIKE '%archived%' OR tags IS NULL OR tags = '')"
    ).get();
    const coreDigests = db.prepare(
      "SELECT COUNT(*) as cnt FROM knowledge WHERE category = 'core-digest'"
    ).get();

    log('\n=== Consolidation Complete ===');
    log(`Active learnings: ${remaining.cnt}`);
    log(`Archived learnings: ${archived.cnt}`);
    log(`Active weekly-digests: ${digests.cnt}`);
    log(`Core digests: ${coreDigests.cnt}`);
    log(`Newly archived: ${totalArchivedLearnings} learnings, ${totalArchivedDigests} weekly-digests`);

    db.close();

    // Export DB → MEMORY.md (keep cache in sync)
    log('\n--- Step 3: Export DB → MEMORY.md ---');
    try {
      const { execSync } = await import('child_process');
      execSync(`"${CLAUDE_BIN}" -p "Run: ${process.execPath} ${join(HOME, 'superclaw', 'scripts', 'memory-migrate-and-export.mjs')} export" --max-turns 3 --model haiku --permission-mode bypassPermissions`, {
        timeout: 90000, stdio: 'pipe',
        env: cleanEnvironment(process.env)
      });
      log('  MEMORY.md export completed');
    } catch (e) {
      // Fallback: run directly
      try {
        const { execSync: exec2 } = await import('child_process');
        exec2(`${process.execPath} ${join(HOME, 'superclaw', 'scripts', 'memory-migrate-and-export.mjs')} export`, {
          timeout: 60000, stdio: 'pipe', env: cleanEnvironment(process.env)
        });
        log('  MEMORY.md export completed (direct)');
      } catch (e2) {
        log(`  MEMORY.md export failed: ${e2.message}`);
      }
    }
  } finally {
    // Task 7: Always release lock, even on error
    releaseLock();
  }
}

async function sendTelegramAlert(msg) {
  try {
    const cfg = JSON.parse(readFileSync(join(HOME, 'superclaw', 'superclaw.json'), 'utf-8'));
    const token = cfg?.telegram?.botToken;
    const chatId = cfg?.telegram?.defaultChatId;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg }),
    });
  } catch { /* best effort */ }
}

main().catch(async (e) => {
  releaseLock();
  log(`FATAL: ${e.message}`);
  await sendTelegramAlert(`⚠️ Learning consolidation 실패: ${e.message}`);
  process.exit(1);
});
