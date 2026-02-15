#!/usr/bin/env node
/**
 * UserPromptSubmit hook — detects SuperClaw keywords and suggests skill invocations.
 */
import { readStdin } from './lib/stdin.mjs';

const SC_KEYWORDS = [
  { pattern: /\b(screenshot|capture screen|take a picture)\b/i, skill: 'superclaw:mac-control', action: 'screenshot' },
  { pattern: /\b(send to phone|telegram|notify me|text me)\b/i, skill: 'superclaw:telegram-control', action: 'send' },
  { pattern: /\b(heartbeat|system health|check status|what's running)\b/i, skill: 'superclaw:heartbeat', action: 'check' },
  { pattern: /\b(remember this|save this|store knowledge)\b/i, skill: 'superclaw:memory-mgr', action: 'store' },
  { pattern: /\b(search memory|recall|what did we)\b/i, skill: 'superclaw:memory-mgr', action: 'search' },
  { pattern: /\b(schedule|every morning|cron|recurring)\b/i, skill: 'superclaw:cron-mgr', action: 'schedule' },
  { pattern: /\b(pipeline|automate|morning brief)\b/i, skill: 'superclaw:automation-pipeline', action: 'build' },
  { pattern: /\b(read paper|summarize paper|arxiv)\b/i, skill: 'superclaw:paper-review', action: 'read' },
  { pattern: /\b(log experiment|record results|experiment)\b/i, skill: 'superclaw:experiment-log', action: 'log' },
  { pattern: /\b(literature review|related work|survey)\b/i, skill: 'superclaw:lit-review', action: 'review' },
  { pattern: /\b(analyze data|correlate|statistics)\b/i, skill: 'superclaw:research-analysis', action: 'analyze' },
  { pattern: /\b(check PRs|CI status|developer report)\b/i, skill: 'superclaw:dev-workflow', action: 'report' },
  { pattern: /\b(setup superclaw|install superclaw)\b/i, skill: 'superclaw:setup', action: 'setup' },
  { pattern: /\b(create skill|skill forge|make a skill)\b/i, skill: 'superclaw:skill-forge', action: 'forge' },
  { pattern: /\b(click on|open app|type into|window)\b/i, skill: 'superclaw:mac-control', action: 'control' },
  // Developer workflow keywords
  { pattern: /\b(architect|아키텍처|구조\s*설계|시스템\s*설계)\b/i, skill: 'superclaw:sc-architect', action: 'design' },
  { pattern: /\b(frontend|프론트엔드|UI|컴포넌트|대시보드)\b/i, skill: 'superclaw:sc-frontend', action: 'implement' },
  { pattern: /\b(code\s*review|코드\s*리뷰|리뷰해|review\s*this)\b/i, skill: 'superclaw:sc-code-reviewer', action: 'review' },
  { pattern: /\b(security|보안|취약점|vulnerability|OWASP)\b/i, skill: 'superclaw:sc-security-reviewer', action: 'scan' },
  { pattern: /\b(debug|디버그|디버깅|버그|에러\s*분석)\b/i, skill: 'superclaw:sc-debugger', action: 'debug' },
  { pattern: /\b(test|테스트|TDD|커버리지|coverage)\b/i, skill: 'superclaw:sc-test-engineer', action: 'test' },
  { pattern: /\b(performance|성능|벤치마크|bottleneck|병목)\b/i, skill: 'superclaw:sc-performance', action: 'analyze' },
  // Ultrawork / Ralph Loop
  { pattern: /\b(ulw|ultrawork|완료될\s*때까지|끝날\s*때까지|다\s*해줘)\b/i, skill: 'superclaw:ultrawork', action: 'execute' },
];

async function main() {
  const raw = await readStdin(3000);
  if (!raw.trim()) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  let input;
  try { input = JSON.parse(raw); } catch { console.log(JSON.stringify({ continue: true })); return; }

  const prompt = input?.message ?? input?.content ?? '';
  if (!prompt) { console.log(JSON.stringify({ continue: true })); return; }

  // Strip code blocks and URLs to avoid false positives
  const cleaned = prompt
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, '');

  const matches = [];
  for (const kw of SC_KEYWORDS) {
    if (kw.pattern.test(cleaned)) {
      matches.push(kw);
    }
  }

  if (matches.length === 0) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Build context message with stronger directive
  const skills = [...new Set(matches.map(m => m.skill))];
  const context = `[SUPERCLAW KEYWORD DETECTED] User prompt matched SuperClaw keyword pattern. MUST invoke skill: ${skills.join(', ')}`;

  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
