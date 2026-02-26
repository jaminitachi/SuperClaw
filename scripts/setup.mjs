#!/usr/bin/env node
/**
 * SuperClaw setup wizard — auto-installs all prerequisites and configures the plugin.
 *
 * Usage:
 *   npm run setup           # Full interactive setup
 *   npm run setup -- --skip-optional   # Skip optional components (Peekaboo, Telegram)
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';


const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const SUPERCLAW_ROOT = join(__dirname, '..');
const CONFIG_PATH = join(SUPERCLAW_ROOT, 'superclaw.json');
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

function injectClaudeMd() {
  step('7b', 'Injecting delegation rules into CLAUDE.md...');

  const START_MARKER = '<!-- SC:START -->';
  const END_MARKER = '<!-- SC:END -->';
  const VERSION_MARKER = `<!-- SC:VERSION:2.0.0 -->`;

  // Read SuperClaw delegation rules
  const scClaudeMdPath = join(SUPERCLAW_ROOT, 'docs', 'CLAUDE.md');
  if (!existsSync(scClaudeMdPath)) {
    warn('docs/CLAUDE.md not found — skipping delegation rules injection');
    return true;
  }
  const scContent = readFileSync(scClaudeMdPath, 'utf-8');

  // Target: ~/.claude/CLAUDE.md
  const targetPath = join(HOME, '.claude', 'CLAUDE.md');
  mkdirSync(join(HOME, '.claude'), { recursive: true });

  let existing = '';
  if (existsSync(targetPath)) {
    existing = readFileSync(targetPath, 'utf-8');
  }

  // Build new block
  const newBlock = `${START_MARKER}\n${VERSION_MARKER}\n${scContent}\n${END_MARKER}`;

  // Check if markers already exist
  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  let merged;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block
    const before = existing.substring(0, startIdx);
    const after = existing.substring(endIdx + END_MARKER.length);
    merged = `${before}${newBlock}${after}`;
    ok('Delegation rules updated in ~/.claude/CLAUDE.md');
  } else {
    // No existing markers — prepend
    if (existing.trim()) {
      merged = `${newBlock}\n\n${existing}`;
    } else {
      merged = newBlock;
    }
    ok('Delegation rules injected into ~/.claude/CLAUDE.md');
  }

  // Backup before writing
  if (existing.trim()) {
    const backupPath = join(HOME, '.claude', `CLAUDE.md.backup.${Date.now()}`);
    writeFileSync(backupPath, existing);
  }

  writeFileSync(targetPath, merged);
  return true;
}

// ─── Steps ───────────────────────────────────────────────────
async function checkPeekabooPermissions() {
  const permsOutput = run('peekaboo permissions --verbose') ?? '';
  const screenOk = permsOutput.includes('Screen Recording') && permsOutput.includes('Granted');
  const accessOk = permsOutput.includes('Accessibility') && permsOutput.includes('Granted');

  if (screenOk && accessOk) {
    ok('Peekaboo permissions already granted');
    return true;
  }

  warn('Peekaboo needs macOS permissions. Opening System Settings...');

  if (!screenOk) {
    run('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"');
    log('  → Screen Recording: Toggle ON for your terminal app (iTerm2/Terminal)');
  }
  if (!accessOk) {
    run('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
    log('  → Accessibility: Toggle ON for your terminal app (iTerm2/Terminal)');
  }

  log('');
  log('Waiting for permissions to be granted (checking every 3s, timeout 60s)...');

  const startTime = Date.now();
  const TIMEOUT = 60_000;

  while (Date.now() - startTime < TIMEOUT) {
    await new Promise(r => setTimeout(r, 3000));
    const check = run('peekaboo permissions --verbose') ?? '';
    const sOk = check.includes('Screen Recording') && !check.includes('Not Granted');
    const aOk = check.includes('Accessibility') && !check.includes('Not Granted');

    if (sOk && aOk) {
      ok('Both permissions granted!');
      return true;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log(`  ... still waiting (${elapsed}s) — toggle the permissions in System Settings`);
  }

  warn('Timeout — permissions not yet granted. You can grant them later in System Settings.');
  warn('Peekaboo features will not work until permissions are granted.');
  return false;
}

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
    return checkPeekabooPermissions();
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
    return checkPeekabooPermissions();
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
    const size = Math.round(statSync(dbPath).size / 1024);
    ok(`Memory database exists (${size}KB)`);
  }

  ok('Data directory ready');
  return true;
}

async function createConfig() {
  step(7, 'Configuration & Telegram...');

  // Load existing config or build from scratch
  let config;
  let isExisting = false;

  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      isExisting = true;
      ok('superclaw.json found');
    } catch {
      warn('superclaw.json is corrupted, recreating...');
    }
  }

  if (!config) {
    const peekabooPath = run('which peekaboo') ?? '/opt/homebrew/bin/peekaboo';

    config = {
      "$schema": "./superclaw.schema.json",
      telegram: { enabled: false, botToken: '', allowFrom: [], defaultChatId: '' },
      heartbeat: { enabled: true, intervalSeconds: 300, collectors: ['system', 'process', 'github'] },
      memory: { dbPath: 'data/memory.db' },
      peekaboo: { path: peekabooPath },
      obsidian: { vaultPath: '', autoSync: false, syncOn: ['session_end'], include: ['knowledge', 'entities', 'conversations'] },
    };
  }

  // ─── Interactive Telegram setup (always ask if not configured) ───
  const telegramAlreadyConfigured = config.telegram?.enabled && config.telegram?.botToken;

  if (telegramAlreadyConfigured) {
    ok(`Telegram already configured (chat ${config.telegram.defaultChatId})`);
  } else if (!SKIP_OPTIONAL) {
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
      const botToken = (await ask('Bot token (or Enter to skip):')).trim();

      if (botToken) {
        log('');
        log('To get your chat ID, send a message to your bot first, then:');
        log(`  curl -s "https://api.telegram.org/bot${botToken}/getUpdates" | grep -o '"id":[0-9]*' | head -1`);
        log('');
        log('Or search @raw_data_bot on Telegram and send /start.');
        log('');
        const chatId = (await ask('Your chat ID:')).trim();

        if (botToken && chatId) {
          config.telegram = { enabled: true, botToken, allowFrom: [chatId], defaultChatId: chatId };

          // Verify bot token works
          log('Verifying Telegram bot...');
          const verifyResult = run(`curl -sf "https://api.telegram.org/bot${botToken}/getMe" 2>&1`);
          if (verifyResult && verifyResult.includes('"ok":true')) {
            ok('Telegram bot verified');
          } else {
            warn('Could not verify bot token. Double-check the token.');
          }

          ok(`Telegram fully configured (chat ${chatId})`);
        }
      } else {
        log('Skipping Telegram. Run "npm run setup" again anytime to add it.');
      }
    }
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  chmodSync(CONFIG_PATH, 0o600);
  ok(isExisting ? 'Config updated' : 'Config created');
  return true;
}

function setupHud() {
  step('8b', 'Setting up HUD statusline...');

  const settingsPath = join(HOME, '.claude', 'settings.json');
  const hudCmd = `node ${join(SUPERCLAW_ROOT, 'hud', 'index.mjs')}`;

  let settings = {};
  try {
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    }
  } catch {
    settings = {};
  }

  if (settings.statusCommand === hudCmd) {
    ok('HUD statusline already configured');
    return true;
  }

  settings.statusCommand = hudCmd;

  try {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    ok('HUD statusline configured — will auto-start with Claude Code');
    return true;
  } catch (e) {
    warn(`Could not write settings.json: ${e.message}`);
    log(`  Manually add to ~/.claude/settings.json:`);
    log(`  "statusCommand": "${hudCmd}"`);
    return false;
  }
}

async function registerPlugin() {
  step(8, 'Registering plugin permanently...');

  // Check if already registered as marketplace
  const marketplaces = run('claude plugin marketplace list 2>/dev/null') ?? '';
  const alreadyRegistered = marketplaces.includes('superclaw');

  if (!alreadyRegistered) {
    log('Adding SuperClaw as local marketplace...');
    const addResult = run(`claude plugin marketplace add "${SUPERCLAW_ROOT}" 2>&1`);
    if (addResult === null) {
      warn('Could not add marketplace. You can do it manually:');
      log(`  claude plugin marketplace add ${SUPERCLAW_ROOT}`);
      log('  claude plugin install superclaw@superclaw');
      return false;
    }
    ok('Marketplace registered');
  } else {
    ok('Marketplace already registered');
  }

  // Check if plugin is installed
  const plugins = run('claude plugin list 2>/dev/null') ?? '';
  const pluginInstalled = plugins.includes('superclaw');

  if (!pluginInstalled) {
    log('Installing SuperClaw plugin...');
    const installResult = run('claude plugin install superclaw@superclaw 2>&1');
    if (installResult === null) {
      warn('Could not install plugin. You can do it manually:');
      log('  claude plugin install superclaw@superclaw');
      return false;
    }
    ok('Plugin installed permanently');
  } else {
    ok('Plugin already installed');
  }

  return true;
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log(`
\x1b[36m╔══════════════════════════════════════════╗
║       SuperClaw Setup Wizard v2.0        ║
║     Claude Code AI Plugin                ║
╚══════════════════════════════════════════╝\x1b[0m
`);

  const results = {};

  // Phase 1: Platform & Prerequisites
  const os = await checkPlatform();
  results.peekaboo = await installPeekaboo(os);
  results.sox = await installSox(os);

  // Phase 2: Build
  results.deps = await installDependencies();
  results.build = await buildServers();

  // Phase 3: Configure
  results.data = await setupDataDirectory();
  results.config = await createConfig();
  results.claudemd = injectClaudeMd();

  // Phase 4: Register
  results.plugin = await registerPlugin();

  // Phase 5: HUD statusline
  results.hud = setupHud();

  // ─── Summary ─────────────────────────────────────────────
  console.log(`
\x1b[36m╔══════════════════════════════════════════╗
║            Setup Summary                 ║
╚══════════════════════════════════════════╝\x1b[0m
`);

  const items = [
    ['Peekaboo (Mac Automation)', results.peekaboo],
    ['SoX (Audio/TTS)', results.sox],
    ['Node.js Dependencies', results.deps],
    ['MCP Servers (3)', results.build],
    ['Data Directory', results.data],
    ['Configuration', results.config],
    ['CLAUDE.md Delegation Rules', results.claudemd],
    ['Claude Code Plugin', results.plugin],
    ['HUD Statusline', results.hud],
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

  SuperClaw is now permanently registered with Claude Code.
  Just run \x1b[36mclaude\x1b[0m — SuperClaw loads automatically.

  Try:
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
