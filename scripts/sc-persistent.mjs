#!/usr/bin/env node
/**
 * Stop hook — Sisyphus pattern: prevents premature exit when
 * ultrawork/ralph/autopilot modes or pipelines are active.
 * Session-scoped: only blocks the session that started ultrawork.
 * Use /cancel skill or delete state files to allow exit.
 */
if (process.env.SUPERCLAW_DAEMON === '1') {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}
import { readStdin } from './lib/stdin.mjs';
import { readFileSync, existsSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { ulwStatePath, ulwVerifyLogPath, ulwGatesPath } from './lib/ulw-paths.mjs';
import { loadUnverified, loadAllEdited } from './lib/ulw-verify-log.mjs';

async function main() {
  const raw = await readStdin(2000);
  let input = {};
  try { input = JSON.parse(raw); } catch {}

  // Prevent infinite loop — if stop_hook_active is already set, allow exit
  if (input?.stop_hook_active) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const currentSessionId = input?.session_id || input?.sessionId || null;
  const reasons = [];

  // Check 1: ultrawork state (session-scoped only — no global fallback)
  const ulwPath = ulwStatePath(currentSessionId);

  try {
    if (ulwPath && existsSync(ulwPath)) {
      const STALE_TIMEOUT = 30 * 60 * 1000;
      try {
        const state = JSON.parse(readFileSync(ulwPath, 'utf-8'));
        const lastActivity = new Date(state.lastActivityAt || state.startedAt).getTime();
        if (Date.now() - lastActivity > STALE_TIMEOUT) {
          const dir = dirname(ulwPath);
          unlinkSync(ulwPath);
          // Best-effort cleanup of sibling ULW files in session dir
          try { unlinkSync(join(dir, 'gates.json')); } catch {}
          try { unlinkSync(join(dir, 'ulw-verify-log.jsonl')); } catch {}
          try { unlinkSync(join(dir, 'ulw-board.jsonl')); } catch {}
          // Remove session dir if now empty; ENOTEMPTY is silently ignored
          try { rmdirSync(dir); } catch {}
        } else {
          const ulwSessionId = state.sessionId || null;
          // Vestigial defensive guard: we only read our own session's state
          // now, so this is trivially true. Kept so a future refactor that
          // changes path resolution can't silently nag across sessions.
          const isThisSession = ulwSessionId === currentSessionId;
          if (isThisSession) {
            reasons.push(`ULW 모드 진행 중 (작업: ${state.pendingTasks ?? '?'}개)`);

            // PO verification — session-scoped verify log only
            const logPath = ulwVerifyLogPath(currentSessionId);
            const everEdited = loadAllEdited(logPath);
            if (everEdited.size > 0) {
              const unverified = [...loadUnverified(logPath)];
              if (unverified.length > 0) {
                const names = unverified.map(f => basename(f));
                const display = names.length > 3
                  ? `${names.slice(0, 3).join(', ')} 외 ${names.length - 3}개`
                  : names.join(', ');
                reasons.push(`PO 검증 미완료 — 미검증 파일 ${unverified.length}개: ${display}`);
              }

              const gatesPath = ulwGatesPath(currentSessionId);
              try {
                if (gatesPath && existsSync(gatesPath)) {
                  const gates = JSON.parse(readFileSync(gatesPath, 'utf-8'));
                  if (gates.tddRequired !== false) {
                    if (gates.testsRun !== true) {
                      reasons.push('테스트를 아직 실행하지 않았습니다');
                    } else if (gates.testsPassed === false) {
                      reasons.push('테스트가 실패했습니다. 수정 후 다시 실행해주세요');
                    }
                  }
                }
              } catch {}
            }
          }
        }
      } catch {
        try { unlinkSync(ulwPath); } catch {}
      }
    }
  } catch {}

  // Check 2: Active pipeline
  const pipelineFile = join(homedir(), 'superclaw', 'data', 'pipeline-state.json');
  try {
    if (existsSync(pipelineFile)) {
      const state = JSON.parse(readFileSync(pipelineFile, 'utf-8'));
      if (state.active) reasons.push('pipeline is running');
    }
  } catch {}

  if (reasons.length > 0) {
    console.log(JSON.stringify({
      decision: 'block',
      reason: `SuperClaw Sisyphus: ${reasons.join(', ')}. Continue working on pending tasks. To force exit, delete state files under ~/.claude/.sc/state/sessions/{sessionId}/ or use /cancel.`,
    }));
  } else {
    console.log(JSON.stringify({ decision: 'approve' }));
  }
}

main().catch(() => {
  console.log(JSON.stringify({ decision: 'approve' }));
});
