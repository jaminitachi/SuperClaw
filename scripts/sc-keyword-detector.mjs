#!/usr/bin/env node
/**
 * UserPromptSubmit hook — v4 simplified keyword detector.
 *
 * v4 philosophy: PO (Opus) handles broad intent detection directly.
 * This hook only triggers for explicit SuperClaw activation phrases:
 *   1. ultrawork mode (ulw, ultrawork, etc.)
 *   2. mac-control (screenshot)
 *   3. telegram (send to phone)
 *   4. socratic-learner (티키타카 / adversarial Socratic sparring)
 *   5. critic-review (post-work teaching review + quiz)
 *
 * Team composition, agent roster, and skill routing are all handled by PO.
 */
if (process.env.SUPERCLAW_DAEMON === '1') {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}
import { readStdin } from './lib/stdin.mjs';
import { trace } from './lib/hook-logger.mjs';
import { readFileSync, writeFileSync, appendFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sessionDir, ulwStatePath, ulwGatesPath, ulwBoardPath, ulwVerifyLogPath } from './lib/ulw-paths.mjs';

// --- Explicit SuperClaw keyword patterns (PO handles everything else) ---
const SC_KEYWORDS = [
  { pattern: /(?:\b(?:ulw|ultrawork)\b|완료될\s*때까지|끝날\s*때까지|다\s*해줘)/i, skill: 'superclaw:ultrawork', action: 'execute' },
  { pattern: /(?:\b(?:screenshot|capture screen|take a picture)|스크린샷)/i, skill: 'superclaw:mac-control', action: 'screenshot' },
  { pattern: /(?:\b(?:send to phone|telegram|notify me|text me)|텔레그램)/i, skill: 'superclaw:telegram-control', action: 'send' },
  { pattern: /(?:\b(?:socratic|socratic\s*mode|interview\s*me|ontology|ouroboros)\b|소크라틱|문답|티키타카|정반합|반박해|논리\s*깨줘|온톨로지|우르보로스)/i, skill: 'superclaw:socratic-learner', action: 'socratic' },
  { pattern: /(?:\/critic-review\b|\bcritic-review\b|\bcritic\s*review\b|크리틱\s*리뷰|리뷰\s*퀴즈|복습하자|이해\s*확인)/i, skill: 'superclaw:critic-review', action: 'critic-review' },
];

// --- Task-based provider routing (OMO) — kept for external model routing ---
const TASK_PROVIDER_ROUTING = {
  coding:       { provider: 'codex',  command: 'codex exec -s workspace-write', why: 'GPT excels at code generation' },
  vision:       { provider: 'gemini', command: 'GOOGLE_GENAI_USE_GCA=true gemini -p', flags: '-y -o text', why: 'Gemini has strong multimodal/vision' },
  reasoning:    { provider: 'claude', model: 'opus', why: 'Best reasoning capability' },
  data:         { provider: 'codex',  command: 'codex exec -s workspace-write', why: 'Strong at pandas/data code execution' },
  architecture: { provider: 'claude', model: 'opus', why: 'Best at high-level system design' },
  document:     { provider: 'gemini', command: 'GOOGLE_GENAI_USE_GCA=true gemini -p', flags: '-y -o text', why: 'Large context window for long documents' },
  creative:     { provider: 'claude', model: 'opus', why: 'Best at creative/writing tasks' },
  frontend:     { provider: 'gemini', command: 'GOOGLE_GENAI_USE_GCA=true gemini -p', flags: '-y -o text', why: 'Gemini excels at visual/UI design and frontend' },
};

function isUltraworkActive(sessionId) {
  try {
    const gatesPath = ulwGatesPath(sessionId);
    if (!gatesPath || !existsSync(gatesPath)) return false;
    const gates = JSON.parse(readFileSync(gatesPath, 'utf-8'));
    return gates.ultraworkActive === true;
  } catch { return false; }
}

