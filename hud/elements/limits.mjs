import { healthColor, dim, RESET } from '../colors.mjs';

export function renderRateLimits(usage) {
  if (!usage) return null;

  const parts = [];

  if (usage.fiveHourPercent != null) {
    const color = healthColor(usage.fiveHourPercent, 60, 85);
    let text = `5h:${color}${usage.fiveHourPercent}%${RESET}`;
    if (usage.fiveHourReset) {
      text += dim(`(${formatTimeRemaining(usage.fiveHourReset)})`);
    }
    parts.push(text);
  }

  if (usage.weeklyPercent != null) {
    const color = healthColor(usage.weeklyPercent, 60, 85);
    let text = `wk:${color}${usage.weeklyPercent}%${RESET}`;
    if (usage.weeklyReset) {
      text += dim(`(${formatTimeRemaining(usage.weeklyReset)})`);
    }
    parts.push(text);
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function formatTimeRemaining(resetAt) {
  const remaining = new Date(resetAt).getTime() - Date.now();
  if (remaining <= 0) return '0m';

  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);

  if (days > 0) return `${days}d${hours > 0 ? hours + 'h' : ''}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? minutes + 'm' : ''}`;
  return `${minutes}m`;
}
