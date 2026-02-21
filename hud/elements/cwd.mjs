import { dim } from '../colors.mjs';
import { homedir } from 'os';

export function renderCwd(cwd, format = 'relative') {
  if (!cwd) return null;

  const home = homedir();
  let display;

  switch (format) {
    case 'folder':
      display = cwd.split('/').pop() || cwd;
      break;
    case 'absolute':
      display = cwd;
      break;
    case 'relative':
    default:
      display = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
      break;
  }

  return dim(display);
}
