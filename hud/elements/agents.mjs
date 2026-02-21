import { dim, RESET, DIM, MAGENTA, YELLOW, GREEN, CYAN } from '../colors.mjs';

// SuperClaw agent type code table
const AGENT_CODES = {
  // Orchestration
  'sc-atlas': 'AT',
  'sc-prometheus': 'PR',
  'sc-metis': 'ME',
  'sc-momus': 'MO',
  'sc-junior': 'jr',

  // Code
  'sc-architect': 'A',
  'sc-architect-low': 'a',
  'sc-frontend': 'F',

  // Review
  'sc-code-reviewer': 'CR',
  'sc-code-reviewer-low': 'cr',
  'sc-security-reviewer': 'SR',
  'sc-security-reviewer-low': 'sr',
  'sc-performance': 'PF',
  'sc-performance-high': 'PF',

  // Debug
  'sc-debugger': 'D',
  'sc-debugger-high': 'D!',
  'gateway-debugger': 'GD',

  // Test
  'sc-test-engineer': 'TE',
  'sc-verifier': 'V',

  // Memory
  'memory-curator': 'MC',
  'memory-curator-low': 'mc',
  'memory-curator-high': 'MC',

  // Research
  'paper-reader': 'PR',
  'literature-reviewer': 'LR',
  'experiment-tracker': 'ET',
  'data-analyst': 'DA',
  'research-assistant': 'RA',
  'research-code-reviewer': 'RC',

  // Infrastructure
  'mac-control': 'M',
  'mac-control-low': 'm',
  'system-monitor': 'SM',
  'system-monitor-high': 'SM',
  'heartbeat-mgr': 'HB',
  'cron-mgr': 'CJ',
  'pipeline-builder': 'PL',
  'pipeline-builder-high': 'PL',
  'skill-forger': 'SF',
  'workflow-monitor': 'WM',
  'setup-validator': 'SV',

  // Generic
  'Bash': 'B',
  'Explore': 'E',
  'Plan': 'P',
  'general-purpose': 'GP',
};

function getAgentCode(name) {
  return AGENT_CODES[name] || name.slice(0, 2);
}

function getAgentModelColor(model) {
  if (!model) return CYAN;
  const m = model.toLowerCase();
  if (m.includes('opus')) return MAGENTA;
  if (m.includes('sonnet')) return YELLOW;
  if (m.includes('haiku')) return GREEN;
  return CYAN;
}

function formatDuration(startTime) {
  const elapsed = Date.now() - startTime;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function renderAgents(agents, format = 'multiline', maxLines = 3) {
  if (!agents || agents.size === 0) return { header: null, details: [] };

  const running = [];
  const completed = [];

  for (const agent of agents.values()) {
    if (agent.completed) completed.push(agent);
    else running.push(agent);
  }

  // Sort running by start time (newest first)
  running.sort((a, b) => b.startTime - a.startTime);

  switch (format) {
    case 'count':
      return {
        header: running.length > 0 ? `agents:${CYAN}${running.length}${RESET}` : null,
        details: [],
      };

    case 'codes': {
      if (running.length === 0) return { header: null, details: [] };
      const codes = running.map(a => {
        const color = getAgentModelColor(a.model);
        const code = getAgentCode(a.name);
        return `${color}${code}${RESET}`;
      }).join('');
      return { header: `agents:${codes}`, details: [] };
    }

    case 'multiline': {
      const header = running.length > 0
        ? `agents:${CYAN}${running.length}${RESET}${dim(`/${agents.size}`)}`
        : null;

      const details = [];
      const agentsToShow = running.slice(0, maxLines);

      for (let i = 0; i < agentsToShow.length; i++) {
        const a = agentsToShow[i];
        const isLast = i === agentsToShow.length - 1 && i === running.length - 1;
        const prefix = isLast ? '└─' : '├─';
        const color = getAgentModelColor(a.model);
        const code = getAgentCode(a.name);
        const duration = formatDuration(a.startTime);
        const desc = a.description ? ` ${a.description}` : '';
        const truncDesc = desc.length > 50 ? desc.slice(0, 47) + '...' : desc;

        details.push(`${DIM}${prefix}${RESET} ${color}${code}${RESET} ${dim(a.name.padEnd(16))} ${dim(duration.padStart(4))}  ${dim(truncDesc)}`);
      }

      if (running.length > maxLines) {
        details.push(`${DIM}└─ ... +${running.length - maxLines} more${RESET}`);
      }

      return { header, details };
    }

    default:
      return { header: null, details: [] };
  }
}
