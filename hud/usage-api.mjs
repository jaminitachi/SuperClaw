import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CACHE_TTL_SUCCESS = 120_000;  // 2 min — don't poll too often on success
const CACHE_TTL_FAIL_BASE = 60_000; // 1 min base backoff on failure
const CACHE_TTL_FAIL_MAX = 600_000; // 10 min max backoff
const CACHE_TTL_STALE = 3_600_000;  // 1 hour — max age for stale lastGood data

let cachedUsage = null;
let cacheTimestamp = 0;
let cacheSuccess = false;
let lastGoodData = null;  // stale-while-error: keep last known good usage

const CACHE_FILE = join(homedir(), '.claude', '.sc', '.usage-cache.json');

export async function getUsage() {
  const now = Date.now();

  // Check file cache (file cache is the only real cache — each HUD run is a new process)
  try {
    if (existsSync(CACHE_FILE)) {
      const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
      // Restore last known good data for stale-while-error
      if (cached.lastGood && (now - cached.timestamp) < CACHE_TTL_STALE) {
        lastGoodData = cached.lastGood;
      }
      // Determine TTL based on last result — exponential backoff on failures
      const failCount = cached.failCount || 0;
      const ttl = cached.success
        ? CACHE_TTL_SUCCESS
        : Math.min(CACHE_TTL_FAIL_BASE * Math.pow(2, failCount), CACHE_TTL_FAIL_MAX);
      if ((now - cached.timestamp) < ttl) {
        // Cache still valid — return cached data or stale fallback
        if (cached.data) return cached.data;
        if (lastGoodData) return { ...lastGoodData, stale: true };
        return null;
      }
    }
  } catch {}

  // Fetch from API
  try {
    const token = getOAuthToken();
    if (!token) return lastGoodData ? { ...lastGoodData, stale: true } : null;

    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // Try token refresh if 401
      if (response.status === 401) {
        const newToken = await refreshToken();
        if (newToken) {
          const retryResponse = await fetch('https://api.anthropic.com/api/oauth/usage', {
            headers: {
              'Authorization': `Bearer ${newToken}`,
              'anthropic-beta': 'oauth-2025-04-20',
            },
            signal: AbortSignal.timeout(5000),
          });
          if (retryResponse.ok) {
            const data = await retryResponse.json();
            const usage = parseUsageResponse(data);
            lastGoodData = usage;
            saveCache(usage, true);
            return usage;
          }
        }
      }
      // API error (429, 5xx, etc.) — return stale lastGood with stale flag
      saveCache(null, false);
      return lastGoodData ? { ...lastGoodData, stale: true } : null;
    }

    const data = await response.json();
    const usage = parseUsageResponse(data);
    lastGoodData = usage;
    saveCache(usage, true);
    return usage;
  } catch {
    saveCache(null, false);
    return lastGoodData ? { ...lastGoodData, stale: true } : null;
  }
}

function parseUsageResponse(data) {
  const result = {};

  // 5-hour rolling limit
  if (data.five_hour) {
    result.fiveHourPercent = Math.round(data.five_hour.utilization || 0);
    if (data.five_hour.resets_at) {
      result.fiveHourReset = data.five_hour.resets_at;
    }
  }

  // Weekly limit
  if (data.seven_day) {
    result.weeklyPercent = Math.round(data.seven_day.utilization || 0);
    if (data.seven_day.resets_at) {
      result.weeklyReset = data.seven_day.resets_at;
    }
  }

  // Per-model weekly
  if (data.seven_day_opus) {
    result.opusWeeklyPercent = Math.round(data.seven_day_opus.utilization || 0);
  }
  if (data.seven_day_sonnet) {
    result.sonnetWeeklyPercent = Math.round(data.seven_day_sonnet.utilization || 0);
  }

  return result;
}

function getOAuthToken() {
  // Try macOS Keychain first
  try {
    const result = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();
    if (result) {
      const creds = JSON.parse(result);
      // Look for claude.ai or anthropic OAuth credential
      for (const [, val] of Object.entries(creds)) {
        if (val?.accessToken) return val.accessToken;
      }
    }
  } catch {}

  // Fallback: ~/.claude/.credentials.json
  try {
    const credPath = join(homedir(), '.claude', '.credentials.json');
    if (existsSync(credPath)) {
      const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
      for (const [, val] of Object.entries(creds)) {
        if (val?.accessToken) return val.accessToken;
      }
    }
  } catch {}

  return null;
}

async function refreshToken() {
  try {
    // Read refresh token from keychain or credentials file
    let refreshTokenStr = null;

    try {
      const result = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf-8', timeout: 3000 }
      ).trim();
      if (result) {
        const creds = JSON.parse(result);
        for (const [, val] of Object.entries(creds)) {
          if (val?.refreshToken) { refreshTokenStr = val.refreshToken; break; }
        }
      }
    } catch {}

    if (!refreshTokenStr) return null;

    const response = await fetch('https://platform.claude.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshTokenStr,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      return data.access_token || null;
    }
  } catch {}

  return null;
}

function saveCache(data, success) {
  cachedUsage = data;
  cacheTimestamp = Date.now();
  cacheSuccess = success;
  if (data) lastGoodData = data;

  // Read previous failCount for exponential backoff
  let failCount = 0;
  if (!success) {
    try {
      if (existsSync(CACHE_FILE)) {
        const prev = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
        failCount = (prev.failCount || 0) + 1;
      }
    } catch {}
  }

  try {
    const dir = join(homedir(), '.claude', '.sc');
    mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({
      data,
      timestamp: cacheTimestamp,
      success,
      failCount: success ? 0 : failCount,
      lastGood: lastGoodData ?? data,
    }), 'utf-8');
  } catch {}
}

// Format time remaining from reset timestamp
export function formatTimeRemaining(resetAt) {
  if (!resetAt) return '';
  const remaining = new Date(resetAt).getTime() - Date.now();
  if (remaining <= 0) return '0m';

  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);

  if (hours > 0) return `${hours}h${minutes > 0 ? minutes + 'm' : ''}`;
  return `${minutes}m`;
}