function detectTaskType(prompt) {
  const patterns = [
    { type: 'frontend', test: /(프론트|frontend|UI|UX|디자인|design|대시보드|dashboard|CSS|스타일|style|레이아웃|layout|화면|페이지|컴포넌트)/i },
    { type: 'coding', test: /(코드|코딩|구현|개발|implement|build|create|write code|function|class|module|스크립트|script)/i },
    { type: 'vision', test: /(이미지|사진|스크린샷|OCR|image|photo|screenshot|chart|diagram|visual|그림|차트)/i },
    { type: 'data', test: /(데이터|CSV|JSON|pandas|통계|statistics|dataset|데이터\s*분석|data\s*analysis|엑셀|excel)/i },
    { type: 'document', test: /(문서|논문|paper|document|PDF|요약.*문서|읽어.*문서|보고서|report)/i },
    { type: 'architecture', test: /(아키텍처|구조\s*설계|system\s*design|architecture|시스템\s*설계)/i },
    { type: 'reasoning', test: /(분석|추론|이유|왜|debug|reason|analyze|why|복잡|complex|증명|proof)/i },
    { type: 'creative', test: /(글쓰기|writing|creative|작문|소설|시|에세이|essay)/i },
  ];
  for (const p of patterns) {
    if (p.test.test(prompt)) return p.type;
  }
  return null;
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
  const sessionId = input?.session_id || input?.sessionId || null;
  trace(sessionId, 'hook:UserPromptSubmit:input', { prompt: prompt.slice(0, 500) });
  if (!prompt) { console.log(JSON.stringify({ continue: true })); return; }

  // Strip code blocks and URLs to avoid false positives
  const cleaned = prompt
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, '');

  // Check keyword patterns
  const matches = [];
  for (const kw of SC_KEYWORDS) {
    if (kw.pattern.test(cleaned)) {
      matches.push(kw);
    }
  }

  // OMO provider routing (non-keyword, task-type based)
  // Suppress when ULW is active — PO handles all model routing
  const taskType = detectTaskType(cleaned);
  let omoHint = '';
  const ulwActive = isUltraworkActive(sessionId);
  if (!ulwActive && matches.length === 0 && taskType) {
    const route = TASK_PROVIDER_ROUTING[taskType];
    if (route && route.provider !== 'claude') {
      const flags = route.flags ? ` ${route.flags}` : '';
      omoHint = `[SUPERCLAW OMO ROUTING] Task type "${taskType}" → ${route.provider} recommended (${route.why}).\nConsider: Bash tool → ${route.command} "task prompt"${flags} 2>/dev/null\n`;
    }
  }

  if (matches.length === 0 && !omoHint) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const parts = [];

  // OMO routing hint
  if (omoHint) {
    parts.push(omoHint);
  }

  // Skill matches
  if (matches.length > 0) {
    const skills = [...new Set(matches.map(m => m.skill))];
    const actions = matches.map(m => m.action);

    let announcement = '';
    if (actions.includes('execute') && skills.includes('superclaw:ultrawork')) {
      announcement = '\n\nIMPORTANT: Before doing anything else, display this announcement to the user:\n"**ultrawork!** Activated. Verifying completion conditions and starting precise implementation."\nThen proceed with the skill.';
    }
    if (actions.includes('socratic') && skills.includes('superclaw:socratic-learner')) {
      announcement += '\n\nSocratic default: adversarial thesis → antithesis → evidence → synthesis. Prioritize current cwd MEMORY.md and linked memory details, then SuperClaw knowledge, then learnings, then code/web/paper/model evidence. Explain in human-like Korean prose for a junior learner: avoid unexplained jargon, define necessary terms inline, and prefer readable paragraphs over compressed bullet fragments.';
    }
    if (actions.includes('critic-review') && skills.includes('superclaw:critic-review')) {
      announcement += '\n\nCritic-review default: inspect the just-finished work, explain what changed and why like an instructor, connect the consequences to the codebase/research stack, then quiz the user one question at a time. Do not merely summarize the plan.';
    }
    parts.push(`[SUPERCLAW KEYWORD DETECTED] User prompt matched SuperClaw keyword pattern. MUST invoke skill: ${skills.join(', ')}${announcement}`);

    // Auto-create ultrawork state files when ulw/ultrawork detected — SESSION-SCOPED
    if (actions.includes('execute') && skills.includes('superclaw:ultrawork')) {
      if (!sessionId) {
        // No session id in hook input → we cannot write session-scoped state.
        // Never fall back to global — parallel sessions would collide.
        trace(null, 'skill:activation:skipped', { reason: 'no-session-id' });
      } else {
        const sDir = sessionDir(sessionId);
        const ulwPath = ulwStatePath(sessionId);
        const gatesPath = ulwGatesPath(sessionId);
        const boardPath = ulwBoardPath(sessionId);
        const verifyLogPath = ulwVerifyLogPath(sessionId);

        if (sDir && ulwPath && gatesPath && boardPath && verifyLogPath) {
          const ulwAlreadyActive = existsSync(ulwPath);
          const now = new Date().toISOString();

          if (ulwAlreadyActive) {
            // Re-entry: increment iteration, reset round timestamps, keep identity fields
            let prevState = {};
            try { prevState = JSON.parse(readFileSync(ulwPath, 'utf-8')); } catch {}
            const nextIteration = (prevState.iteration ?? 1) + 1;
            const newState = {
              ...prevState,
              iteration: nextIteration,
              roundStartedAt: now,
              lastActivityAt: now,
              completed: false,
            };
            const stateTmp = ulwPath + '.tmp.' + process.pid;
            writeFileSync(stateTmp, JSON.stringify(newState, null, 2));
            renameSync(stateTmp, ulwPath);

            // Partial gates reset: keep ultraworkActive and tddRequired, wipe progress flags
            let prevGates = {};
            try { prevGates = JSON.parse(readFileSync(gatesPath, 'utf-8')); } catch {}
            const resetGates = {
              ultraworkActive: true,
              tddRequired: prevGates.tddRequired !== undefined ? prevGates.tddRequired : false,
              planApproved: false,
              testsExist: false,
              testsRun: false,
              testsRedConfirmed: false,
              testsGreenConfirmed: false,
            };
            // testsPassed 필드는 삭제 (resetGates에 포함 안 함)
            const gatesTmp = gatesPath + '.tmp.' + process.pid;
            writeFileSync(gatesTmp, JSON.stringify(resetGates));
            renameSync(gatesTmp, gatesPath);

            // Append round-marker to board and verify log
            const roundMarker = JSON.stringify({ type: 'round-marker', round: nextIteration, ts: now }) + '\n';
            try { appendFileSync(boardPath, roundMarker); } catch {}
            try { appendFileSync(verifyLogPath, roundMarker); } catch {}

          } else {
            // Fresh ULW session — write state with iteration:1
            writeFileSync(ulwPath, JSON.stringify({
              active: true,
              startedAt: now,
              mode: 'po-team',
              sessionId: sessionId,
              iteration: 1,
            }, null, 2));

            // Fresh gates
            const gatesData = JSON.stringify({"planApproved":false,"tddRequired":false,"testsExist":false,"testsRun":false,"testsRedConfirmed":false,"testsGreenConfirmed":false,"ultraworkActive":true});
            const tmpPath = gatesPath + '.tmp.' + process.pid;
            writeFileSync(tmpPath, gatesData);
            renameSync(tmpPath, gatesPath);

            // Clear ULW tracking files for fresh session
            try { writeFileSync(boardPath, ''); } catch {}
            try { writeFileSync(verifyLogPath, ''); } catch {}
          }
        }
      }
    }
  }

  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: parts.join('\n'),
    },
  }));

  // Trace output
  const skills = matches.length > 0 ? [...new Set(matches.map(m => m.skill))] : [];
  trace(sessionId, 'hook:UserPromptSubmit:output', {
    additionalContext: parts.join('\n'),
    skillsMatched: skills,
    taskType: taskType || 'none',
  });
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
});
