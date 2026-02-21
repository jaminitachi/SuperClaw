import { yellow, bold } from '../colors.mjs';

export function renderPermission(pending) {
  if (!pending) return null;

  const name = pending.name.replace('proxy_', '');
  let target = '';

  if (pending.input?.file_path) {
    target = pending.input.file_path.split('/').pop();
  } else if (pending.input?.command) {
    target = pending.input.command.slice(0, 30);
  }

  return bold(yellow(`APPROVE? ${name.toLowerCase()}${target ? ':' + target : ''}`));
}
