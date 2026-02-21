import { modelColor, RESET } from '../colors.mjs';

export function renderModel(modelName, format = 'short') {
  if (!modelName) return null;

  let display;
  const m = modelName.toLowerCase();

  switch (format) {
    case 'full':
      display = modelName;
      break;
    case 'versioned':
      if (m.includes('opus')) display = 'Opus 4.6';
      else if (m.includes('sonnet')) display = 'Sonnet 4.6';
      else if (m.includes('haiku')) display = 'Haiku 4.5';
      else display = modelName;
      break;
    case 'short':
    default:
      if (m.includes('opus')) display = 'Opus';
      else if (m.includes('sonnet')) display = 'Sonnet';
      else if (m.includes('haiku')) display = 'Haiku';
      else display = modelName;
      break;
  }

  return `${modelColor(modelName)}${display}${RESET}`;
}
