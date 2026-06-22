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

**Auto mode 주의**: Auto mode (사용자가 interruption 최소화 지침을 준 세션)에서도 Step 1.2의 `AskUserQuestion`(task type 분류)는 생략 불가. Hook이 fresh 세션의 `tddRequired`를 기본 `false`로 초기화하므로, `AskUserQuestion` 답변을 받지 않고 진행하면 TDD 보장이 꺼진 채 실행됨. `code`/`mixed` 답변이면 즉시 `gates.json`에 `tddRequired:true` 명시.

## PO Protocol

### Step 1: PLAN (Socratic critic 대화로 플랜 정련)

이 단계는 ULW의 심장이다. PO는 *옹호자*가 아니라 *비평가* 모드로 자기 플랜을 먼저 두들긴 뒤 유저와 함께 critic 대화를 거쳐 수렴시킨다. 이후는 완전 자율주행.

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
3. **분석 + 초안 plan**: 관련 파일/의존성 읽고 plan 초안을 *내부적으로* 작성. 아직 유저에게 공개 X.
4. **Socratic Critic 루프** (최대 3 round, 수렴 시 조기 종료):
   - **4a. PO 자가 비판 (Skeptic pass)** — 초안 plan의 가장 약한 *가정* 상위 1–2개를 식별. 각 가정은 `file:line` 또는 명시된 행위(예: "제안 3 스키마 재사용")로 구체 지칭. 일반론("성능이 문제일 수도") 금지.
   - **4b. 50:50 critic 질문** — `AskUserQuestion` 으로 유저에게 *1개*의 핵심 질문 + 2–4 옵션. 각 옵션은 지지/반대 증거 한 줄 동반. 질문은 "이거 괜찮아?" 금지. 허용 패턴: "X vs Y 왜 X인가?" / "가정 Z가 틀리면 어떻게?" / "엣지케이스 A 처리 여부?".
   - **4c. 답변 반영** — 유저 응답으로 plan 수정. 재검토 후 새 weakness가 도출되면 4a로 복귀 (최대 3 round).
   - **수렴 조건**: (a) PO self-challenge에 새 weakness 없음, 또는 (b) 유저가 "다음 단계" / "ㄱㄱ" 등 진행 신호 명시, 또는 (c) 3 round 상한 도달.
   - **Skip 규칙**: 유저가 `critic 생략` / `그냥 해` / `ㄱㄱ` 를 *명시 발화*한 경우에만 4 전체 skip. **PO 재량 skip 금지** — trivial task 여부와 무관하게 PO 혼자 판단해서 4 건너뛸 수 없음 (유저 의도 보호). Skip 발생 시 Step 4 최종보고서의 "근본 원인" 혹은 "후속작업" 란에 `critic skipped — <유저 발화 원문>` 명시.
5. **태스크 리스트 작성**: 정련된 plan을 태스크로 분해. 각 태스크에 명시:
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
6. **AskUserQuestion (최종 승인)** — 정련된 계획 + 태스크 리스트 제시 → 승인
   - 유저 수정 요청 시 반영 → 재질문 (티키타카)
   - 유저 OK → 다음 단계
7. **ExitPlanMode** — 유저 승인 완료.
8. **TaskCreate** — 승인된 태스크 생성. 의존성 설정 (addBlockedBy).

#### Critic 규율 (PO 자가준수)
- **빈손 질문 금지** — critic 질문은 반드시 `file:line` 또는 메모리 `[mem#N]` 또는 이전 round 결정을 근거로 인용.
- **1 concept / 1 turn** — 한 질문에 여러 주제 섞기 금지. 복수 critic 있으면 round 분할.
- **50:50 원칙** — 각 critic 턴은 PO 권장 + 반대 관점을 *동시에* 제시. 옵션별로 한 줄씩 pro/con 명시.
- **불확실성 플래그** — PO가 근거 없는 claim 하면 `⚠ my guess` 명시.
- **Critic 매체** — `AskUserQuestion` 객관식(2–4 옵션) 고정. 자유서술 강제 금지 — 옵션 부족 시 유저가 "Other" 사용.

### Step 2: EXECUTE (완전 자율 — 유저 개입 없음)

유저 승인된 계획대로 실행. PO가 알아서 판단하고 진행.

#### 코드 태스크 (TDD 강제 — Hook이 순서를 블로킹)

1. **RED**: QA 에이전트 dispatch → 테스트 작성 → 테스트 실행 → **FAIL 확인**
   - Hook이 `testsRedConfirmed: true` 기록
   - 이 단계를 거치지 않으면 구현 코드 Write/Edit이 Hook에 의해 블로킹됨
