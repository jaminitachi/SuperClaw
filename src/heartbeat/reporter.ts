import type { SystemMetrics } from './collectors/system.js';
import type { DevMetrics } from './collectors/dev.js';
import type { GithubMetrics } from './collectors/github.js';
import type { CalendarMetrics } from './collectors/calendar.js';
import type { ProcessMetrics } from './collectors/process.js';
import type { Alert } from './alerting.js';

export interface HeartbeatReport {
  timestamp: string;
  system?: SystemMetrics;
  dev?: DevMetrics;
  github?: GithubMetrics;
  calendar?: CalendarMetrics;
  process?: ProcessMetrics;
  alerts: Alert[];
  summary: string;
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / (1024 ** 2)).toFixed(0)}MB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatReport(report: HeartbeatReport): string {
  const lines: string[] = [];
  lines.push(`--- Heartbeat ${report.timestamp} ---`);

  if (report.system) {
    const s = report.system;
    lines.push('');
    lines.push(`CPU: ${s.cpu.usage}% (${s.cpu.count} cores) | Load: ${s.loadAvg.map(l => l.toFixed(1)).join(', ')}`);
    lines.push(`Memory: ${formatBytes(s.memory.used)}/${formatBytes(s.memory.total)} (${s.memory.percent}%)`);
    for (const d of s.disk) {
      lines.push(`Disk ${d.mount}: ${formatBytes(d.used)}/${formatBytes(d.total)} (${Math.round(d.percent)}%)`);
    }
    lines.push(`Uptime: ${formatUptime(s.uptime)}`);
  }

  if (report.dev?.git) {
    const g = report.dev.git;
    lines.push('');
    lines.push(`Git: ${g.branch} | ${g.uncommitted} uncommitted | +${g.ahead}/-${g.behind}`);
  }

  if (report.github) {
    const gh = report.github;
    lines.push('');
    lines.push(`PRs: ${gh.prs.total} open (${gh.prs.mine} mine, ${gh.prs.reviewRequested} review requested)`);
    lines.push(`Issues: ${gh.issues.total} open (${gh.issues.assigned} assigned)`);
    if (gh.ci) {
      lines.push(`CI: ${gh.ci.status}${gh.ci.conclusion ? ` (${gh.ci.conclusion})` : ''}`);
    }
  }

  if (report.calendar && report.calendar.eventsToday > 0) {
    lines.push('');
    lines.push(`Calendar: ${report.calendar.eventsToday} event(s) today`);
    if (report.calendar.nextEvent) {
      lines.push(`  Next: ${report.calendar.nextEvent.title} @ ${report.calendar.nextEvent.start}`);
    }
  }

  if (report.process) {
    const running = report.process.watchedProcesses.filter(p => p.running);
    const openPorts = report.process.portChecks.filter(p => p.open);
    if (running.length > 0) {
      lines.push('');
      lines.push(`Processes: ${running.map(p => p.name).join(', ')}`);
    }
    if (openPorts.length > 0) {
      lines.push(`Ports: ${openPorts.map(p => `${p.port}${p.process ? `(${p.process})` : ''}`).join(', ')}`);
    }
  }

  if (report.alerts.length > 0) {
    lines.push('');
    lines.push('ALERTS:');
    for (const alert of report.alerts) {
      lines.push(`  ${alert.formatted}`);
    }
  }

  return lines.join('\n');
}

export function formatCompactReport(report: HeartbeatReport): string {
  const parts: string[] = [];

  if (report.system) {
    parts.push(`CPU:${report.system.cpu.usage}%`);
    parts.push(`Mem:${report.system.memory.percent}%`);
    const mainDisk = report.system.disk[0];
    if (mainDisk) parts.push(`Disk:${Math.round(mainDisk.percent)}%`);
  }

  if (report.alerts.length > 0) {
    parts.push(`Alerts:${report.alerts.length}`);
  }

  return parts.join(' | ');
}
