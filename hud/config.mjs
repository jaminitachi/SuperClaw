import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEFAULT_CONFIG = {
  preset: 'focused',
  maxOutputLines: 4,
  safeMode: true,
  staleTaskThresholdMinutes: 30,
  thresholds: {
    contextWarning: 70,
    contextCritical: 85,
    budgetWarning: 2.0,
    budgetCritical: 5.0,
  },
  elements: {
    cwd: true,
    cwdFormat: 'relative',
    gitRepo: true,
    gitBranch: true,
    model: true,
    modelFormat: 'short',
    scLabel: true,
    rateLimits: true,
    contextBar: true,
    useBars: true,
    agents: true,
    agentsFormat: 'multiline',
    agentsMaxLines: 3,
    backgroundTasks: true,
    todos: true,
    permissionStatus: true,
    thinking: true,
    thinkingFormat: 'bubble',
    sessionHealth: true,
    showSessionDuration: true,
    showHealthIndicator: true,
    showTokens: true,
    showCost: true,
    showCache: true,
    showCostPerHour: false,
    showBudgetWarning: true,
    showCallCounts: true,
    activeSkills: true,
  },
};

const PRESETS = {
  minimal: {
    maxOutputLines: 2,
    elements: {
      cwd: false,
      gitRepo: false,
      gitBranch: false,
      useBars: false,
      agents: true,
      agentsFormat: 'count',
      agentsMaxLines: 0,
      backgroundTasks: false,
      todos: false,
      showCallCounts: false,
      showCache: false,
      showCostPerHour: false,
      showBudgetWarning: false,
      activeSkills: false,
    },
  },
  focused: {
    // Uses defaults (already the default preset)
  },
  full: {
    maxOutputLines: 12,
    elements: {
      agentsMaxLines: 10,
      showCostPerHour: true,
    },
  },
  dense: {
    maxOutputLines: 6,
    elements: {
      agentsMaxLines: 5,
      showCostPerHour: true,
    },
  },
};

export function loadConfig() {
  const config = structuredClone(DEFAULT_CONFIG);

  // Try loading from ~/.claude/settings.json -> scHud key
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const userConfig = settings.scHud || settings.omcHud;
      if (userConfig) {
        return mergeConfig(config, userConfig);
      }
    }
  } catch {}

  // Try loading from ~/.claude/.sc/hud-config.json
  try {
    const hudConfigPath = join(homedir(), '.claude', '.sc', 'hud-config.json');
    if (existsSync(hudConfigPath)) {
      const userConfig = JSON.parse(readFileSync(hudConfigPath, 'utf-8'));
      return mergeConfig(config, userConfig);
    }
  } catch {}

  return config;
}

function mergeConfig(base, override) {
  const result = structuredClone(base);

  // Apply preset first
  if (override.preset && PRESETS[override.preset]) {
    const presetOverrides = PRESETS[override.preset];
    Object.assign(result, { ...presetOverrides, elements: { ...result.elements, ...presetOverrides.elements } });
    result.preset = override.preset;
  }

  // Apply user overrides on top
  if (override.maxOutputLines != null) result.maxOutputLines = override.maxOutputLines;
  if (override.safeMode != null) result.safeMode = override.safeMode;
  if (override.staleTaskThresholdMinutes != null) result.staleTaskThresholdMinutes = override.staleTaskThresholdMinutes;
  if (override.thresholds) Object.assign(result.thresholds, override.thresholds);
  if (override.elements) Object.assign(result.elements, override.elements);

  return result;
}
