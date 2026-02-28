# SuperClaw Delegation Routing

## Agent Selection Guide

When a task involves SuperClaw's domain, delegate to SuperClaw specialist agents. Complexity is controlled by the `model` parameter (haiku/sonnet/opus), not by separate agent names.

### Routing Table

| Task Pattern | Delegate To | Model | Notes |
|-------------|-------------|-------|-------|
| Mac automation (simple or complex) | superclaw:mac-control | haiku / sonnet | haiku for screenshots/app launch, sonnet for multi-step UI |
| Memory operations (lookup to synthesis) | superclaw:memory-curator | haiku / sonnet / opus | haiku for lookups, sonnet for curation, opus for reasoning |
| Pipeline design (simple or complex) | superclaw:pipeline-builder | sonnet / opus | sonnet for linear pipelines, opus for cross-system orchestration |
| Heartbeat config | superclaw:heartbeat-mgr | haiku | |
| Cron management | superclaw:cron-mgr | haiku | |
| System monitoring (quick or deep) | superclaw:system-monitor | haiku / sonnet | haiku for health checks, sonnet for deep investigation |
| Gateway debugging | superclaw:gateway-debugger | sonnet | |
| Metrics analysis | superclaw:data-analyst | sonnet | |
| Verify SC operations | superclaw:sc-verifier | sonnet | |
| Installation check | superclaw:setup-validator | haiku | |
| Track pipeline execution | superclaw:workflow-monitor | haiku | |
| Read single paper | superclaw:paper-reader | sonnet | |
| Multi-paper synthesis | superclaw:literature-reviewer | opus | |
| Log experiment | superclaw:experiment-tracker | sonnet | |
| Quick citation/BibTeX | superclaw:research-assistant | haiku | |
| Academic code review | superclaw:research-code-reviewer | opus | |
| Skill auto-generation | superclaw:skill-forger | sonnet | |

### Keyword-to-Agent Mapping

| User Says | Agent | Model |
|-----------|-------|-------|
| "screenshot", "take picture" | mac-control | haiku |
| "click on", "type into", "automate" | mac-control | sonnet |
| "remember", "store", "save" | memory-curator | sonnet |
| "search memory", "recall" | memory-curator | haiku |
| "complex graph reasoning", "synthesize knowledge" | memory-curator | opus |
| "heartbeat", "system health" | system-monitor | haiku |
| "deep system investigation" | system-monitor | sonnet |
| "schedule", "cron", "every" | cron-mgr | haiku |
| "pipeline", "morning brief" | pipeline-builder | sonnet |
| "complex pipeline", "cross-system orchestration" | pipeline-builder | opus |
| "telegram", "send to phone" | (skill: telegram-control) | - |
| "read paper", "arxiv" | paper-reader | sonnet |
| "literature review" | literature-reviewer | opus |
| "experiment", "log results" | experiment-tracker | sonnet |
| "citation", "bibtex" | research-assistant | haiku |
| "analyze data", "metrics" | data-analyst | sonnet |
| "check PRs", "CI status" | (skill: dev-workflow) | - |
| "setup superclaw" | setup-validator | haiku |

### Developer Tools Domain

| Task Pattern | Agent | Model | Notes |
|-------------|-------|-------|-------|
| Architecture analysis (quick or deep) | superclaw:sc-architect | haiku / opus | haiku for structure checks, opus for deep analysis |
| Frontend/UI implementation | superclaw:sc-frontend | sonnet | |
| Code review (quick or thorough) | superclaw:sc-code-reviewer | haiku / opus | haiku for simple changes, opus for full review |
| Security review (scan or audit) | superclaw:sc-security-reviewer | haiku / opus | haiku for secret scanning, opus for OWASP analysis |
| Bug debugging (standard or complex) | superclaw:sc-debugger | sonnet / opus | sonnet for standard bugs, opus for concurrency/cross-system |
| Test strategy/writing | superclaw:sc-test-engineer | sonnet | |
| Performance analysis (standard or deep) | superclaw:sc-performance | sonnet / opus | sonnet for hotspots, opus for concurrency/GPU/distributed |

### Task Mapping for General Development

When a task falls outside SuperClaw's specialized domain, use these agent mappings:

| Task Type | SuperClaw Agent | Model |
|-----------|----------------|-------|
| General code implementation | superclaw:sc-atlas | sonnet |
| Quick code changes | superclaw:sc-junior | haiku |
| Documentation writing | superclaw:sc-junior | haiku |
| Strategic planning | superclaw:sc-prometheus | opus |
| Architecture analysis | superclaw:sc-architect | opus |
| Quick exploration | superclaw:sc-architect | haiku |
| Plan validation/critique | superclaw:sc-momus | sonnet |

### SuperClaw Execution Modes

SuperClaw has its own ultrawork mode for parallel agent execution:
- **ultrawork**: Multiple SC agents run concurrently on task pool
- **orchestration**: sc-prometheus (planner) -> sc-metis (coordinator) -> sc-atlas/sc-junior (workers)
- **verification**: All tasks verified by sc-verifier before completion
