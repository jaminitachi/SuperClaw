# SuperClaw Delegation Routing

## Agent Selection Guide

When a task involves SuperClaw's domain, delegate to SuperClaw specialist agents. v4 consolidates 29 agents into 10 focused roles.

### v4 Agent Roster

| Agent File | Role | Model | Consolidates |
|-----------|------|-------|-------------|
| dev-architect | Architecture, planning, code review, security, performance | opus | sc-architect, sc-metis, sc-prometheus, sc-momus, sc-code-reviewer, sc-security-reviewer, sc-performance |
| dev-backend | Backend implementation, debugging | sonnet | sc-junior, sc-debugger |
| dev-frontend | Frontend/UI implementation | sonnet | sc-frontend |
| dev-qa | Test strategy and writing | sonnet | sc-test-engineer |
| research-reviewer | Paper reading, lit review, research code review, data analysis, experiments | opus | paper-reader, literature-reviewer, research-code-reviewer, data-analyst, experiment-tracker |
| research-writer | Academic writing | opus | (new) |
| research-assistant | Citations, BibTeX, quick lookups | haiku | (unchanged) |
| infra-monitor | System monitoring, heartbeat, cron, pipeline, workflow | haiku/sonnet | system-monitor, heartbeat-mgr, cron-mgr, pipeline-builder, workflow-monitor |
| infra-mac | macOS UI automation, screenshots | sonnet | mac-control |
| verify | Operations verification | sonnet | sc-verifier |

### Routing Table

| Task Pattern | Delegate To | Model | Notes |
|-------------|-------------|-------|-------|
| Architecture analysis (quick or deep) | superclaw:dev-architect | haiku / opus | haiku for structure checks, opus for deep analysis |
| Strategic planning | superclaw:dev-architect | opus | |
| Gap analysis / plan validation | superclaw:dev-architect | opus | |
| Code review (quick or thorough) | superclaw:dev-architect | haiku / opus | haiku for simple changes, opus for full review |
| Security review (scan or audit) | superclaw:dev-architect | haiku / opus | haiku for secret scanning, opus for OWASP analysis |
| Performance analysis | superclaw:dev-architect | sonnet / opus | sonnet for hotspots, opus for distributed |
| Backend implementation | superclaw:dev-backend | sonnet | |
| Quick code changes | superclaw:dev-backend | haiku | |
| Bug debugging (standard or complex) | superclaw:dev-backend | sonnet / opus | sonnet for standard bugs, opus for concurrency/cross-system |
| Gateway debugging | superclaw:dev-backend | sonnet | |
| Frontend/UI implementation | superclaw:dev-frontend | sonnet | |
| Test strategy/writing | superclaw:dev-qa | sonnet | |
| Read single paper | superclaw:research-reviewer | sonnet | |
| Multi-paper synthesis | superclaw:research-reviewer | opus | |
| Log experiment | superclaw:research-reviewer | sonnet | |
| Academic code review | superclaw:research-reviewer | opus | |
| Metrics analysis | superclaw:research-reviewer | sonnet | |
| Quick citation/BibTeX | superclaw:research-assistant | haiku | |
| Academic writing | superclaw:research-writer | opus | |
| Mac automation (simple or complex) | superclaw:infra-mac | haiku / sonnet | haiku for screenshots/app launch, sonnet for multi-step UI |
| System monitoring (quick or deep) | superclaw:infra-monitor | haiku / sonnet | haiku for health checks, sonnet for deep investigation |
| Heartbeat config | superclaw:infra-monitor | haiku | |
| Cron management | superclaw:infra-monitor | haiku | |
| Pipeline design (simple or complex) | superclaw:infra-monitor | sonnet / opus | sonnet for linear pipelines, opus for cross-system orchestration |
| Track pipeline execution | superclaw:infra-monitor | haiku | |
| Verify SC operations | superclaw:verify | sonnet | |

### Keyword-to-Agent Mapping

| User Says | Agent | Model |
|-----------|-------|-------|
| "screenshot", "take picture" | infra-mac | haiku |
| "click on", "type into", "automate" | infra-mac | sonnet |
| "heartbeat", "system health" | infra-monitor | haiku |
| "deep system investigation" | infra-monitor | sonnet |
| "schedule", "cron", "every" | infra-monitor | haiku |
| "pipeline", "morning brief" | infra-monitor | sonnet |
| "complex pipeline", "cross-system orchestration" | infra-monitor | opus |
| "telegram", "send to phone" | (skill: telegram-control) | - |
| "read paper", "arxiv" | research-reviewer | sonnet |
| "literature review" | research-reviewer | opus |
| "experiment", "log results" | research-reviewer | sonnet |
| "citation", "bibtex" | research-assistant | haiku |
| "analyze data", "metrics" | research-reviewer | sonnet |
| "check PRs", "CI status" | (skill: dev-workflow) | - |

