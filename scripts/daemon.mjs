#!/usr/bin/env node
/**
 * SuperClaw Daemon Manager — start, stop, status, install/uninstall LaunchAgent.
 *
 * Usage:
 *   node scripts/daemon.mjs start      # Start daemon in background
 *   node scripts/daemon.mjs stop       # Stop daemon
 *   node scripts/daemon.mjs status     # Check if running
 *   node scripts/daemon.mjs install    # Install macOS LaunchAgent
 *   node scripts/daemon.mjs uninstall  # Remove LaunchAgent
 */
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPERCLAW_ROOT = join(__dirname, '..');
const DATA_DIR = join(SUPERCLAW_ROOT, 'data');
const LOG_DIR = join(DATA_DIR, 'logs');
const PID_FILE = join(DATA_DIR, 'daemon.pid');
const DAEMON_SCRIPT = join(SUPERCLAW_ROOT, 'bridge', 'sc-daemon.cjs');
const PLIST_NAME = 'com.superclaw.daemon';
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${PLIST_NAME}.plist`);

// Resolve the current node binary path
const NODE_PATH = process.execPath;
const NODE_DIR = dirname(NODE_PATH);

const command = process.argv[2] ?? 'start';

// ─── Helpers ──────────────────────────────────────────────────
function log(msg) { console.log(`  ${msg}`); }
function ok(msg) { console.log(`  \x1b[32m[OK]\x1b[0m ${msg}`); }
function warn(msg) { console.log(`  \x1b[33m[!!]\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m[FAIL]\x1b[0m ${msg}`); }

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
  return isNaN(pid) ? null : pid;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Commands ─────────────────────────────────────────────────

function cmdStart() {
  console.log('\nSuperClaw Daemon — Starting...\n');

  if (!existsSync(DAEMON_SCRIPT)) {
    fail(`Daemon not built: ${DAEMON_SCRIPT}`);
    log('Run "npm run build" first.');
    process.exit(1);
  }

  const existingPid = readPid();
  if (existingPid && isProcessAlive(existingPid)) {
    warn(`Daemon already running (PID ${existingPid})`);
    process.exit(0);
  }

  mkdirSync(LOG_DIR, { recursive: true });

  const logFile = join(LOG_DIR, 'daemon.log');
  const logFd = openSync(logFile, 'a');

  const child = spawn(NODE_PATH, [DAEMON_SCRIPT], {
    cwd: SUPERCLAW_ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      PATH: `${NODE_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    },
  });

  child.unref();

  ok(`Daemon started (PID ${child.pid})`);
  log(`Log: ${logFile}`);
  log(`PID file: ${PID_FILE}`);
}

function cmdStop() {
  console.log('\nSuperClaw Daemon — Stopping...\n');

  const pid = readPid();
  if (!pid) {
    warn('No PID file found. Daemon may not be running.');
    process.exit(0);
  }

  if (!isProcessAlive(pid)) {
    warn(`PID ${pid} is not running. Cleaning up stale PID file.`);
    try { unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  }

  try {
    process.kill(pid, 'SIGTERM');
    ok(`Sent SIGTERM to PID ${pid}`);

    // Wait up to 5s for the process to stop
    let waited = 0;
    while (waited < 5000 && isProcessAlive(pid)) {
      execSync('sleep 0.5');
      waited += 500;
    }

    if (isProcessAlive(pid)) {
      warn('Process did not stop gracefully. Sending SIGKILL.');
      process.kill(pid, 'SIGKILL');
    }

    ok('Daemon stopped');
  } catch (err) {
    fail(`Failed to stop daemon: ${err.message}`);
    process.exit(1);
  }
}

function cmdStatus() {
  console.log('\nSuperClaw Daemon — Status\n');

  const pid = readPid();
  if (!pid) {
    log('Status: NOT RUNNING (no PID file)');
    process.exit(1);
  }

  if (isProcessAlive(pid)) {
    ok(`Status: RUNNING (PID ${pid})`);
    log(`PID file: ${PID_FILE}`);
    log(`Log: ${join(LOG_DIR, 'daemon.log')}`);
  } else {
    warn(`Status: DEAD (stale PID ${pid})`);
    log('The daemon has stopped. Remove PID file and restart.');
    try { unlinkSync(PID_FILE); } catch {}
    process.exit(1);
  }
}

function cmdInstall() {
  console.log('\nSuperClaw Daemon — Installing LaunchAgent...\n');

  const plistDir = dirname(PLIST_PATH);
  mkdirSync(plistDir, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  const logFile = join(LOG_DIR, 'daemon.log');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${DAEMON_SCRIPT}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
  <key>WorkingDirectory</key>
  <string>${SUPERCLAW_ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${NODE_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>`;

  writeFileSync(PLIST_PATH, plist);
  ok(`Plist written: ${PLIST_PATH}`);

  try {
    execSync(`launchctl load -w "${PLIST_PATH}"`, { stdio: 'inherit' });
    ok('LaunchAgent loaded. Daemon will start at login.');
  } catch {
    warn('launchctl load failed. Try manually:');
    log(`  launchctl load -w "${PLIST_PATH}"`);
  }
}

function cmdUninstall() {
  console.log('\nSuperClaw Daemon — Uninstalling LaunchAgent...\n');

  if (!existsSync(PLIST_PATH)) {
    warn('LaunchAgent plist not found. Nothing to uninstall.');
    process.exit(0);
  }

  try {
    execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'inherit' });
    ok('LaunchAgent unloaded');
  } catch {
    warn('launchctl unload failed (may already be unloaded)');
  }

  try {
    unlinkSync(PLIST_PATH);
    ok(`Plist removed: ${PLIST_PATH}`);
  } catch (err) {
    fail(`Failed to remove plist: ${err.message}`);
  }
}

// ─── Dispatch ─────────────────────────────────────────────────
switch (command) {
  case 'start':
    cmdStart();
    break;
  case 'stop':
    cmdStop();
    break;
  case 'status':
    cmdStatus();
    break;
  case 'install':
    cmdInstall();
    break;
  case 'uninstall':
    cmdUninstall();
    break;
  default:
    console.log(`\nUnknown command: ${command}`);
    console.log('Usage: node scripts/daemon.mjs [start|stop|status|install|uninstall]\n');
    process.exit(1);
}
