import * as systemCollector from './collectors/system.js';
import * as devCollector from './collectors/dev.js';
import * as githubCollector from './collectors/github.js';
import * as sentryCollector from './collectors/sentry.js';
import * as calendarCollector from './collectors/calendar.js';
import * as processCollector from './collectors/process.js';
import * as customCollector from './collectors/custom.js';
import { evaluateAlerts, type Alert } from './alerting.js';
import { formatReport, type HeartbeatReport } from './reporter.js';

export interface SchedulerConfig {
  collectors: string[];
  intervalSeconds: number;
  projectDir?: string;
  githubRepo?: string;
  customCollectors?: customCollector.CustomCollectorConfig[];
}

export async function runHeartbeat(config: SchedulerConfig): Promise<HeartbeatReport> {
  const report: HeartbeatReport = {
    timestamp: new Date().toISOString(),
    alerts: [],
    summary: '',
  };

  const collectors = config.collectors;

  // Run enabled collectors in parallel
  const tasks: Promise<void>[] = [];

  if (collectors.includes('system')) {
    tasks.push(
      systemCollector.collect().then((m) => { report.system = m; })
    );
  }

  if (collectors.includes('dev')) {
    tasks.push(
      devCollector.collect(config.projectDir).then((m) => { report.dev = m; })
    );
  }

  if (collectors.includes('github')) {
    tasks.push(
      githubCollector.collect(config.githubRepo).then((m) => { report.github = m; })
    );
  }

  if (collectors.includes('sentry')) {
    tasks.push(
      sentryCollector.collect().then((m) => {
        // stored for future use
      })
    );
  }

  if (collectors.includes('calendar')) {
    tasks.push(
      calendarCollector.collect().then((m) => { report.calendar = m; })
    );
  }

  if (collectors.includes('process')) {
    tasks.push(
      processCollector.collect().then((m) => { report.process = m; })
    );
  }

  if (collectors.includes('custom') && config.customCollectors) {
    tasks.push(
      customCollector.collect(config.customCollectors).then(() => {
        // stored for future use
      })
    );
  }

  await Promise.allSettled(tasks);

  // Evaluate alerts
  const metricsFlat: Record<string, unknown> = {};
  if (report.system) {
    metricsFlat['cpu'] = report.system.cpu;
    metricsFlat['memory'] = report.system.memory;
    if (report.system.disk[0]) {
      metricsFlat['disk'] = report.system.disk[0];
    }
  }
  report.alerts = evaluateAlerts(metricsFlat);
  report.summary = formatReport(report);

  return report;
}
