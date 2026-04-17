#!/usr/bin/env node
/**
 * schedule-manager.mjs — macOS launchd schedule framework for SuperClaw.
 *
 * Provides functions to create, remove, and list launchd user agents,
 * plus pmset wake synchronization. macOS only (darwin).
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { execSync, execFileSync } from 'child_process';

const HOME = homedir();
const AGENTS_DIR = join(HOME, 'Library', 'LaunchAgents');
const PLIST_PREFIX = 'com.user.sc-';
const UID = process.getuid?.() ?? execSync('id -u', { encoding: 'utf-8' }).trim();

function ensureDarwin() {
  if (platform() !== 'darwin') {
    throw new Error('schedule-manager는 macOS에서만 지원됩니다 (launchd 기반).');
  }
}

function nodeDir() {
  return dirname(process.execPath);
}

function buildPlistXml({ label, programArgs, hour, minute, weekday, envVars }) {
  const schedEntries = [];
  if (weekday !== undefined) schedEntries.push(`    <key>Weekday</key>\n    <integer>${weekday}</integer>`);
  schedEntries.push(`    <key>Hour</key>\n    <integer>${hour}</integer>`);
  schedEntries.push(`    <key>Minute</key>\n    <integer>${minute}</integer>`);

  const argsXml = programArgs.map(a => `    <string>${a}</string>`).join('\n');

  const envEntries = Object.entries(envVars)
    .map(([k, v]) => `    <key>${k}</key>\n    <string>${v}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>StartCalendarInterval</key>
  <dict>
${schedEntries.join('\n')}
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/tmp/${label}.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/${label}.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
</dict>
</plist>`;
}

/**
 * Register a launchd user agent schedule.
 * @param {object} opts
 * @param {string} opts.name - Schedule name (e.g. 'morning-brief')
 * @param {string} [opts.scriptPath] - Absolute path to a bash script
 * @param {string} [opts.nodeScript] - Absolute path to a node .mjs script (mutually exclusive with scriptPath)
 * @param {number} opts.hour - Hour (0-23)
 * @param {number} opts.minute - Minute (0-59)
 * @param {number} [opts.weekday] - Day of week (0=Sunday, 1=Monday, ..., 6=Saturday). Omit for daily.
 * @returns {{ plistPath: string, label: string }}
 */
export function addSchedule({ name, scriptPath, nodeScript, hour, minute, weekday }) {
  ensureDarwin();

  if (!name || (!scriptPath && !nodeScript)) {
    throw new Error('name과 scriptPath 또는 nodeScript 중 하나는 필수입니다.');
  }
  if (scriptPath && nodeScript) {
    throw new Error('scriptPath와 nodeScript를 동시에 지정할 수 없습니다.');
  }

  const target = scriptPath || nodeScript;
  if (!existsSync(target)) {
    throw new Error(`스크립트를 찾을 수 없습니다: ${target}`);
  }

  const label = `${PLIST_PREFIX}${name}`;
  const plistPath = join(AGENTS_DIR, `${label}.plist`);

  const programArgs = nodeScript
    ? [process.execPath, nodeScript]
    : ['/bin/bash', scriptPath];

  const envVars = {
    PATH: `${nodeDir()}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    HOME,
    SUPERCLAW_DAEMON: '1',
    CMUX_CLAUDE_HOOKS_DISABLED: '1',
  };

  const xml = buildPlistXml({ label, programArgs, hour, minute, weekday, envVars });

  mkdirSync(AGENTS_DIR, { recursive: true });
  writeFileSync(plistPath, xml);

  try { execSync(`launchctl bootout gui/${UID}/${label} 2>/dev/null`, { stdio: 'pipe' }); } catch {}
  execSync(`launchctl bootstrap gui/${UID} ${plistPath}`);

  return { plistPath, label };
}

/**
 * Remove a launchd user agent schedule.
 * @param {string} name - Schedule name
 * @returns {boolean} true if removed
 */
export function removeSchedule(name) {
  ensureDarwin();
  const label = `${PLIST_PREFIX}${name}`;
  const plistPath = join(AGENTS_DIR, `${label}.plist`);

  try { execSync(`launchctl bootout gui/${UID}/${label} 2>/dev/null`, { stdio: 'pipe' }); } catch {}

  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
    return true;
  }
  return false;
}

/**
 * List all registered SuperClaw launchd schedules.
 * @returns {Array<{name: string, hour: number, minute: number, weekday?: number, scriptPath: string, status: string, lastExitCode: string, schedule: string}>}
 */
export function listSchedules() {
  ensureDarwin();
  if (!existsSync(AGENTS_DIR)) return [];

  const results = [];
  for (const file of readdirSync(AGENTS_DIR)) {
    if (!file.startsWith(PLIST_PREFIX) || !file.endsWith('.plist')) continue;
    const name = file.slice(PLIST_PREFIX.length, -'.plist'.length);
    const plistPath = join(AGENTS_DIR, file);
    const label = `${PLIST_PREFIX}${name}`;

    let hour, minute, weekday, scriptPath;
    try {
      const pb = (key) => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, plistPath], { encoding: 'utf-8' }).trim();
      hour = parseInt(pb(':StartCalendarInterval:Hour'), 10);
      minute = parseInt(pb(':StartCalendarInterval:Minute'), 10);
      try { weekday = parseInt(pb(':StartCalendarInterval:Weekday'), 10); } catch {}
      let idx = 0;
      while (true) {
        try { scriptPath = pb(`:ProgramArguments:${idx}`); idx++; } catch { break; }
      }
    } catch {}

    let status = 'unknown', lastExitCode = '?';
    try {
      const info = execSync(`launchctl print gui/${UID}/${label} 2>&1`, { encoding: 'utf-8' });
      const stateMatch = info.match(/\tstate = (\S+)/);
      const exitMatch = info.match(/last exit code = (\S+)/);
      if (stateMatch) status = stateMatch[1];
      if (exitMatch) lastExitCode = exitMatch[1];
    } catch { status = 'not loaded'; }

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const schedStr = weekday !== undefined
      ? `${days[weekday]} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      : `daily ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    results.push({ name, hour, minute, weekday, scriptPath, status, lastExitCode, schedule: schedStr });
  }

  return results;
}

/**
 * Synchronize pmset wake schedule from registered launchd agents.
 * Picks the earliest scheduled time and sets wakeorpoweron.
 * Requires sudoers NOPASSWD for /usr/bin/pmset.
 * @returns {{ wakeTime: string } | null}
 */
export function syncPmsetWake() {
  ensureDarwin();
  const schedules = listSchedules();
  if (schedules.length === 0) return null;

  const wakeTimes = schedules.map(s => {
    let wMin = s.minute - 5;
    let wHour = s.hour;
    if (wMin < 0) { wMin += 60; wHour = (wHour - 1 + 24) % 24; }
    return `${String(wHour).padStart(2, '0')}:${String(wMin).padStart(2, '0')}`;
  });

  wakeTimes.sort();
  const earliest = wakeTimes[0];

  try {
    execSync(`sudo -n /usr/bin/pmset repeat wakeorpoweron MTWRFSU ${earliest}:00`, { stdio: 'pipe' });
    return { wakeTime: earliest };
  } catch {
    console.error(`[schedule-manager] pmset 설정 실패. 수동 실행: sudo pmset repeat wakeorpoweron MTWRFSU ${earliest}:00`);
    return null;
  }
}
