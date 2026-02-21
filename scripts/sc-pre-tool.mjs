#!/usr/bin/env node
/**
 * PreToolUse hook — injects SuperClaw-specific reminders before tool calls.
 */
import { readStdin } from './lib/stdin.mjs';

async function main() {
  const raw = await readStdin(2000);
  if (!raw.trim()) { console.log(JSON.stringify({ continue: true })); return; }

  let input;
  try { input = JSON.parse(raw); } catch { console.log(JSON.stringify({ continue: true })); return; }

  const toolName = input?.tool_name ?? input?.toolName ?? '';

  const reminders = {
    'Task': (input) => {
      const model = input?.tool_input?.model;
      const prompt = input?.tool_input?.description || input?.tool_input?.prompt || '';
      const agentType = input?.tool_input?.subagent_type ?? 'unknown';

      let message = `Spawning agent: ${agentType} (${model ?? 'inherit'}) | Task: ${prompt.substring(0, 80)}`;

      // Model suggestion if not specified
      if (!model) {
        const complexKeywords = /\b(debug|architecture|security|race condition|refactor|complex)\b/i;
        const simpleKeywords = /\b(find|list|check|status|lookup)\b/i;
        let suggestion = 'sonnet';
        if (complexKeywords.test(prompt)) suggestion = 'opus';
        else if (simpleKeywords.test(prompt)) suggestion = 'haiku';
        message += `\n⚠️ Model parameter not specified. Based on task complexity, consider using model="${suggestion}". Smart Model Routing: haiku (simple lookup), sonnet (standard work), opus (complex reasoning).`;
      }

      return message;
    },
    'Write': (input) => {
      const filePath = input?.tool_input?.file_path || '';
      const sourceExts = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|c|cpp|h|svelte|vue)$/;
      if (sourceExts.test(filePath)) {
        return `⚠️ Source file modification detected: ${filePath}. Delegate source code changes to executor agent (superclaw:sc-atlas). Direct source file modification should be avoided per Delegation-First Philosophy.`;
      }
      return null;
    },
    'Edit': (input) => {
      const filePath = input?.tool_input?.file_path || '';
      const sourceExts = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|c|cpp|h|svelte|vue)$/;
      if (sourceExts.test(filePath)) {
        return `⚠️ Source file modification detected: ${filePath}. Delegate source code changes to executor agent. Direct source file modification should be avoided per Delegation-First Philosophy.`;
      }
      return null;
    },
    'sc_screenshot': () => 'After screenshot, use Read to view the image for analysis.',
    'sc_click': () => 'Always use sc_see before sc_click to verify UI element positions.',
    'sc_memory_store': () => 'Check sc_memory_search first to avoid duplicates.',
    'sc_send_message': () => 'Verify gateway is connected (sc_telegram_status) before sending.',
    'sc_cron_add': () => 'Validate cron expression before adding. List existing jobs to avoid duplicates.',
  };

  const reminderFn = reminders[toolName];
  if (!reminderFn) { console.log(JSON.stringify({ continue: true })); return; }

  const reminder = typeof reminderFn === 'function' ? reminderFn(input) : reminderFn;
  if (!reminder) { console.log(JSON.stringify({ continue: true })); return; }

  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `SuperClaw: ${reminder}`,
    },
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
