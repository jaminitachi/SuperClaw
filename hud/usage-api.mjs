import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CACHE_TTL_SUCCESS = 30_000;  // 30s
const CACHE_TTL_FAILURE = 15_000;  // 15s

let cachedUsage = null;
let cacheTimestamp = 0;
let cacheSuccess = false;

const CACHE_FILE = join(homedir(), '.claude', '.sc', '.usage-cache.json');

export async function getUsage() {
  // Check in-memory cache
  const now = Date.now();
  const ttl = cacheSuccess ? CACHE_TTL_SUCCESS : CACHE_TTL_FAILURE;
  if (cachedUsage && (now - cacheTimestamp) < ttl) {
    return cachedUsage;
  }

  // Check file cache
  try {
    if (existsSync(CACHE_FILE)) {
      const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
      const fileTtl = cached.success ? CACHE_TTL_SUCCESS : CACHE_TTL_FAILURE;
      if ((now - cached.timestamp) < fileTtl) {
        cachedUsage = cached.data;
        cacheTimestamp = cached.timestamp;
        cacheSuccess = cached.success;
        return cachedUsage;
      }
    }
  } catch {}

  // Fetch from API
  try {
    const token = getOAuthToken();
    if (!token) return null;

    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // Try token refresh if 401
      if (response.status === 401) {
        const newToken = await refreshToken();
        if (newToken) {
          const retryResponse = await fetch('https://api.anthropic.com/api/oauth/usage', {
            headers: { 'Authorization': `Bearer ${newToken}` },
            signal: AbortSignal.timeout(5000),
          });
          if (retryResponse.ok) {
            const data = await retryResponse.json();
            const usage = parseUsageResponse(data);
            saveCache(usage, true);
            return usage;
          }
        }
      }
      saveCache(null, false);
      return null;
    }

    const data = await response.json();
    const usage = parseUsageResponse(data);
    saveCache(usage, true);
    return usage;
  } catch {
    saveCache(null, false);
    return null;
  }
}

function parseUsageResponse(data) {
  const result = {};

  // 5-hour rolling limit
  if (data.five_hour) {
    result.fiveHourPercent = Math.round((data.five_hour.utilization || 0) * 100);
    if (data.five_hour.reset_at) {
      result.fiveHourReset = data.five_hour.reset_at;
    }
  }

  // Weekly limit
  if (data.seven_day) {
    result.weeklyPercent = Math.round((data.seven_day.utilization || 0) * 100);
    if (data.seven_day.reset_at) {
      result.weeklyReset = data.seven_day.reset_at;
    }
  }

  // Per-model weekly
  if (data.seven_day_opus) {
    result.opusWeeklyPercent = Math.round((data.seven_day_opus.utilization || 0) * 100);
  }
  if (data.seven_day_sonnet) {
    result.sonnetWeeklyPercent = Math.round((data.seven_day_sonnet.utilization || 0) * 100);
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

  try {
    const dir = join(homedir(), '.claude', '.sc');
    mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ data, timestamp: cacheTimestamp, success }), 'utf-8');
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
