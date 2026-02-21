// ANSI codes
export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const RED = '\x1b[31m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const BLUE = '\x1b[34m';
export const MAGENTA = '\x1b[35m';
export const CYAN = '\x1b[36m';
export const BRIGHT_MAGENTA = '\x1b[95m';

export function dim(text) { return `${DIM}${text}${RESET}`; }
export function bold(text) { return `${BOLD}${text}${RESET}`; }
export function red(text) { return `${RED}${text}${RESET}`; }
export function green(text) { return `${GREEN}${text}${RESET}`; }
export function yellow(text) { return `${YELLOW}${text}${RESET}`; }
export function cyan(text) { return `${CYAN}${text}${RESET}`; }
export function magenta(text) { return `${MAGENTA}${text}${RESET}`; }
export function brightMagenta(text) { return `${BRIGHT_MAGENTA}${text}${RESET}`; }

// Model tier color: opus=magenta, sonnet=yellow, haiku=green
export function modelColor(model) {
  if (!model) return '';
  const m = model.toLowerCase();
  if (m.includes('opus')) return MAGENTA;
  if (m.includes('sonnet')) return YELLOW;
  if (m.includes('haiku')) return GREEN;
  return CYAN;
}

// Health color: good=green, warning=yellow, critical=red
export function healthColor(value, warningThreshold, criticalThreshold) {
  if (value >= criticalThreshold) return RED;
  if (value >= warningThreshold) return YELLOW;
  return GREEN;
}

// Cost color
export function costColor(cost) {
  if (cost >= 5) return RED;
  if (cost >= 2) return YELLOW;
  return GREEN;
}
