import { magenta, brightMagenta } from '../colors.mjs';

export function renderSkills(lastSkill) {
  if (!lastSkill) return null;

  // Special styling for known skills
  if (lastSkill === 'ultrawork') return brightMagenta('ultrawork');

  return `skill:${magenta(lastSkill)}`;
}
