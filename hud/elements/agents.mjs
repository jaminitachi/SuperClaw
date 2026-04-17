import { dim, RESET, DIM, MAGENTA, YELLOW, GREEN, CYAN } from '../colors.mjs';

// SuperClaw v4 agent type code table
const AGENT_CODES = {
  // Dev Team
  'dev-architect': 'A',
  'dev-backend': 'BE',
  'dev-frontend': 'FE',
  'dev-qa': 'QA',

  // Research Team
  'research-reviewer': 'RR',
  'research-writer': 'RW',
  'research-assistant': 'RA',

  // Infra Team
  'infra-monitor': 'IM',
  'infra-mac': 'MC',

  // Verify
  'verify': 'VF',

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
