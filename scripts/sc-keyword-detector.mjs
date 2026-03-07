#!/usr/bin/env node
/**
 * UserPromptSubmit hook — detects SuperClaw keywords, suggests skill invocations,
 * and proposes team compositions for complex requests.
 *
 * Inspired by: Ruflo (task complexity routing), Claude-Mem (progressive context),
 * OMC (magic keywords + auto skill injection).
 */
import { readStdin } from './lib/stdin.mjs';

// --- Single-skill keyword patterns ---
// NOTE: Korean characters don't work with \b (word boundary). Use raw patterns for Korean.
const SC_KEYWORDS = [
  { pattern: /(?:\b(?:screenshot|capture screen|take a picture)|스크린샷)/i, skill: 'superclaw:mac-control', action: 'screenshot' },
  { pattern: /(?:\b(?:send to phone|telegram|notify me|text me)|텔레그램)/i, skill: 'superclaw:telegram-control', action: 'send' },
  { pattern: /(?:\b(?:heartbeat|system health|check status|what's running)|상태\s*확인)/i, skill: 'superclaw:heartbeat', action: 'check' },
  { pattern: /(?:\b(?:remember this|save this|store knowledge)|기억해|저장해)/i, skill: 'superclaw:memory-mgr', action: 'store' },
  { pattern: /(?:\b(?:search memory|recall|what did we)|기억|뭐였더라)/i, skill: 'superclaw:memory-mgr', action: 'search' },
  { pattern: /(?:\b(?:schedule|every morning|cron|recurring)|스케줄|매일)/i, skill: 'superclaw:cron-mgr', action: 'schedule' },
  { pattern: /(?:\b(?:pipeline|automate|morning brief)|자동화)/i, skill: 'superclaw:automation-pipeline', action: 'build' },
  { pattern: /(?:\b(?:read paper|summarize paper|arxiv)|논문)/i, skill: 'superclaw:paper-review', action: 'read' },
  { pattern: /(?:\b(?:log experiment|record results|experiment)|실험)/i, skill: 'superclaw:experiment-log', action: 'log' },
  { pattern: /(?:\b(?:literature review|related work|survey)|문헌\s*조사)/i, skill: 'superclaw:lit-review', action: 'review' },
  { pattern: /(?:\b(?:analyze data|correlate|statistics)|통계|데이터\s*분석)/i, skill: 'superclaw:research-analysis', action: 'analyze' },
  { pattern: /(?:\b(?:check PRs|CI status|developer report)|PR\s*확인)/i, skill: 'superclaw:dev-workflow', action: 'report' },
  { pattern: /\b(setup superclaw|install superclaw)\b/i, skill: 'superclaw:setup', action: 'setup' },
  { pattern: /^(setup|설정|초기\s*설정|configure|get\s*started|getting\s*started)$/i, skill: 'superclaw:setup', action: 'setup' },
  { pattern: /(?:\b(?:create skill|skill forge|make a skill)|스킬\s*만들)/i, skill: 'superclaw:skill-forge', action: 'forge' },
  { pattern: /(?:\b(?:click on|open app|type into|window)|앱\s*열어)/i, skill: 'superclaw:mac-control', action: 'control' },
  // Developer workflow keywords
  { pattern: /(?:\b(?:architect)|아키텍처|구조\s*설계|시스템\s*설계)/i, skill: 'superclaw:sc-architect', action: 'design' },
  { pattern: /(?:\b(?:frontend|UI)|프론트엔드|컴포넌트|대시보드)/i, skill: 'superclaw:sc-frontend', action: 'implement' },
  { pattern: /(?:\b(?:code\s*review|review\s*this)|코드\s*리뷰|리뷰해)/i, skill: 'superclaw:sc-code-reviewer', action: 'review' },
  { pattern: /(?:\b(?:security|vulnerability|OWASP)|보안|취약점)/i, skill: 'superclaw:sc-security-reviewer', action: 'scan' },
  { pattern: /(?:\b(?:debug)|디버그|디버깅|버그|에러\s*분석)/i, skill: 'superclaw:sc-debugger', action: 'debug' },
  { pattern: /(?:\b(?:test|TDD|coverage)|테스트|커버리지)/i, skill: 'superclaw:sc-test-engineer', action: 'test' },
  { pattern: /(?:\b(?:performance|bottleneck)|성능|벤치마크|병목)/i, skill: 'superclaw:sc-performance', action: 'analyze' },
  // Ultrawork / Ralph Loop
  { pattern: /(?:\b(?:ulw|ultrawork)|완료될\s*때까지|끝날\s*때까지|다\s*해줘)/i, skill: 'superclaw:ultrawork', action: 'execute' },
];

// --- Team composition patterns (complex requests → multi-agent teams) ---
// Inspired by Ruflo's task complexity detection and OMC's team auto-composition
// Team patterns use functions for flexible Korean+English matching
const TEAM_PATTERNS = [
  {
    test: (s) => /(만들|구현|개발|build|implement|develop)/i.test(s) && /(앱|서비스|시스템|프로젝트|api|app|service|system)/i.test(s),
    team: 'dev',
    description: 'Full Development Team',
    agents: [
      { type: 'superclaw:sc-architect', role: 'Architecture & design', model: 'opus' },
      { type: 'superclaw:sc-junior', role: 'Implementation', model: 'sonnet' },
      { type: 'superclaw:sc-test-engineer', role: 'Testing & QA', model: 'sonnet' },
      { type: 'superclaw:sc-code-reviewer', role: 'Code review', model: 'opus' },
    ],
  },
  {
    test: (s) => /(연구|조사|research|investigate)/i.test(s) && /(논문|주제|분야|paper|topic|field)/i.test(s),
    team: 'research',
    description: 'Research Team',
    agents: [
      { type: 'superclaw:paper-reader', role: 'Paper analysis', model: 'sonnet' },
      { type: 'superclaw:literature-reviewer', role: 'Literature synthesis', model: 'opus' },
      { type: 'superclaw:research-assistant', role: 'Citation & lookup', model: 'haiku' },
      { type: 'superclaw:data-analyst', role: 'Data analysis', model: 'sonnet' },
    ],
  },
  {
    test: (s) => /(리팩토링|리팩터|정리해|refactor|restructure|재구성)/i.test(s),
    team: 'refactor',
    description: 'Refactoring Team',
    agents: [
      { type: 'superclaw:sc-architect', role: 'Architecture review', model: 'opus' },
      { type: 'superclaw:sc-junior', role: 'Code changes', model: 'sonnet' },
      { type: 'superclaw:sc-test-engineer', role: 'Regression testing', model: 'sonnet' },
    ],
  },
  {
    // Bidirectional: "에러 고쳐" or "fix this bug" — order doesn't matter
    test: (s) => /(고쳐|수정|해결|fix|troubleshoot)/i.test(s) && /(버그|에러|오류|crash|문제|bug|error)/i.test(s),
    team: 'debug',
    description: 'Debug Team',
    agents: [
      { type: 'superclaw:sc-debugger', role: 'Root cause analysis', model: 'sonnet' },
      { type: 'superclaw:sc-architect', role: 'Architecture context', model: 'opus' },
      { type: 'superclaw:sc-test-engineer', role: 'Reproduce & verify', model: 'sonnet' },
    ],
  },
  {
    test: (s) => /(배포|출시|deploy|release|production|프로덕션)/i.test(s),
    team: 'deploy',
    description: 'Deploy & Review Team',
    agents: [
      { type: 'superclaw:sc-security-reviewer', role: 'Security audit', model: 'opus' },
      { type: 'superclaw:sc-code-reviewer', role: 'Final review', model: 'opus' },
      { type: 'superclaw:sc-test-engineer', role: 'Integration tests', model: 'sonnet' },
    ],
  },
];

// --- Ecomode: task complexity → model suggestion ---
// Inspired by Ruflo's Q-Learning router & OMC's ecomode
function suggestModel(prompt) {
  const complexPatterns = /\b(architect|debug|security|refactor|race condition|concurrency|distributed|complex|아키텍처|보안|디버깅|리팩토링)\b/i;
  const simplePatterns = /\b(find|list|check|status|lookup|show|ls|cat|read|확인|목록|보여)\b/i;
  const mediumPatterns = /\b(implement|build|create|add|fix|update|만들어|구현|추가|수정)\b/i;

  if (complexPatterns.test(prompt)) return { model: 'opus', reason: 'complex reasoning task' };
  if (simplePatterns.test(prompt)) return { model: 'haiku', reason: 'simple lookup/status' };
  if (mediumPatterns.test(prompt)) return { model: 'sonnet', reason: 'standard implementation' };
  return { model: 'sonnet', reason: 'default' };
}

async function main() {
  const raw = await readStdin(3000);
  if (!raw.trim()) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  let input;
  try { input = JSON.parse(raw); } catch { console.log(JSON.stringify({ continue: true })); return; }

  const prompt = input?.prompt ?? input?.message ?? input?.content ?? '';
  if (!prompt) { console.log(JSON.stringify({ continue: true })); return; }

  // Strip code blocks and URLs to avoid false positives
  const cleaned = prompt
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, '');

  // Check team composition patterns first (complex multi-agent requests)
  const teamMatches = [];
  for (const tp of TEAM_PATTERNS) {
    if (tp.test(cleaned)) {
      teamMatches.push(tp);
    }
  }

  // Check single-skill keyword patterns
  const matches = [];
  for (const kw of SC_KEYWORDS) {
    if (kw.pattern.test(cleaned)) {
      matches.push(kw);
    }
  }

  if (matches.length === 0 && teamMatches.length === 0) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const parts = [];

  // Team composition context (takes priority for complex requests)
  if (teamMatches.length > 0) {
    const team = teamMatches[0]; // Use first match
    const modelSuggestion = suggestModel(cleaned);
    parts.push(`[SUPERCLAW TEAM DETECTED] Complex request → "${team.description}" recommended.`);
    parts.push(`Team composition for "${team.team}":`);
    for (const agent of team.agents) {
      parts.push(`  - ${agent.type} (${agent.model}): ${agent.role}`);
    }
    parts.push(`Ecomode suggestion: default model=${modelSuggestion.model} (${modelSuggestion.reason})`);
    parts.push('Use Agent tool with these subagent_types for optimal team delegation. Run independent agents in parallel.');
  }

  // Single skill matches
  const skills = [...new Set(matches.map(m => m.skill))];
  const actions = matches.map(m => m.action);

  if (skills.length > 0) {
    // Ultrawork gets a special announcement
    let announcement = '';
    if (actions.includes('execute') && skills.includes('superclaw:ultrawork')) {
      announcement = '\n\nIMPORTANT: Before doing anything else, display this announcement to the user:\n"**ultrawork!** 실행했습니다. 완료 조건을 확인하고 정확한 구현을 시작합니다."\nThen proceed with the skill.';
    }
    parts.push(`[SUPERCLAW KEYWORD DETECTED] User prompt matched SuperClaw keyword pattern. MUST invoke skill: ${skills.join(', ')}${announcement}`);
  }

  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: parts.join('\n'),
    },
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
