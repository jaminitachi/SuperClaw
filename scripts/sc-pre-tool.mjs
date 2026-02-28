#!/usr/bin/env node
/**
 * PreToolUse hook — injects SuperClaw-specific reminders before tool calls.
 */
import { readStdin } from './lib/stdin.mjs';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { todosPath, allowlistPath } from './lib/session.mjs';

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
      const sessionId = input?.session_id ?? 'default';
      const sourceExts = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|hpp|svelte|vue|css|scss|less|sass|kt|kts|gradle|swift|rb|php|lua|zig|nim|dart|ex|exs|elm|clj|cljs|scala|sh|bash|zsh|fish|sql|graphql|gql|proto|tf|hcl|yaml|yml|toml|json|xml)$/;
      // Ultrawork mode: require TODO for ALL file writes
      let ultraworkActive = false;
      try {
        const uwPath = join(homedir(), 'superclaw', 'data', 'ultrawork-state.json');
        if (existsSync(uwPath)) {
          ultraworkActive = JSON.parse(readFileSync(uwPath, 'utf-8')).active === true;
        }
      } catch {}
      if (ultraworkActive && !existsSync(todosPath(sessionId))) {
        return { block: true, message: 'BLOCKED — ULTRAWORK: TaskCreate로 TODO를 먼저 만드세요. Ultrawork 모드에서는 모든 파일 수정에 계획이 필요합니다.' };
      }
      if (sourceExts.test(filePath)) {
        if (!existsSync(todosPath(sessionId))) {
          return { block: true, message: 'BLOCKED — RULE 1: TaskCreate로 TODO를 먼저 만드세요. 계획 없이 코드 수정 금지.' };
        }
        const alPath = allowlistPath(sessionId);
        if (existsSync(alPath)) {
          try {
            const allowed = JSON.parse(readFileSync(alPath, 'utf-8'));
            if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(filePath)) {
              return `⚠️ SCOPE WARNING: ${filePath} is not declared in any TODO. Consider adding it to your task plan.`;
            }
          } catch {}
        }
      }
      return null;
    },
    'Edit': (input) => {
      const filePath = input?.tool_input?.file_path || '';
      const sessionId = input?.session_id ?? 'default';
      const sourceExts = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|hpp|svelte|vue|css|scss|less|sass|kt|kts|gradle|swift|rb|php|lua|zig|nim|dart|ex|exs|elm|clj|cljs|scala|sh|bash|zsh|fish|sql|graphql|gql|proto|tf|hcl|yaml|yml|toml|json|xml)$/;
      // Ultrawork mode: require TODO for ALL file writes
      let ultraworkActive = false;
      try {
        const uwPath = join(homedir(), 'superclaw', 'data', 'ultrawork-state.json');
        if (existsSync(uwPath)) {
          ultraworkActive = JSON.parse(readFileSync(uwPath, 'utf-8')).active === true;
        }
      } catch {}
      if (ultraworkActive && !existsSync(todosPath(sessionId))) {
        return { block: true, message: 'BLOCKED — ULTRAWORK: TaskCreate로 TODO를 먼저 만드세요. Ultrawork 모드에서는 모든 파일 수정에 계획이 필요합니다.' };
      }
      if (sourceExts.test(filePath)) {
        if (!existsSync(todosPath(sessionId))) {
          return { block: true, message: 'BLOCKED — RULE 1: TaskCreate로 TODO를 먼저 만드세요. 계획 없이 코드 수정 금지.' };
        }
        const alPath = allowlistPath(sessionId);
        if (existsSync(alPath)) {
          try {
            const allowed = JSON.parse(readFileSync(alPath, 'utf-8'));
            if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(filePath)) {
              return `⚠️ SCOPE WARNING: ${filePath} is not declared in any TODO. Consider adding it to your task plan.`;
            }
          } catch {}
        }
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

  // Handle blocking responses (RULE 1)
  if (typeof reminder === 'object' && reminder.block) {
    console.log(JSON.stringify({
      continue: false,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `SuperClaw: ${reminder.message}`,
      },
    }));
    return;
  }

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
