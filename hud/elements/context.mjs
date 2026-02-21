import { healthColor, RESET, DIM } from '../colors.mjs';

export function renderContext(percent, config) {
  if (percent == null) return null;

  const rounded = Math.round(percent);
  const color = healthColor(rounded, config.thresholds?.contextWarning || 70, config.thresholds?.contextCritical || 85);

  if (config.elements?.useBars) {
    return renderContextWithBar(rounded, color);
  }

  return `ctx:${color}${rounded}%${RESET}`;
}

function renderContextWithBar(percent, color) {
  const barWidth = 10;
  const filled = Math.round((percent / 100) * barWidth);
  const empty = barWidth - filled;

  const bar = `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
  return `ctx:[${bar}]${color}${percent}%${RESET}`;
}
