import { cyan } from '../colors.mjs';

export function renderThinking(isThinking, format = 'bubble') {
  if (!isThinking) return null;

  switch (format) {
    case 'brain': return '🧠';
    case 'face': return '🤔';
    case 'text': return cyan('thinking');
    case 'bubble':
    default: return '💭';
  }
}
