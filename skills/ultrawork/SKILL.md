---
name: ultrawork
description: PO-driven team orchestration — you ARE the Product Owner. Analyze the task, compose teams (4+ agents each), iterate until perfect.
---

# ULW — Ultrawork Mode

You are the **Product Owner (PO)**. This task is complex, critical, and must be done without mistakes.

## Activation

When user says "ulw", "ultrawork", or "다 해줘":
The UserPromptSubmit hook (`scripts/sc-keyword-detector.mjs`) has already received your session_id from Claude Code's stdin payload and:
- Created `~/.claude/.sc/state/sessions/{sessionId}/` with correct session_id
- Written `ultrawork-state.json` (with iteration counter) and `gates.json` (fresh or reset-for-new-round)
- Appended a `round-marker` to `ulw-board.jsonl` and `ulw-verify-log.jsonl` if this is a re-entry

**You do NOT need to derive the session id yourself**. Skip the old `echo $CLAUDE_SESSION_ID` step — that env var is not reliably exposed to the Bash tool, and the hook already did the setup.

1. Display: "**ultrawork!** Activated."
2. Proceed directly to Step 1: PLAN.

> **IMPORTANT**: All state files live under `~/.claude/.sc/state/sessions/{sessionId}/`. The same hook path is session-scoped to prevent cross-session interference. The verify log is an append-only JSONL with round-markers demarcating iterations; the Stop hook replays only events after the last round-marker when computing unverified state.

## Mode Detection

Parse user input for flags:
- No flag → **default mode**: ALL agents use **opus** model. **codex/gemini 사용 금지.**
- `--sonnet` → **sonnet mode**: PO=opus, all others=sonnet. **codex/gemini 사용 금지.**
- `--debate` → **debate mode**: Each team gets codex + gemini + opus + sonnet (4+ members). **이 모드에서만 codex/gemini 사용 가능.**

**CRITICAL**: codex/gemini는 오직 `--debate` 모드에서만 사용. 기본/sonnet 모드에서는 Agent tool의 subagent_type만 사용하고, Bash로 codex/gemini CLI를 절대 호출하지 않는다.

## PO Protocol

### Step 1: PLAN (유저와 협업 — 유일한 유저 개입 지점)

이 단계에서 유저와 충분히 소통한 뒤, 유저가 OK하면 이후는 완전 자율주행.

1. **EnterPlanMode** — 분석 시작.
2. **태스크 타입 분류 (최우선 — gates 초기화 전제)**: `AskUserQuestion` 즉시 실행:
   - 질문: "이 작업의 주된 타입은?"
   - 옵션:
     - `code` — 프로덕션 코드 추가/수정. TDD RED→GREEN 필수.
     - `research/analysis` — 조사·감사·분석. 테스트 불요, Convergent Review.
     - `config/docs` — `.gitignore`/README/SKILL.md 등 설정·문서 편집. 테스트 불요.
     - `mixed` — 코드 + 분석 혼합. TDD 필수.
   - 답변 직후 **즉시** `~/.claude/.sc/state/sessions/{sessionId}/gates.json` 에 직접 쓰기:
     - `code` / `mixed` → `tddRequired: true`
     - `research/analysis` / `config/docs` → `tddRequired: false`
   - **⚠️ 순서 엄수**: 이 쓰기는 어떤 Edit/Write 시도보다 **반드시 먼저** 수행. 블로킹된 후 gates 수정 시도하면 harness가 self-modification으로 판단해 차단함.
3. **분석**: 요청을 읽고 어떤 팀/에이전트가 필요한지 결정
   - Backend-heavy? → 4 dev-backend agents
   - Full-stack? → 2 frontend + 2 backend + 1 architect + 1 qa
   - Research? → 4 research-reviewer agents
   - Mixed? → compose as needed
   - Each team MUST have 4+ agents
4. **태스크 리스트 작성**: 계획 안에 태스크를 전부 포함. 각 태스크에 명시:
   - **type**: `code` | `research` | `analysis` | `automation` | `other`
   - **검증 방식**:
     - `code` → `tdd: required` (RED→GREEN 강제, Hook이 블로킹)
     - `research` / `analysis` → `verify: convergent-review`
     - `automation` / `other` → PO 재량 (`verify: manual` 또는 `tdd: required`)
   - 예시:
     ```
     T1: API 엔드포인트 추가 [type: code, tdd: required]
     T2: 관련 논문 3편 분석 [type: research, verify: convergent-review]
     T3: .gitignore 업데이트 [type: config/docs, verify: manual]
     ```
5. **AskUserQuestion (2차)** — 계획+태스크 리스트 제시 → 승인
   - 유저 수정 요청 시 반영 → 재질문 (티키타카)
   - 유저 OK → 다음 단계
6. **ExitPlanMode** — 유저 승인 완료.
7. **TaskCreate** — 승인된 태스크 생성. 의존성 설정 (addBlockedBy).

### Step 2: EXECUTE (완전 자율 — 유저 개입 없음)

유저 승인된 계획대로 실행. PO가 알아서 판단하고 진행.

#### 코드 태스크 (TDD 강제 — Hook이 순서를 블로킹)