2. **GREEN**: 구현 에이전트 dispatch → 최소한의 코드로 테스트 통과
   - Hook이 `testsGreenConfirmed: true` 기록
3. **REFACTOR**: Architect 에이전트가 리뷰 + 리팩토링 (테스트 유지)
4. **미니멀리즘 게이트**: Architect 에이전트가 `simplify` 모드로 실행.
   - impl + test diff 전체에 DELETE-LIST 생성 (reinvented wheels 포함 — 기존 코드/stdlib 교차 검색 필수).
   - DELETE-LIST에 따른 삭제 적용.
   - 기존 테스트 재실행 → GREEN 확인 (새 RED→GREEN 사이클 아님. 기존 테스트만 통과 확인).
   - **Hook 강제**: `tddRequired===true && gates.minimalismConfirmed!==true`이면 Stop hook이 세션 종료를 차단.
   - 게이트 해제: Bash sentinel `SUPERCLAW_MINIMAL_CONFIRM` 포함 명령 실행 시 `gates.minimalismConfirmed = true`로 플립 (PreToolUse hook이 감지). simplify 패스를 실제로 완료한 후에만 발행할 것.

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
  - **stderr 보존 필수**: codex/gemini 병렬 호출 시 각 호출은 반드시 `2> ~/superclaw/data/logs/codex-$$-$(date +%s%N).log` 로 stderr를 분리 기록. 병렬 호출 중 hang 발생 시 해당 로그가 유일한 진단 근거. 배경 실행(`run_in_background:true`) 시 특히 중요.
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
- **최종 보고서** — 모든 ULW 세션의 마지막 assistant 메시지는 아래 5-섹션 구조를 *반드시* 따른다. 중간 메시지 금지, 턴의 마지막에 **단 한 번만**. 각 섹션이 해당사항 없으면 `없음`으로 명시 (공란·생략 금지).

````markdown
## 보고서

**문제**: 유저 요청과 증상 (1–3 bullet).

**근본 원인**: 코드/구성/프로세스 레벨에서 실제 원인. 가능하면 `file:line` 명시.

**수정**:
- `path/to/file.ext` — 한 줄 요약
- `path/to/other.ext` — 한 줄 요약

**검증**: 테스트 통과 수 / 스모크 결과 / verify agent verdict 등 객관적 증거.

**후속작업**: 남은 이슈·권장 follow-up. 없으면 `없음`.

**부채 원장 (Debt Ledger)**:
- `grep -rnE '(#|//) ?ponytail:'` 로 코드베이스 전체 harvest.
- 각 항목: `file:line — <ponytail: 내용>` 형식으로 나열.
- upgrade trigger 없는 항목(해결 조건/시점 미명시)은 `[no-trigger]` 태그.
- 항목 없으면 `없음`.

**LOC 델타**: 이번 작업의 순 라인 변화 (참고치, 미강제). 예: `+42 / -17 = net +25`.
````

> 프리앰블·장식 금지. 섹션 순서 고정 (문제 → 근본 원인 → 수정 → 검증 → 후속작업). 영문 기술용어는 backtick으로.

## Escape Hatch (수동 복구)

Hook의 테스트 감지가 누락·오작동한 경우 PO/사용자가 Bash 명령에 sentinel 문자열을 포함하여 gate를 명시적으로 플립할 수 있다. 명령 자체는 정상 실행되며 sentinel 매치는 PreToolUse hook에서 기록된다 (`trace` 로그: `hook:PreToolUse:ESCAPE`).

| Sentinel | 효과 |
|---|---|
| `SUPERCLAW_RED_CONFIRM` | `gates.testsRedConfirmed = true` — RED GATE 해제 |
| `SUPERCLAW_GREEN_CONFIRM` | `gates.testsGreenConfirmed = true` — GREEN 확정 |
| `SUPERCLAW_PLAN_APPROVE` | `gates.planApproved = true` — PLAN GATE 해제 |
| `SUPERCLAW_MINIMAL_CONFIRM` | `gates.minimalismConfirmed = true` — 미니멀리즘 게이트 해제 (simplify 패스 완료 후에만 발행) |

**사용 예**:
```bash
echo "# SUPERCLAW_RED_CONFIRM: manually verified __tests__/foo.test.ts fails on current code"
```

**원칙**: 반드시 *실제로* 테스트를 돌려 RED를 확인한 뒤에만 sentinel을 발행한다. 허위 발행은 TDD 우회이며 감사 가능. 동일 명령에 여러 sentinel을 함께 쓸 수 있다 (`SUPERCLAW_RED_CONFIRM; SUPERCLAW_PLAN_APPROVE`).

Bash tool에서만 감지됨. Edit/Write의 content에 포함되어도 flip되지 않는다.

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
