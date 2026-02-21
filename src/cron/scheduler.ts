import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';

export interface CronJob {
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
}

export class CronScheduler {
  private jobs: CronJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly filePath: string;

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, 'cron-jobs.json');
    this.load();
  }

  // --- Public API ---

  addJob(name: string, schedule: string, command: string): CronJob {
    if (this.jobs.some((j) => j.name === name)) {
      throw new Error(`Cron job "${name}" already exists`);
    }
    // Validate the schedule before saving
    this.validateSchedule(schedule);

    const job: CronJob = {
      name,
      schedule,
      command,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    job.nextRun = this.computeNextRun(job.schedule);
    this.jobs.push(job);
    this.save();
    return job;
  }

  removeJob(name: string): boolean {
    const idx = this.jobs.findIndex((j) => j.name === name);
    if (idx === -1) return false;
    this.jobs.splice(idx, 1);
    this.save();
    return true;
  }

  listJobs(): CronJob[] {
    return [...this.jobs];
  }

  getJob(name: string): CronJob | null {
    return this.jobs.find((j) => j.name === name) ?? null;
  }

  enableJob(name: string): boolean {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return false;
    job.enabled = true;
    job.nextRun = this.computeNextRun(job.schedule);
    this.save();
    return true;
  }

  disableJob(name: string): boolean {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return false;
    job.enabled = false;
    job.nextRun = undefined;
    this.save();
    return true;
  }

  start(): void {
    if (this.timer) return;
    console.error('[cron] Scheduler started — checking every 60s');
    this.timer = setInterval(() => {
      this.tick();
    }, 60_000);
    // Also do an immediate tick so we don't wait the first 60s
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.error('[cron] Scheduler stopped');
    }
  }

  // --- Cron matching ---

  private matchesCron(schedule: string, now: Date): boolean {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) {
      return false;
    }

    const minute = now.getMinutes();
    const hour = now.getHours();
    const dayOfMonth = now.getDate();
    const month = now.getMonth() + 1; // JS months are 0-based
    const dayOfWeek = now.getDay(); // 0=Sunday

    const [minField, hourField, domField, monthField, dowField] = parts;

    return (
      this.fieldMatches(minField, minute, 0, 59) &&
      this.fieldMatches(hourField, hour, 0, 23) &&
      this.fieldMatches(domField, dayOfMonth, 1, 31) &&
      this.fieldMatches(monthField, month, 1, 12) &&
      this.fieldMatches(dowField, dayOfWeek, 0, 6)
    );
  }

  private fieldMatches(field: string, value: number, min: number, max: number): boolean {
    const allowed = this.parseCronField(field, min, max);
    return allowed.includes(value);
  }

  private parseCronField(field: string, min: number, max: number): number[] {
    const results = new Set<number>();

    for (const part of field.split(',')) {
      const trimmed = part.trim();

      // Step: */N or N-M/S
      if (trimmed.includes('/')) {
        const [rangeStr, stepStr] = trimmed.split('/');
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step <= 0) {
          throw new Error(`Invalid step value in cron field: "${field}"`);
        }

        let start = min;
        let end = max;

        if (rangeStr !== '*') {
          if (rangeStr.includes('-')) {
            const [lo, hi] = rangeStr.split('-').map(Number);
            start = lo;
            end = hi;
          } else {
            start = parseInt(rangeStr, 10);
          }
        }

        for (let i = start; i <= end; i += step) {
          results.add(i);
        }
        continue;
      }

      // Wildcard
      if (trimmed === '*') {
        for (let i = min; i <= max; i++) {
          results.add(i);
        }
        continue;
      }

      // Range: N-M
      if (trimmed.includes('-')) {
        const [lo, hi] = trimmed.split('-').map(Number);
        if (isNaN(lo) || isNaN(hi)) {
          throw new Error(`Invalid range in cron field: "${field}"`);
        }
        for (let i = lo; i <= hi; i++) {
          results.add(i);
        }
        continue;
      }

      // Exact number
      const num = parseInt(trimmed, 10);
      if (isNaN(num)) {
        throw new Error(`Invalid value in cron field: "${field}"`);
      }
      results.add(num);
    }

    return Array.from(results);
  }

  // --- Validation ---

  private validateSchedule(schedule: string): void {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(
        `Invalid cron expression: expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`
      );
    }
    const ranges: [number, number][] = [
      [0, 59],   // minute
      [0, 23],   // hour
      [1, 31],   // day of month
      [1, 12],   // month
      [0, 6],    // day of week
    ];
    const fieldNames = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'];
    for (let i = 0; i < 5; i++) {
      try {
        this.parseCronField(parts[i], ranges[i][0], ranges[i][1]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'parse error';
        throw new Error(`Invalid cron ${fieldNames[i]} field "${parts[i]}": ${msg}`);
      }
    }
  }

  // --- Tick / execution ---

  private tick(): void {
    const now = new Date();
    for (const job of this.jobs) {
      if (!job.enabled) continue;
      try {
        if (this.matchesCron(job.schedule, now)) {
          this.executeJob(job);
        }
      } catch (err) {
        console.error(`[cron] Error checking job "${job.name}":`, err);
      }
    }
  }

  private executeJob(job: CronJob): void {
    job.lastRun = new Date().toISOString();
    job.nextRun = this.computeNextRun(job.schedule);
    this.save();

    if (job.command.startsWith('pipeline:')) {
      const pipelineName = job.command.slice('pipeline:'.length).trim();
      console.error(`[cron] Would run pipeline "${pipelineName}" (integration pending)`);
      return;
    }

    console.error(`[cron] Executing job "${job.name}": ${job.command}`);
    exec(job.command, { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[cron] Job "${job.name}" failed:`, err.message);
        if (stderr) console.error(`[cron] stderr: ${stderr}`);
      } else {
        console.error(`[cron] Job "${job.name}" completed`);
        if (stdout) console.error(`[cron] stdout: ${stdout.slice(0, 500)}`);
      }
    });
  }

  // --- Persistence ---

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.jobs = [];
      return;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      this.jobs = JSON.parse(raw) as CronJob[];
    } catch (err) {
      console.error('[cron] Failed to load cron-jobs.json, starting fresh:', err);
      this.jobs = [];
    }
  }

  private save(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.jobs, null, 2), 'utf-8');
  }

  // --- Helpers ---

  private computeNextRun(schedule: string): string | undefined {
    try {
      const now = new Date();
      // Start checking from the next minute
      const check = new Date(now);
      check.setSeconds(0, 0);
      check.setMinutes(check.getMinutes() + 1);

      // Look ahead up to 48 hours
      const limit = 48 * 60;
      for (let i = 0; i < limit; i++) {
        if (this.matchesCron(schedule, check)) {
          return check.toISOString();
        }
        check.setMinutes(check.getMinutes() + 1);
      }
    } catch {
      // If schedule is invalid, return undefined
    }
    return undefined;
  }
}
