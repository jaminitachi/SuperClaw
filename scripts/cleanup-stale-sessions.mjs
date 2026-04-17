#!/usr/bin/env node
import { readdirSync, statSync, existsSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SESSIONS = join(homedir(), '.claude', '.sc', 'state', 'sessions');
const THRESHOLD_MS = 48 * 60 * 60 * 1000;

if (!existsSync(SESSIONS)) {
  console.log('Deleted 0 stale session dirs');
  process.exit(0);
}

let deleted = 0;

const entries = readdirSync(SESSIONS, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const dirPath = join(SESSIONS, entry.name);

  try {
    // Skip active sessions that have ultrawork-state.json
    const guardFile = join(dirPath, 'ultrawork-state.json');
    if (existsSync(guardFile)) continue;

    const dirStat = statSync(dirPath);
    const age = Date.now() - dirStat.mtimeMs;
    if (age < THRESHOLD_MS) continue;

    const children = readdirSync(dirPath);
    for (const child of children) {
      try {
        unlinkSync(join(dirPath, child));
      } catch {
        // ignore
      }
    }
    rmdirSync(dirPath);
    deleted++;
  } catch {
    // continue processing other dirs on error
  }
}

console.log(`Deleted ${deleted} stale session dirs`);