### Task Mapping for General Development

| Task Type | SuperClaw Agent | Model |
|-----------|----------------|-------|
| General code implementation | superclaw:dev-backend | sonnet |
| Quick code changes | superclaw:dev-backend | haiku |
| Documentation writing | superclaw:dev-backend | haiku |
| Strategic planning | superclaw:dev-architect | opus |
| Architecture analysis | superclaw:dev-architect | opus |
| Quick exploration | superclaw:dev-architect | haiku |
| Plan validation/critique | superclaw:dev-architect | sonnet |
| Complex multi-file change | superclaw:dev-architect | opus |

### Team-Based Orchestration (PO + Agents)

| Role | Agent | Model | Responsibility |
|------|-------|-------|----------------|
| PO (Product Owner) | ultrawork skill (main context) | opus | 유저 의도 판단, 팀 구성, 결과 리뷰, 피드백 캐스케이드 |
| Architect | superclaw:dev-architect | opus | 아키텍처 결정, 코드 리뷰, 계획 검증 |
| Backend | superclaw:dev-backend | sonnet | 구현, 디버깅 |
| Frontend | superclaw:dev-frontend | sonnet | UI/UX 구현 |
| QA | superclaw:dev-qa | sonnet | 테스트 작성, 검증 |
| Verifier | superclaw:verify | sonnet | 독립 검증 |

PO dispatches agents directly. No separate Team Lead layer in v4.

### SuperClaw Execution Modes

SuperClaw has its own ultrawork mode for parallel agent execution:
- **ultrawork (team mode)**: PO dispatches agents directly in parallel. Flat hierarchy.
- **ultrawork (flat mode)**: For simple tasks (1-3 files), PO dispatches dev-backend directly.
- **ultrawork --opus**: 모든 에이전트를 opus 모델로 강제 실행 (haiku/sonnet 라우팅 무시)
- **verification**: All tasks verified by verify agent before completion

### Fact Verification Protocol (ALL agents MUST follow)

When making claims about external tools, APIs, or libraries, follow these 3 steps:

1. **Code is Source of Truth** -- Read the actual code before making claims about tool behavior.
   - CLI tool capabilities -> run `<tool> --help` or read source code
   - API behavior -> check SDK source or run an actual test call
   - "I learned this from training data" is NOT a valid source
   - Example: what can `codex exec` do? -> run `codex exec --help` or test it directly

2. **Cross-reference with official docs via WebFetch** -- Never rely solely on training data.
   - Fetch the tool/library's official documentation with WebFetch and cross-check
   - Version changes, new features, and deprecations may not be in training data
   - Tools updated within the last 6 months MUST be verified against official pages

3. **Show your sources, don't just say "correct"** -- Let the user judge for themselves.
   - Every claim must include evidence: code path, command output, or official doc URL
   - "I think", "probably", "likely" are banned -> if unverified, say "needs verification"
   - The higher the cost of being wrong, the stronger the verification required

Scope: All SuperClaw agents (dev-architect, dev-backend, dev-frontend, etc.)
Violation: Agent results are untrusted; PO must re-verify or re-run.

### Memory System Rules

**DO NOT call sc_learning_store during ULW/ultrawork execution.**
- Learnings are automatically extracted by the session-end hook (Haiku LLM extraction from transcript).
- Calling sc_learning_store directly pollutes the DB with low-quality entries.
- Exception: explicit user request to store a specific insight.
- The session-end hook detects the project from transcript_path and tags accordingly.
- Weekly consolidation cron compresses raw learnings into project-based digests.

**Memory loading hierarchy (session-start):**
1. Core digest (per-project, evergreen)
2. Recent weekly-digests (per-project, unarchived)
3. Recent unarchived learnings (per-project, last 10)
4. Always includes "general" project content.

### Opus Override Mode

Triggered by: `ulw --opus`, `ultrawork opus`, `전부 opus`, `모두 opus`, `opus로`

When active:
- ALL agent dispatches use `model: "opus"` regardless of routing table
- `[OPUS OVERRIDE]` tag is injected into every agent prompt
- PO propagates the override to all sub-dispatches
- Category routing model selection is bypassed (agent selection still applies)
- Cost: significantly higher token usage -- use only when maximum reasoning quality needed
