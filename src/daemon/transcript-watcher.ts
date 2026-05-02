/**
 * Transcript watcher — runs inside sc-daemon alongside the Telegram poll loop.
 *
 * Polls Claude Code transcripts under ~/.claude/projects/ on an interval,
 * detects idle ".jsonl" files (no mtime update for N minutes), and runs
 * extraction via `claude -p --model haiku` out-of-band from Claude Code's
 * lifecycle. State is tracked in memory.db so extractions are idempotent
 * across daemon restarts and only re-run when a transcript is modified
 * (session resumed). Failed extractions back off exponentially.
 */
import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import Database from 'better-sqlite3';
import {
  readTranscript,
  extractProjectFromTranscriptPath,
  extractLearningsViaClaude,
  saveToMemoryDb,
  syncToScNotepad,
  MIN_TRANSCRIPT_LENGTH,
  type Learnings,
} from '../lib/extraction.js';

const HOME = homedir();
const PROJECTS_DIR = join(HOME, '.claude', 'projects');
const DB_PATH = join(HOME, 'superclaw', 'data', 'memory.db');
const FAILED_RETRY_BACKOFF_MS = 60 * 60 * 1000; // 1h base, doubled per retry

// ─── Types ───────────────────────────────────────────────────────

type DbInstance = ReturnType<typeof Database>;

export interface WatcherOptions {
  enabled: boolean;
  idleMinutes: number;
  pollIntervalSeconds: number;
  maxRetries: number;
  batchSize: number;
  extractionTimeoutMs: number;
}

type Status = 'pending' | 'extracting' | 'done' | 'failed' | 'skipped';

interface ExtractionRow {
  path: string;
  mtime: number;
  extracted_at: string | null;
  status: Status;
  session_id: string | null;
  learnings_count: number | null;
  retry_count: number;
  last_error: string | null;
}

// ─── Logger ──────────────────────────────────────────────────────

type LogLevel = 'INFO' | 'WARN' | 'ERROR';
type LogFn = (level: LogLevel, msg: string) => void;

// ─── Watcher class ───────────────────────────────────────────────

export class TranscriptWatcher {
  private options: WatcherOptions;
  private log: LogFn;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private processing = false;

  constructor(options: WatcherOptions, log: LogFn) {
    this.options = options;
    this.log = log;
  }

