import { cyan, dim as dimColor } from '../colors.mjs';

export function renderBackground(total, done) {
  if (total === 0) return null;
  return `bg:${cyan(String(done))}/${dimColor(String(total))}`;
}
