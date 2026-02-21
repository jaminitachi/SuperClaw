// Read all stdin data
export async function readStdin() {
  if (process.stdin.isTTY) return null;

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Extract context usage percentage
export function getContextPercent(stdin) {
  if (!stdin?.context_window) return 0;

  // Prefer native percentage (Claude Code v2.1.6+)
  if (stdin.context_window.used_percentage != null) {
    return stdin.context_window.used_percentage;
  }

  // Manual calculation fallback
  const usage = stdin.context_window.current_usage;
  if (!usage || !stdin.context_window.context_window_size) return 0;

  const totalTokens = (usage.input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);

  return (totalTokens / stdin.context_window.context_window_size) * 100;
}

// Extract model name
export function getModelName(stdin) {
  if (!stdin?.model) return 'unknown';
  return stdin.model.id || stdin.model.display_name || 'unknown';
}

// Get short model name (Opus, Sonnet, Haiku)
export function getModelShort(stdin) {
  const name = getModelName(stdin);
  if (name.includes('opus')) return 'Opus';
  if (name.includes('sonnet')) return 'Sonnet';
  if (name.includes('haiku')) return 'Haiku';
  return name;
}

// Get token counts from stdin
export function getTokens(stdin) {
  const usage = stdin?.context_window?.current_usage;
  if (!usage) return { input: 0, cacheCreation: 0, cacheRead: 0, total: 0 };

  const input = usage.input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;

  return {
    input,
    cacheCreation,
    cacheRead,
    total: input + cacheCreation + cacheRead,
  };
}