  start(): void {
    if (!this.options.enabled) {
      this.log('INFO', '[watcher] disabled via config');
      return;
    }
    if (this.running) return;

    this.running = true;
    this.ensureTable();
    this.log(
      'INFO',
      `[watcher] started (idle=${this.options.idleMinutes}min, poll=${this.options.pollIntervalSeconds}s, batch=${this.options.batchSize})`
    );

    // Run first tick after a short delay so daemon startup has a chance to settle
    this.timer = setTimeout(() => this.tick(), 10_000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(
      () => this.tick(),
      this.options.pollIntervalSeconds * 1000
    );
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    if (this.processing) {
      this.scheduleNext();
      return;
    }

    this.processing = true;
    try {
      const candidates = this.findCandidates();
      if (candidates.length > 0) {
        this.log('INFO', `[watcher] ${candidates.length} candidate(s) for extraction`);
        const batch = candidates.slice(0, this.options.batchSize);
        for (const candidate of batch) {
          if (!this.running) break;
          await this.processFile(candidate);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('ERROR', `[watcher] tick error: ${msg}`);
    } finally {
      this.processing = false;
      this.scheduleNext();
    }
  }

  // ─── Candidate discovery ─────────────────────────────────────

  private findCandidates(): Array<{ path: string; mtime: number }> {
    if (!existsSync(PROJECTS_DIR)) return [];

    const idleThresholdMs = this.options.idleMinutes * 60 * 1000;
    const now = Date.now();
    const seen: Array<{ path: string; mtime: number }> = [];

    let projectDirs: string[];
    try {
      projectDirs = readdirSync(PROJECTS_DIR);
    } catch {
      return [];
    }

    for (const projDir of projectDirs) {
      const absProjDir = join(PROJECTS_DIR, projDir);
      let stat;
      try {
        stat = statSync(absProjDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      let files: string[];
      try {
        files = readdirSync(absProjDir);
      } catch {
        continue;
      }

      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const absPath = join(absProjDir, f);
        let fileStat;
        try {
          fileStat = statSync(absPath);
        } catch {
          continue;
        }
        if (!fileStat.isFile()) continue;

        const mtimeMs = fileStat.mtimeMs;
        if (now - mtimeMs < idleThresholdMs) {
          // session still active, skip
          continue;
        }
        seen.push({ path: absPath, mtime: Math.floor(mtimeMs) });
      }
    }

    // Filter out already-processed files by consulting the state table
    return this.filterByState(seen);
  }

  private filterByState(
    candidates: Array<{ path: string; mtime: number }>
  ): Array<{ path: string; mtime: number }> {
    if (candidates.length === 0) return [];
    const db = this.openDb();
    if (!db) return [];

    try {
      const stmt = db.prepare(
        'SELECT path, mtime, status, retry_count, last_attempt_at FROM transcript_extractions WHERE path = ?'
      );
      const result: Array<{ path: string; mtime: number }> = [];
      const now = Date.now();

      for (const c of candidates) {
        const row = stmt.get(c.path) as
          | {
              path: string;
              mtime: number;
              status: Status;
              retry_count: number;
              last_attempt_at: string | null;
            }
          | undefined;
        if (!row) {
          // Never seen
          result.push(c);
          continue;
        }
        if (row.status === 'done' && row.mtime === c.mtime) {
          continue; // already done, unchanged
        }
        if (row.status === 'done' && row.mtime !== c.mtime) {
          result.push(c); // resumed — mtime changed, re-extract
          continue;
        }
        if (row.status === 'failed' && row.retry_count < this.options.maxRetries) {
          // Exponential backoff: 1h × 2^retry_count
          const backoffMs = FAILED_RETRY_BACKOFF_MS * Math.pow(2, row.retry_count);
          const lastAttemptMs = row.last_attempt_at
            ? Date.parse(row.last_attempt_at)
            : 0;
          if (now - lastAttemptMs >= backoffMs) {
            result.push(c);
          }
          continue;
        }
        // pending = orphaned legacy state. Drop the row so the file is
        // treated as never-seen on next poll (no infinite re-poll loop).
        if (row.status === 'pending') {
          db.prepare('DELETE FROM transcript_extractions WHERE path = ?').run(
            c.path
          );
          result.push(c);
          continue;
        }
        if (row.status === 'extracting') {
          // Still in flight from another tick — don't double-process
          continue;
        }
        // failed + exceeded retries, or skipped: drop
      }
      return result;
    } finally {
      db.close();
    }
  }

  // ─── Single file extraction ──────────────────────────────────

  private async processFile(candidate: { path: string; mtime: number }): Promise<void> {
    const { path, mtime } = candidate;
    this.upsertStatus(path, mtime, 'extracting');
    this.log('INFO', `[watcher] extracting ${path}`);

    const parsed = readTranscript(path);
    const textLen = parsed.transcriptText.length;

    if (textLen < MIN_TRANSCRIPT_LENGTH) {
      this.log(
        'INFO',
        `[watcher] skipped (too short: ${textLen} chars): ${path}`
      );
      this.markDone(path, mtime, 0);
      return;
    }

    const project = extractProjectFromTranscriptPath(path);
    this.log(
      'INFO',
      `[watcher] project="${project}" text=${textLen} chars, invoking claude haiku (timeout=${Math.round(
        this.options.extractionTimeoutMs / 1000
      )}s)`
    );

    const t0 = Date.now();
    let learnings: Learnings | null;
    try {
      learnings = await extractLearningsViaClaude(parsed.transcriptText, {
        timeoutMs: this.options.extractionTimeoutMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.markFailed(path, mtime, `extraction exception: ${msg}`);
      return;
    }
    const elapsed = Date.now() - t0;

    if (!learnings) {
      this.log(
        'ERROR',
        `[watcher] extraction returned null (${elapsed}ms): ${path}`
      );
      this.markFailed(path, mtime, `extraction returned null after ${elapsed}ms`);
      return;
    }

    let count = 0;
    try {
      count = await saveToMemoryDb(learnings, project, DB_PATH);
      syncToScNotepad(learnings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('ERROR', `[watcher] save failed: ${msg}`);
      this.markFailed(path, mtime, `save error: ${msg}`);
      return;
    }

    this.log(
      'INFO',
      `[watcher] done (${elapsed}ms, saved=${count}): ${learnings.summary?.slice(0, 80) ?? '<no summary>'}`
    );
    this.markDone(path, mtime, count);
  }

  // ─── State table ─────────────────────────────────────────────

  private ensureTable(): void {
    const db = this.openDb();
    if (!db) return;
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS transcript_extractions (
          path TEXT PRIMARY KEY,
          mtime INTEGER NOT NULL,
          extracted_at TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          session_id TEXT,
          learnings_count INTEGER DEFAULT 0,
          retry_count INTEGER DEFAULT 0,
          last_error TEXT,
          last_attempt_at TEXT
        )
      `);
      // Migration: add last_attempt_at column if it doesn't exist (existing dbs)
      try {
        db.exec('ALTER TABLE transcript_extractions ADD COLUMN last_attempt_at TEXT');
      } catch {
        // column already exists
      }
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_transcript_extractions_status ON transcript_extractions(status)`
      );
    } finally {
      db.close();
    }
  }

  private upsertStatus(path: string, mtime: number, status: Status): void {
    const db = this.openDb();
    if (!db) return;
    try {
      db.prepare(
        `INSERT INTO transcript_extractions (path, mtime, status)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, status = excluded.status`
      ).run(path, mtime, status);
    } finally {
      db.close();
    }
  }

  private markDone(path: string, mtime: number, count: number): void {
    const db = this.openDb();
    if (!db) return;
    try {
      db.prepare(
        `UPDATE transcript_extractions
         SET status = 'done', mtime = ?, extracted_at = datetime('now'),
             last_attempt_at = datetime('now'), learnings_count = ?, last_error = NULL
         WHERE path = ?`
      ).run(mtime, count, path);
    } finally {
      db.close();
    }
  }

  private markFailed(path: string, mtime: number, errMsg: string): void {
    const db = this.openDb();
    if (!db) return;
    try {
      db.prepare(
        `UPDATE transcript_extractions
         SET status = 'failed', mtime = ?, retry_count = retry_count + 1,
             last_attempt_at = datetime('now'), last_error = ?
         WHERE path = ?`
      ).run(mtime, errMsg.slice(0, 500), path);
    } finally {
      db.close();
    }
  }

  private openDb(): DbInstance | null {
    if (!existsSync(DB_PATH)) {
      this.log('WARN', `[watcher] memory.db not found at ${DB_PATH}`);
      return null;
    }
    try {
      return new Database(DB_PATH);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('ERROR', `[watcher] db open failed: ${msg}`);
      return null;
    }
  }
}
