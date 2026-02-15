import type Database from 'better-sqlite3';

export interface SkillMetrics {
  skillName: string;
  invocationCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  lastUsed: string | null;
  feedbackScore: number | null;
}

export class SkillEvaluator {
  constructor(private db: Database.Database) {}

  recordInvocation(skillName: string, success: boolean, durationMs: number): void {
    const existing = this.db.prepare(
      'SELECT * FROM skill_metrics WHERE skill_name = ?'
    ).get(skillName) as any;

    if (existing) {
      const newAvg = (existing.avg_duration_ms * existing.invocation_count + durationMs) /
        (existing.invocation_count + 1);

      this.db.prepare(`
        UPDATE skill_metrics SET
          invocation_count = invocation_count + 1,
          success_count = success_count + ?,
          failure_count = failure_count + ?,
          avg_duration_ms = ?,
          last_used = datetime('now'),
          updated_at = datetime('now')
        WHERE skill_name = ?
      `).run(success ? 1 : 0, success ? 0 : 1, newAvg, skillName);
    } else {
      this.db.prepare(`
        INSERT INTO skill_metrics (skill_name, invocation_count, success_count, failure_count, avg_duration_ms, last_used)
        VALUES (?, 1, ?, ?, ?, datetime('now'))
      `).run(skillName, success ? 1 : 0, success ? 0 : 1, durationMs);
    }
  }

  getMetrics(skillName: string): SkillMetrics | null {
    const row = this.db.prepare('SELECT * FROM skill_metrics WHERE skill_name = ?').get(skillName) as any;
    if (!row) return null;
    return {
      skillName: row.skill_name,
      invocationCount: row.invocation_count,
      successCount: row.success_count,
      failureCount: row.failure_count,
      successRate: row.invocation_count > 0 ? row.success_count / row.invocation_count : 0,
      avgDurationMs: row.avg_duration_ms,
      lastUsed: row.last_used,
      feedbackScore: row.feedback_score,
    };
  }

  getAllMetrics(): SkillMetrics[] {
    const rows = this.db.prepare('SELECT * FROM skill_metrics ORDER BY invocation_count DESC').all() as any[];
    return rows.map((row) => ({
      skillName: row.skill_name,
      invocationCount: row.invocation_count,
      successCount: row.success_count,
      failureCount: row.failure_count,
      successRate: row.invocation_count > 0 ? row.success_count / row.invocation_count : 0,
      avgDurationMs: row.avg_duration_ms,
      lastUsed: row.last_used,
      feedbackScore: row.feedback_score,
    }));
  }

  getUnderperformingSkills(minInvocations = 5, maxSuccessRate = 0.5): SkillMetrics[] {
    return this.getAllMetrics().filter(
      (m) => m.invocationCount >= minInvocations && m.successRate <= maxSuccessRate
    );
  }

  setFeedbackScore(skillName: string, score: number): void {
    this.db.prepare(
      'UPDATE skill_metrics SET feedback_score = ?, updated_at = datetime("now") WHERE skill_name = ?'
    ).run(score, skillName);
  }
}
