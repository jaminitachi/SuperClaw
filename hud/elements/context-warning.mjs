import { red, bold, yellow } from '../colors.mjs';

export function renderContextWarning(percent, config) {
  const threshold = config.contextLimitWarning?.threshold || config.thresholds?.contextWarning || 80;
  const critical = config.thresholds?.contextCritical || 85;

  if (percent < threshold) return null;

  if (percent >= critical) {
    return bold(red(`[!] ctx ${Math.round(percent)}% >= ${critical}% - run /compact NOW`));
  }

  return yellow(`[!] ctx ${Math.round(percent)}% >= ${threshold}% threshold - run /compact`);
}
