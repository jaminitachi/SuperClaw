// Pricing per 1M tokens (as of 2026-02)
const PRICING = {
  'opus': { input: 15.0, cacheCreation: 18.75, cacheRead: 1.5, output: 75.0 },
  'sonnet': { input: 3.0, cacheCreation: 3.75, cacheRead: 0.3, output: 15.0 },
  'haiku': { input: 0.80, cacheCreation: 1.0, cacheRead: 0.08, output: 4.0 },
};

function getModelTier(modelName) {
  if (!modelName) return 'sonnet';
  const m = modelName.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('haiku')) return 'haiku';
  return 'sonnet';
}

export function calculateCost(modelName, tokens) {
  const tier = getModelTier(modelName);
  const prices = PRICING[tier];

  const inputCost = (tokens.input / 1_000_000) * prices.input;
  const cacheCreationCost = (tokens.cacheCreation / 1_000_000) * prices.cacheCreation;
  const cacheReadCost = (tokens.cacheRead / 1_000_000) * prices.cacheRead;

  // Estimate output tokens as ~15% of input (heuristic)
  const estimatedOutput = tokens.total * 0.15;
  const outputCost = (estimatedOutput / 1_000_000) * prices.output;

  return inputCost + cacheCreationCost + cacheReadCost + outputCost;
}

export function formatCost(cost) {
  if (cost < 0.01) return '$0.00';
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}

export function getCacheHitRate(tokens) {
  if (tokens.total === 0) return 0;
  return (tokens.cacheRead / tokens.total) * 100;
}

export function formatTokenCount(count) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}
