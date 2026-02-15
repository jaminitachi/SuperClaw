#!/usr/bin/env node
/**
 * SuperClaw setup wizard — auto-installs all prerequisites and configures the plugin.
 *
 * Usage:
 *   npm run setup           # Full interactive setup
 *   npm run setup -- --skip-optional   # Skip optional components (Peekaboo, Telegram)
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';


const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const SUPERCLAW_ROOT = join(__dirname, '..');
const CONFIG_PATH = join(SUPERCLAW_ROOT, 'superclaw.json');
const OPENCLAW_CONFIG = join(HOME, '.openclaw', 'openclaw.json');
const SKIP_OPTIONAL = process.argv.includes('--skip-optional');

// ─── Helpers ─────────────────────────────────────────────────
function log(msg) { console.log(`  ${msg}`); }
function ok(msg) { console.log(`  \x1b[32m[OK]\x1b[0m ${msg}`); }
function warn(msg) { console.log(`  \x1b[33m[!!]\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m[FAIL]\x1b[0m ${msg}`); }
function step(n, msg) { console.log(`\n\x1b[36m${n}.\x1b[0m ${msg}`); }

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 60_000, ...opts }).trim();
  } catch {
    return null;
  }
}

function hasCommand(cmd) {
  return run(`which ${cmd}`) !== null;
}

function hasBrew() {
  return hasCommand('brew');
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(question) {
  return new Promise((resolve) => rl.question(`  ${question} `, resolve));
}

// ─── Steps ───────────────────────────────────────────────────
async function checkPlatform() {
  step(0, 'Checking platform...');
  const os = platform();
  if (os !== 'darwin') {
    warn(`SuperClaw is designed for macOS. Current platform: ${os}`);
    warn('Peekaboo and Mac automation features will not be available.');
    log('Memory, Telegram, and pipeline features will still work.');
  } else {
    ok(`macOS detected`);
  }
  return os;
}

async function installOpenClaw() {
  step(1, 'Checking OpenClaw...');

  // Check if openclaw CLI exists
  if (hasCommand('openclaw')) {
    const version = run('openclaw --version') ?? 'unknown';
    ok(`OpenClaw installed (${version})`);
  } else {
    log('OpenClaw not found. Installing...');
    const result = run('npm install -g openclaw', { stdio: 'inherit', timeout: 120_000 });
    if (result === null) {
      // npm install -g may need stdio: inherit to show progress
      try {
        execSync('npm install -g openclaw', { stdio: 'inherit', timeout: 120_000 });
        ok('OpenClaw installed');
      } catch {
        fail('Could not install OpenClaw. Try manually: npm install -g openclaw');
        return false;
      }
    } else {
      ok('OpenClaw installed');
    }
  }

  // Check config
  if (existsSync(OPENCLAW_CONFIG)) {
    const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8'));
    ok(`Config found (gateway port: ${config.gateway?.port ?? 18789})`);
  } else {
    log('Initializing OpenClaw config...');
    run('openclaw init', { stdio: 'inherit' });
    if (existsSync(OPENCLAW_CONFIG)) {
      ok('Config initialized');
    } else {
      warn('Config not created. Run "openclaw init" manually after setup.');
    }
  }

  // Check gateway
  const gatewayUp = run('curl -sf http://127.0.0.1:18789/ > /dev/null 2>&1 && echo up');
  if (gatewayUp === 'up') {
    ok('Gateway is running on port 18789');
  } else {
    log('Starting gateway...');
    try {
      execSync('openclaw gateway start', { timeout: 10_000 });
      // Wait a moment for startup
      await new Promise(r => setTimeout(r, 2000));
      const check = run('curl -sf http://127.0.0.1:18789/ > /dev/null 2>&1 && echo up');
      if (check === 'up') {
        ok('Gateway started');
      } else {
        warn('Gateway may still be starting. Check with: curl http://127.0.0.1:18789/health');
      }
    } catch {
      warn('Could not auto-start gateway. Start manually: openclaw gateway start');
    }
  }

  return true;
}

async function installPeekaboo(os) {
  step(2, 'Checking Peekaboo (Mac automation)...');

  if (os !== 'darwin') {
    log('Skipping — not macOS');
    return true;
  }

  if (SKIP_OPTIONAL) {
    log('Skipping — --skip-optional flag');
    return true;
  }

  if (hasCommand('peekaboo')) {
    const version = run('peekaboo --version') ?? 'unknown';
    ok(`Peekaboo ${version}`);
    return true;
  }

  if (!hasBrew()) {
    warn('Homebrew not found. Install Peekaboo manually:');
    log('  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    log('  brew install peekaboo');
    return false;
  }

  log('Installing Peekaboo via Homebrew...');
  try {
    execSync('brew install peekaboo', { stdio: 'inherit', timeout: 300_000 });
    ok('Peekaboo installed');

    log('');
    warn('Peekaboo needs macOS permissions. Grant these in System Settings:');
    log('  - Privacy & Security > Accessibility > Terminal/iTerm2');
    log('  - Privacy & Security > Screen Recording > Terminal/iTerm2');
    return true;
  } catch {
    fail('Peekaboo installation failed. Try manually: brew install peekaboo');
    return false;
  }
}

async function installSox(os) {
  step(3, 'Checking SoX (audio processing)...');

  if (hasCommand('sox')) {
    ok('SoX installed');
    return true;
  }

  if (os !== 'darwin' || !hasBrew()) {
    warn('SoX not found. Install manually for TTS support.');
    return false;
  }

  log('Installing SoX via Homebrew...');
  try {
    execSync('brew install sox', { stdio: 'inherit', timeout: 120_000 });
    ok('SoX installed');
    return true;
  } catch {
    warn('SoX installation failed. TTS skill will not work without it.');
    return false;
  }
}

async function installDependencies() {
  step(4, 'Installing Node.js dependencies...');

  if (existsSync(join(SUPERCLAW_ROOT, 'node_modules', 'better-sqlite3'))) {
    ok('node_modules already installed');
    return true;
  }

  log('Running npm install...');
  try {
    execSync('npm install', { cwd: SUPERCLAW_ROOT, stdio: 'inherit', timeout: 120_000 });
    ok('Dependencies installed');
    return true;
  } catch {
    fail('npm install failed. Check Node.js version (22+ required).');
    return false;
  }
}

async function buildServers() {
  step(5, 'Building MCP servers...');

  // Always rebuild to ensure latest
  try {
    execSync('npm run build', { cwd: SUPERCLAW_ROOT, stdio: 'inherit', timeout: 60_000 });
    ok('3 MCP servers built (sc-bridge, sc-peekaboo, sc-memory)');
    return true;
  } catch {
    fail('Build failed. Run "npm run typecheck" to see errors.');
    return false;
  }
}

async function setupDataDirectory() {
  step(6, 'Setting up data directory...');

  const dataDir = join(SUPERCLAW_ROOT, 'data');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, 'heartbeats'), { recursive: true });

  // Initialize empty memory.db by importing schema check
  const dbPath = join(dataDir, 'memory.db');
  if (!existsSync(dbPath)) {
    log('Memory database will be created on first MCP server start.');
  } else {
    const size = Math.round(require('fs').statSync(dbPath).size / 1024);
    ok(`Memory database exists (${size}KB)`);
  }

  ok('Data directory ready');
  return true;
}

async function createConfig() {
  step(7, 'Checking configuration...');

  if (existsSync(CONFIG_PATH)) {
    ok('superclaw.json exists');
    return true;
  }

  // Read OpenClaw token if available
  let gatewayToken = '';
  let gatewayPort = 18789;
  try {
    const oc = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8'));
    gatewayToken = oc?.gateway?.auth?.token ?? '';
    gatewayPort = oc?.gateway?.port ?? 18789;
  } catch {}

  // Detect Peekaboo path
  const peekabooPath = run('which peekaboo') ?? '/opt/homebrew/bin/peekaboo';

  // ─── Interactive Telegram setup ─────────────────────────
  let telegramEnabled = false;
  let telegramBotToken = '';
  let telegramChatId = '';

  if (!SKIP_OPTIONAL) {
    log('');
    log('Telegram lets you remote-control Claude from your phone.');
    const wantTelegram = (await ask('Set up Telegram? (y/n):')).trim().toLowerCase();

    if (wantTelegram === 'y' || wantTelegram === 'yes') {
      log('');
      log('To get a bot token:');
      log('  1. Open Telegram → search @BotFather');
      log('  2. Send /newbot and follow prompts');
      log('  3. Copy the token (looks like 123456789:ABCdef...)');
      log('');
      telegramBotToken = (await ask('Bot token (or Enter to skip):')).trim();

      if (telegramBotToken) {
        log('');
        log('To get your chat ID:');
        log('  1. Open Telegram → search @userinfobot');
        log('  2. Send /start — it replies with your ID');
        log('');
        telegramChatId = (await ask('Your chat ID:')).trim();
        telegramEnabled = !!(telegramBotToken && telegramChatId);
        if (telegramEnabled) {
          ok(`Telegram configured (chat ${telegramChatId})`);
        }
      } else {
        log('Skipping Telegram for now. Edit superclaw.json later to add it.');
      }
    }
  }

  const config = {
    "$schema": "./superclaw.schema.json",
    gateway: {
      host: '127.0.0.1',
      port: gatewayPort,
      token: gatewayToken,
      reconnect: true,
    },
    telegram: {
      enabled: telegramEnabled,
      botToken: telegramBotToken,
      allowFrom: telegramChatId ? [telegramChatId] : [],
      defaultChatId: telegramChatId,
    },
    heartbeat: {
      enabled: true,
      intervalSeconds: 300,
      collectors: ['system', 'process', 'github'],
    },
    memory: {
      dbPath: 'data/memory.db',
      syncWithOpenClaw: true,
    },
    peekaboo: {
      path: peekabooPath,
    },
    obsidian: {
      vaultPath: '',
      autoSync: false,
      syncOn: ['session_end'],
      include: ['knowledge', 'entities', 'conversations'],
    },
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  chmodSync(CONFIG_PATH, 0o600);
  ok('Config saved to superclaw.json');
  return true;
}

async function registerPlugin() {
  step(8, 'Plugin registration...');

  log('To register SuperClaw with Claude Code, run INSIDE a Claude Code session:');
  log('');
  log('  /plugin marketplace add ~/superclaw');
  log('  /plugin install superclaw');
  log('');
  log('Or launch Claude Code with the plugin loaded directly:');
  log(`  claude --plugin-dir ${SUPERCLAW_ROOT}`);
  log('');
  ok('See README.md for detailed instructions');
  return true;
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log(`
\x1b[36m╔══════════════════════════════════════════╗
║       SuperClaw Setup Wizard v2.0        ║
║  OpenClaw + Claude Code Integration      ║
╚══════════════════════════════════════════╝\x1b[0m
`);

  const results = {};

  // Phase 1: Platform & Prerequisites
  const os = await checkPlatform();
  results.openclaw = await installOpenClaw();
  results.peekaboo = await installPeekaboo(os);
  results.sox = await installSox(os);

  // Phase 2: Build
  results.deps = await installDependencies();
  results.build = await buildServers();

  // Phase 3: Configure
  results.data = await setupDataDirectory();
  results.config = await createConfig();

  // Phase 4: Register
  results.plugin = await registerPlugin();

  // ─── Summary ─────────────────────────────────────────────
  console.log(`
\x1b[36m╔══════════════════════════════════════════╗
║            Setup Summary                 ║
╚══════════════════════════════════════════╝\x1b[0m
`);

  const items = [
    ['OpenClaw Gateway', results.openclaw],
    ['Peekaboo (Mac Automation)', results.peekaboo],
    ['SoX (Audio/TTS)', results.sox],
    ['Node.js Dependencies', results.deps],
    ['MCP Servers (3)', results.build],
    ['Data Directory', results.data],
    ['Configuration', results.config],
    ['Claude Code Plugin', results.plugin],
  ];

  for (const [name, success] of items) {
    const icon = success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${icon} ${name}`);
  }

  const allOk = Object.values(results).every(Boolean);

  rl.close();

  if (allOk) {
    console.log(`
\x1b[32m  All components installed successfully!\x1b[0m

  Next step — register the plugin with Claude Code:

    claude --plugin-dir ~/superclaw

  Or inside an existing Claude Code session:

    /plugin install ~/superclaw

  Then try:
    - "take a screenshot" (Mac automation)
    - "search memory for..." (persistent memory)
    - "send to phone: hello" (Telegram)

  MCP Tools: 31 tools across 3 servers
  Agents: 39 specialists across 6 domains
  Skills: 15 auto-detected capabilities
`);
  } else {
    const failed = items.filter(([, s]) => !s).map(([n]) => n);
    console.log(`
\x1b[33m  Setup completed with warnings.\x1b[0m
  Components needing attention: ${failed.join(', ')}

  Core features (memory, agents, skills) will work.
  Fix warnings above for full functionality.
`);
  }
}

main().catch((err) => {
  fail(`Setup failed: ${err.message}`);
  process.exit(1);
});
