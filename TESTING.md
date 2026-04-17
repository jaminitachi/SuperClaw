# SuperClaw Testing Strategy

## Philosophy (Superpowers 원칙 채택)

1. **Evidence before claims** — 테스트 실행 결과를 보기 전에 "통과"를 주장하지 않는다
2. **RED-GREEN-REFACTOR** — 실패하는 테스트 먼저, 최소 코드로 통과, 리팩터
3. **Verification gate** — ULW Step 4에서 hook이 테스트 실행+통과를 강제
4. **Pressure testing** — 에이전트가 우회하려는 상황을 시뮬레이션

## Test Pyramid

### Layer 1: Unit Tests (목표: 70% 커버리지)
- **scripts/lib/*.mjs** — 순수 함수 (cleanEnvironment, parseJsonFromResponse, rotateIfNeeded, etc.)
- **hud/*.mjs** — 렌더링 함수 (cost, sanitize, limits, context)
- **src/**/*.ts** — 비즈니스 로직 (alerting, schema, config, ratchet)
- 실행: `npm test` / `vitest run`

### Layer 2: Integration Tests (목표: 50% 시나리오 커버)
- **Hook stdin→stdout** — JSON 입력 → 기대 JSON 출력
- **Gates state transition** — 초기화 → planApproved → testsExist → testsRun
- **DB CRUD** — learnings/knowledge 저장/조회/중복방지
- 실행: `npm test` (같은 vitest)

### Layer 3: E2E Tests (목표: 핵심 시나리오 3개)
- **ULW lifecycle** — ulw 키워드 → gate 활성 → Write 차단 → 테스트 작성 → 통과 → Write 허용 → 종료
- **Session-end pipeline** — transcript → learning extraction → DB 저장
- **HUD rendering** — fixture 입력 → 렌더링 스냅샷 비교
- 실행: `npm run test:e2e` (별도 스크립트)

## Hook에 의한 테스트 강제 (HARD GATE)

```
PreToolUse (sc-pre-tool.mjs):
  TDD GATE: 테스트 파일 없으면 프로덕션 코드 Write/Edit 차단 (block: true)

PostToolUse (sc-post-tool.mjs):
  Bash에서 npm test/vitest/jest/playwright/pytest 감지 → testsRun: true
  테스트 결과 FAIL 감지 → testsPassed: false

Stop (sc-persistent.mjs):
  testsRun !== true → "테스트를 아직 실행하지 않았습니다" → 세션 종료 차단
  testsPassed === false → "테스트가 실패했습니다" → 세션 종료 차단
```

## Coverage 설정

```bash
npm run test:coverage  # vitest + @vitest/coverage-v8
```

Thresholds:
- statements: 30% (현재 ~8%, 점진적 증가 목표)
- branches: 25%
- functions: 30%
- lines: 30%

## 파일 구조

```
tests/
├── session-end.test.ts     — session-end-utils 유닛 (33 tests)
├── schema.test.ts          — DB 스키마 유닛 (6)
├── config.test.ts          — config loader 유닛 (4)
├── ratchet.test.ts         — ratchet 유닛 (4)
├── health-command.test.ts  — command 파일 검증 (4)
├── log-rotate.test.ts      — 로그 로테이션 유닛
├── json-set.test.ts        — JSON Set I/O 유닛
├── claude-bin.test.ts      — claude 바이너리 탐색 유닛
├── ulw-board.test.ts       — 에이전트 보드 유닛
├── hooks.test.ts           — hook stdin→stdout 통합
├── hud.test.ts             — HUD 렌더링 유닛
└── alerting.test.ts        — heartbeat 알림 유닛
```

## Superpowers 스타일 Pressure Testing (향후)

에이전트가 우회하려는 시나리오를 명시적으로 테스트:
- "빈 테스트 파일로 TDD gate 통과 시도" → 차단되는지?
- "Bash로 파일 수정 시도" → 추적되는지?
- "테스트 실패 후 종료 시도" → 차단되는지?
- "2시간 후 stale 해제 시도" → lastActivityAt이 갱신되어 방지되는지?
