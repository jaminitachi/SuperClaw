import { dim } from '../colors.mjs';

export function renderSession(sessionStart) {
  if (!sessionStart) return null;

  const start = new Date(sessionStart).getTime();
  const elapsed = Date.now() - start;

  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;

  let display;
  if (hours > 0) {
    display = remainMinutes > 0 ? `${hours}h${remainMinutes}m` : `${hours}h`;
  } else {
    display = `${minutes}m`;
  }

  return `session:${dim(display)}`;
}
