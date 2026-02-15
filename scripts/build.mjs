#!/usr/bin/env node
/**
 * Build script — bundles MCP servers to CJS for Claude Code plugin.
 * Output: bridge/sc-bridge.cjs, bridge/sc-peekaboo.cjs, bridge/sc-memory.cjs
 */
import { build } from 'esbuild';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const isWatch = process.argv.includes('--watch');

const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  // Mark native modules as external — they can't be bundled
  external: ['better-sqlite3'],
  banner: {
    js: [
      '#!/usr/bin/env node',
      '// SuperClaw MCP Server — bundled by esbuild',
      '// Resolve global npm modules for native dependencies',
      'try {',
      '  var _cp = require("child_process");',
      '  var _Module = require("module");',
      '  var _globalRoot = _cp.execSync("npm root -g", { encoding: "utf8", timeout: 5000 }).trim();',
      '  if (_globalRoot) {',
      '    process.env.NODE_PATH = _globalRoot + (process.env.NODE_PATH ? ":" + process.env.NODE_PATH : "");',
      '    _Module._initPaths();',
      '  }',
      '} catch (_e) { /* npm not available */ }',
      '',
      '// Also resolve local node_modules',
      'try {',
      '  var _path = require("path");',
      '  var _localRoot = _path.join(__dirname, "..", "node_modules");',
      '  process.env.NODE_PATH = _localRoot + (process.env.NODE_PATH ? ":" + process.env.NODE_PATH : "");',
      '  require("module")._initPaths();',
      '} catch (_e) {}',
    ].join('\n'),
  },
};

const servers = [
  {
    name: 'sc-bridge',
    entry: join(root, 'src/mcp/bridge-server.ts'),
    out: join(root, 'bridge/sc-bridge.cjs'),
  },
  {
    name: 'sc-peekaboo',
    entry: join(root, 'src/mcp/peekaboo-server.ts'),
    out: join(root, 'bridge/sc-peekaboo.cjs'),
  },
  {
    name: 'sc-memory',
    entry: join(root, 'src/mcp/memory-server.ts'),
    out: join(root, 'bridge/sc-memory.cjs'),
    // Memory server needs better-sqlite3 external
    external: ['better-sqlite3'],
  },
];

async function buildAll() {
  const startTime = Date.now();
  console.log('Building SuperClaw MCP servers...\n');

  const results = await Promise.all(
    servers.map(async (s) => {
      const t0 = Date.now();
      try {
        const ctx = await build({
          ...sharedConfig,
          entryPoints: [s.entry],
          outfile: s.out,
          external: s.external ?? sharedConfig.external,
        });
        const ms = Date.now() - t0;
        console.log(`  [OK] ${s.name} (${ms}ms) → ${s.out}`);
        return { name: s.name, ok: true };
      } catch (err) {
        const ms = Date.now() - t0;
        console.error(`  [FAIL] ${s.name} (${ms}ms):`, err.message);
        return { name: s.name, ok: false, error: err };
      }
    })
  );

  const totalMs = Date.now() - startTime;
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;

  console.log(`\nBuild complete: ${ok}/${results.length} servers (${totalMs}ms)`);
  if (fail > 0) {
    process.exit(1);
  }
}

buildAll();