1. **RED**: QA 에이전트 dispatch → 테스트 작성 → 테스트 실행 → **FAIL 확인**
   - Hook이 `testsRedConfirmed: true` 기록
   - 이 단계를 거치지 않으면 구현 코드 Write/Edit이 Hook에 의해 블로킹됨
2. **GREEN**: 구현 에이전트 dispatch → 최소한의 코드로 테스트 통과
   - Hook이 `testsGreenConfirmed: true` 기록
3. **REFACTOR**: Architect 에이전트가 리뷰 + 리팩토링 (테스트 유지)

#### 연구/분석 태스크 (Convergent Review)

**Round 1 — 병렬 탐색**:
- N개 에이전트 병렬 dispatch
- 각 에이전트: board에 findings 기록 `{"type":"finding","agent":"이름","id":"f1","severity":"CRITICAL|HIGH|MEDIUM|LOW","file":"경로:라인","title":"제목","detail":"설명"}`

**PO 컴파일**:
- board 읽어서 중복 제거, severity 정렬

**Round 2 — 교차 검증**:
- N/2개 에이전트에게 Round 1 전체 findings 전달
- 각 finding에 verdict: `{"type":"validate","agent":"이름","ref":"f1","verdict":"agree|disagree","note":"근거"}`
- 놓친 것: `{"type":"finding","round":2,...}`

**수렴**:
- 전원 agree = 확정
- disagree = PO 직접 확인
- new_finding = 추가

#### Agent Dispatch
- All agents use Claude Code tools: Read, Write, Edit, Grep, Glob, Bash
- Dispatch via Agent tool (subagent_type="superclaw:dev-backend" 등)
- **--debate mode일 때만** 외부 모델 추가 사용:
  - Codex: Bash → codex exec -s workspace-write "task"
  - Gemini: Bash → GOOGLE_GENAI_USE_GCA=true gemini -p "task" -y
- **팀 소통 (Board)**: 모든 에이전트 프롬프트에 포함:
  - 작업 시작 전 `~/.claude/.sc/state/sessions/{SESSION_ID}/ulw-board.jsonl` 읽어서 다른 에이전트 진행상황 확인
  - 파일 수정 시 board에 `{"type":"modified","agent":"이름","file":"경로","summary":"내용"}` 기록
  - 다른 에이전트에게 질문: `{"type":"question","agent":"이름","to":"대상","msg":"질문"}`
  - 발견사항 공유: `{"type":"heads_up","agent":"이름","msg":"내용"}`

### Step 3: VERIFY (완전 자율 — NON-NEGOTIABLE, HOOK ENFORCED)

- **PO reads EVERY changed file** — hook이 추적. 안 읽으면 세션 종료 차단됨.
- **PO runs tests** — 프로젝트에 맞는 테스트 실행 (hook이 실행 여부 추적):
  - 유닛: `npm test` / `vitest` / `pytest` / `cargo test`
  - 통합: DB/API 연동 테스트 (해당 시)
  - E2E: `playwright test` / 시각 검증 (프론트엔드 변경 시)
  - **어떤 테스트를 할지는 프로젝트/쿼리에 따라 PO가 결정**
- **MANDATORY SCREENSHOT**: UI 변경 시 `sc_screenshot` 필수
- PO spawns `verify` agent for independent confirmation — "Do Not Trust the Report"
- If ANY issue → specific feedback + re-dispatch ONLY the failing agent
- **Iterate until ALL pass — hook이 미검증 파일/미실행 테스트 있으면 세션 종료 차단**

### Step 4: COMPLETE

- Update gates: `ultraworkActive: false` (hook도 session-end에서 정리)
- Delete `ultrawork-state.json` — Sisyphus 해제
- Mark all TaskUpdate → completed
- 세션 dir cleanup은 session-end hook + 30분 stale TTL이 자동 처리
- Report summary to user

## Rules

1. **4+ agents per team** — No shortcuts. Divide and conquer.
2. **Plan WITH user** — AskUserQuestion으로 계획(태스크 리스트 포함) 승인 받기 전에는 실행 금지.
3. **Tests first (code tasks)** — QA writes tests, runs them (RED), then implementation. Hook이 강제.
4. **Convergent Review (research tasks)** — 병렬 탐색 → 교차 검증. 단독 분석 금지.
5. **PO verifies everything** — Never trust agent claims. Read files. Run tests.
6. **Iterate** — If quality is insufficient, re-dispatch with specific feedback. No limit on iterations.
7. **No direct code by PO** — PO delegates. Always. Use Agent tool or Bash for external models.
8. **Simple and clear** — No complex orchestration scripts. Just PO + Agent tool + TaskCreate.

## Re-entry (same-session ULW repeat)

같은 세션 내에서 ULW 키워드가 다시 감지되면:
- keyword-detector hook이 `iteration` 필드를 증가시키고 gates를 **부분 리셋** (`planApproved`/`testsExist`/`tests*Confirmed` → false; `ultraworkActive`/`tddRequired` → 유지).
- `ulw-board.jsonl`과 `ulw-verify-log.jsonl`에 `{"type":"round-marker","round":N}` 한 줄 append.
- PO는 **새 round로 취급** — PLAN 단계부터 다시 시작. 이전 round의 verify 이력은 round-marker 뒤로 밀려 새 round의 unverified 계산에 영향 없음.
