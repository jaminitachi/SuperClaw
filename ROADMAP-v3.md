# SuperClaw v3 Overhaul Roadmap

## 비전
"요청 하나면 알아서 팀 구성하고 실행하고 검증까지" — IT/연구/일상 모든 영역

## 현재 진단 (v2.0.0 문제점)

### 이미 수정됨 (2026-03-07)
- [x] getUsageStats() ETIMEDOUT + usage session 스팸
- [x] RULE 1 Write/Edit 차단 제거
- [x] session-end Obsidian sync 버그 (transcript 없으면 sync 안 됨)
- [x] notepad.json 148KB bloat → 자동 정리 로직 추가
- [x] knowledge session-summary 중복 (x60) → 30개 제한
- [x] zombie 프로세스 방지 (watchdog cron + timeout)
- [x] morning briefing 7x 폭발 → timeout + max-turns 제한

### 남은 구조적 문제
- 다중 sc-bridge 인스턴스 = cron 중복 실행 (아직 미해결)
- SessionEnd 인터랙티브 세션에서 동작 확인 필요 (진단 로그 추가함)
- learnings 966개 — 유용한 것만 필터링 필요
- 에이전트 29개 있지만 실제 활용도 낮음

## Phase 1: 안정화 (1-2일)

### 1.1 Cron 중복 실행 방지
- sc-bridge에 cron 리더 선출 로직 추가 (lock file 또는 PID 기반)
- 또는: cron을 sc-bridge가 아닌 시스템 crontab에서 실행

### 1.2 SessionEnd 동작 확인
- 진단 로그로 인터랙티브 세션에서 실제 호출되는지 확인
- 안 되면 Stop 훅으로 대체 (PreCompact도 가능)

### 1.3 메모리 관리 자동화
- session-start에서 자동 정리: working entries 10개 제한 ✅
- session-end에서 중복 learning 방지 (content hash 체크) ✅
- knowledge session-summary 30개 제한 ✅

## Phase 2: 스마트 라우팅 (3-5일)

### 2.1 요청 분류기
keyword-detector.mjs를 강화하여 요청을 자동 분류:

```
IT/개발 → { team: [sc-architect, sc-junior, sc-test-engineer, sc-code-reviewer] }
연구/논문 → { team: [paper-reader, literature-reviewer, research-assistant] }
시스템/자동화 → { team: [system-monitor, cron-mgr, pipeline-builder] }
일상/Mac 제어 → { team: [mac-control, telegram-control] }
디버깅 → { team: [sc-debugger, sc-architect, sc-performance] }
```

### 2.2 팀 자동 구성
ultrawork 스킬에서 요청 분류 결과를 받아 적절한 에이전트 팀을 자동 구성.
OMC의 Swarm 패턴 참고하되, 더 단순하게:
- 요청 → 분류 → 팀 선택 → 에이전트 병렬 실행 → 결과 통합

### 2.3 모델 비용 최적화 (ecomode)
- 기본: haiku (간단한 lookup, 상태 확인)
- 표준: sonnet (코드 작성, 분석)
- 복잡: opus (아키텍처, 디버깅, 보안)
- 카테고리별 기본 모델 매핑 테이블

## Phase 3: 사용자 경험 (3-5일)

### 3.1 제로 설정 부트스트랩
Superpowers처럼 설치 직후 자동으로 동작해야 함:
- Telegram 설정 = 선택적 (없어도 핵심 기능 동작)
- Peekaboo 설정 = 자동 감지
- Memory DB = 자동 생성

### 3.2 Stop 훅 연속 강제 (시시포스 패턴)
OMC에서 배운 것:
- ultrawork/ralph 모드에서 상태 파일로 세션 종료 차단
- /cancel 커맨드로만 종료 가능
- 구현: `.sc/state/ultrawork-state.json` 존재하면 Stop 훅에서 block

### 3.3 HUD 개선
현재 statusline은 있지만 최소한의 정보만 표시:
- 에이전트 상태 추가 (spawned/running/completed)
- 메모리 DB 용량
- 최근 cron 실행 결과

### 3.4 매직 키워드 확장
현재: "ulw" → ultrawork
추가할 것:
- "briefing" → morning-brief 실행
- "memo" → sc_memory_store 자동 호출
- "remind" → cron 스케줄 추가
- "research" → 논문 분석 파이프라인
- "debug" → sc-debugger-high 자동 위임

## Phase 4: 차별화 강화 (1-2주)

### 4.1 Telegram Daemon 안정화
- 메시지 큐 persist (현재 메모리만)
- 재시작 시 마지막 처리 offset 복원
- 에러 시 자동 재연결

### 4.2 Mac 에이전트 강화
- Peekaboo 호출 시 자동 재시도 (stuck 방지)
- 화면 잠금 감지 → 자동 스킵
- Vision 기반 UI 이해 개선

### 4.3 Knowledge Graph 활용
- 현재: store/search만 가능
- 추가: 자동 관계 추론, 중복 감지, 갈등 해결
- Obsidian 동기화를 session-end에서 확실히 실행 ✅

### 4.4 검증 시스템 강화
- sc_verification_log 자동 분석
- 반복 실패 패턴 감지 → 자동 에스컬레이션
- 신뢰도 기반 에이전트 라우팅

## 우선순위 매트릭스

| 우선순위 | 항목 | 영향도 | 난이도 | 상태 |
|----------|------|--------|--------|------|
| P0 | 버그 수정 (zombie, spam, bloat) | 높음 | 낮음 | ✅ 완료 |
| P0 | notepad/DB 자동 정리 | 높음 | 낮음 | ✅ 완료 |
| P1 | cron 중복 실행 방지 | 높음 | 중간 | 미착수 |
| P1 | Stop 훅 시시포스 패턴 | 높음 | 낮음 | 미착수 |
| P2 | 스마트 라우팅 | 중간 | 중간 | 미착수 |
| P2 | ecomode | 중간 | 낮음 | 미착수 |
| P3 | 제로 설정 부트스트랩 | 중간 | 높음 | 미착수 |
| P3 | Telegram Daemon 안정화 | 중간 | 중간 | 미착수 |
| P4 | Knowledge Graph 자동 추론 | 낮음 | 높음 | 미착수 |
