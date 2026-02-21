import { cyan } from '../colors.mjs';

export function renderCallCounts(toolCount, agentCount, skillCount) {
  const parts = [];

  if (toolCount > 0) parts.push(`🔧${cyan(String(toolCount))}`);
  if (agentCount > 0) parts.push(`🤖${cyan(String(agentCount))}`);
  if (skillCount > 0) parts.push(`⚡${cyan(String(skillCount))}`);

  return parts.length > 0 ? parts.join(' ') : null;
}
