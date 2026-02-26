---
name: ultrawork
description: Accuracy-first autonomous implementation — iterates until the user's completion promise is fulfilled, verifying every result independently
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task, WebFetch, WebSearch
---

<Purpose>
Ultrawork는 유저의 고수준 목표를 받아서, 정확하게 의도대로 구현될 때까지 반복하는 시스템입니다.
핵심 원칙: 빠르게가 아니라 제대로. 모든 결과를 독립적으로 검증하고, 실패에서 학습하여 다음 시도에 반영합니다.
</Purpose>

<Use_When>
- User says "ulw", "ultrawork", "다 해줘", "완료될 때까지"
- 여러 파일에 걸친 복잡한 작업
- "끝날 때까지 멈추지 마" 같은 지속성이 필요한 작업
- 유저가 완료 조건을 정의한 경우
</Use_When>

<Do_Not_Use_When>
- 단일 파일 간단한 수정 — sc-junior/sc-atlas에 직접 위임
- 순수 조사/탐색 — Explore 에이전트 사용
- 유저가 단계별 수동 제어를 원하는 경우
</Do_Not_Use_When>

<Execution_Policy>
## Phase 0: 이해 (SKIP하면 안 됨)

1. **완료 조건 확정** — 유저에게 묻거나 유저의 말에서 추출
   - 예: "TypeScript 에러 0개, 테스트 통과, 새 경고 없음"
   - 모호하면 반드시 물어볼 것. 추측 금지.
2. **TODO 생성** — TaskCreate로 작업 목록 생성 (RULE 1 준수)
3. **현재 상태 파악** — 관련 파일 읽기, 기존 코드 구조 이해

## Phase 1: 계획

1. 완료 조건을 달성하기 위한 구체적 작업 목록 작성
2. 작업 간 의존성 파악 (같은 파일 수정 = 순차, 독립 파일 = 병렬 가능)
3. 각 작업에 적절한 에이전트 배정:
   - 단순: sc-junior (haiku)
   - 표준: sc-atlas (sonnet)
   - 복잡: sc-debugger-high (opus)

## Phase 2: 실행 (반복)

각 iteration (1 ~ max_iterations, 기본 10):

### 2a. 작업 배분
- 독립적인 작업은 병렬 실행 (하나의 메시지에 여러 Task 호출)
- 의존적인 작업은 순차 실행
- 각 에이전트 프롬프트에 포함:
  - 구체적인 목표
  - 이전 iteration의 학습 내용
  - "증거 포함: 변경한 file:line, 빌드/테스트 결과"

### 2b. 독립 검증 (절대 생략 금지)
에이전트가 "완료"라고 해도 믿지 않음. 직접 확인:
1. 변경된 파일을 Read로 직접 읽기
2. 구문 검증 실행 (node -c, tsc --noEmit 등)
3. 테스트가 있으면 실행
4. source와 cache 파일 동기화 확인 (diff)
5. sc_verification_log로 결과 기록

### 2c. 학습 축적
검증 후:
- 성공한 것, 실패한 것, 예상 못한 문제를 sc_learning_store로 기록
- 다음 iteration 에이전트 프롬프트에 주입

### 2d. 완료 평가
완료 조건 대비 현재 상태 확인:
- 충족 → 루프 종료, 최종 보고
- 미충족 → 남은 작업 파악, 다음 iteration 진행
- max_iterations 도달 → 부분 완료 보고 + 남은 항목 명시

## Phase 3: 최종 보고

- iterations 수, 실행한 작업 수
- 검증 결과 (통과/실패)
- 완료 조건 상태: FULFILLED / PARTIAL
- 남은 항목 (있다면)
- 증거 (빌드/테스트 출력)
</Execution_Policy>

<Output_Format>
## Ultrawork Report — Iteration {N}/{max}

### 완료 조건
> {유저의 완료 조건}

### 상태: {FULFILLED / IN_PROGRESS / PARTIAL}

### 이번 Iteration
- 실행한 작업: {count}
- 검증 결과: {passed}/{total} 통과

### 학습
- 성공: {list}
- 실패: {list}
- 주의점: {list}

### 남은 작업 (미충족 시)
- [ ] {item 1}
- [ ] {item 2}

### 증거
- 빌드: {command} → {result}
- 테스트: {command} → {result}
</Output_Format>

<Steps>
1. 완료 조건 확정 (모호하면 질문)
2. TODO 생성 (TaskCreate — RULE 1)
3. 현재 상태 파악 (Read, Grep, Glob)
4. 계획 수립 + 에이전트 배정
5. 실행 → 검증 → 학습 → 평가 (반복)
6. 완료 조건 충족 시 최종 보고
</Steps>

<Escalation_And_Stop_Conditions>
- 완료 조건이 모호하면 STOP → 유저에게 질문
- 3회 연속 진전 없음 → sc-architect에게 구조적 문제 확인
- 유저가 "stop", "cancel" → 현재 상태 보고 후 즉시 종료
- max_iterations 도달 → 부분 완료 보고
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] 완료 조건이 명확히 정의됨
- [ ] TODO가 TaskCreate로 생성됨
- [ ] 매 iteration마다: 실행 → 검증 → 학습 → 평가
- [ ] 모든 검증은 독립적 (에이전트 주장을 믿지 않음)
- [ ] 학습이 축적되어 다음 iteration에 반영
- [ ] 최종 보고에 증거 포함
</Final_Checklist>
