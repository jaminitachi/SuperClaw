# SuperClaw Delegation Routing

## Agent Selection Guide

When a task involves SuperClaw's domain, delegate to SuperClaw agents instead of generic OMC agents.

### Routing Table

| Task Pattern | Delegate To | Model | Tier |
|-------------|-------------|-------|------|
| Simple screenshot, app launch | superclaw:mac-control-low | haiku | LOW |
| Multi-step UI automation | superclaw:mac-control | sonnet | MEDIUM |
| Quick memory lookup | superclaw:memory-curator-low | haiku | LOW |
| Store/curate knowledge | superclaw:memory-curator | sonnet | MEDIUM |
| Complex graph reasoning | superclaw:memory-curator-high | opus | HIGH |
| Build simple pipeline | superclaw:pipeline-builder | sonnet | MEDIUM |
| Cross-system orchestration | superclaw:pipeline-builder-high | opus | HIGH |
| Heartbeat config | superclaw:heartbeat-mgr | haiku | LOW |
| Cron management | superclaw:cron-mgr | haiku | LOW |
| Quick system check | superclaw:system-monitor | haiku | LOW |
| Deep system investigation | superclaw:system-monitor-high | sonnet | MEDIUM |
| Gateway debugging | superclaw:gateway-debugger | sonnet | MEDIUM |
| Metrics analysis | superclaw:data-analyst | sonnet | MEDIUM |
| Verify SC operations | superclaw:sc-verifier | sonnet | MEDIUM |
| Installation check | superclaw:setup-validator | haiku | LOW |
| Track pipeline execution | superclaw:workflow-monitor | haiku | LOW |
| Read single paper | superclaw:paper-reader | sonnet | MEDIUM |
| Multi-paper synthesis | superclaw:literature-reviewer | opus | HIGH |
| Log experiment | superclaw:experiment-tracker | sonnet | MEDIUM |
| Quick citation/BibTeX | superclaw:research-assistant | haiku | LOW |
| Academic code review | superclaw:research-code-reviewer | opus | HIGH |
| Skill auto-generation | superclaw:skill-forger | sonnet | MEDIUM |

### Keyword-to-Agent Mapping

| User Says | Primary Agent | Fallback |
|-----------|---------------|----------|
| "screenshot", "take picture" | mac-control-low | mac-control |
| "click on", "type into", "automate" | mac-control | mac-control-low |
| "remember", "store", "save" | memory-curator | memory-curator-low |
| "search memory", "recall" | memory-curator-low | memory-curator |
| "heartbeat", "system health" | system-monitor | system-monitor-high |
| "schedule", "cron", "every" | cron-mgr | - |
| "pipeline", "morning brief" | pipeline-builder | pipeline-builder-high |
| "telegram", "send to phone" | (skill: telegram-control) | - |
| "read paper", "arxiv" | paper-reader | - |
| "literature review" | literature-reviewer | paper-reader |
| "experiment", "log results" | experiment-tracker | - |
| "citation", "bibtex" | research-assistant | - |
| "analyze data", "metrics" | data-analyst | - |
| "check PRs", "CI status" | (skill: dev-workflow) | - |
| "setup superclaw" | setup-validator | - |

### Developer Tools Domain

| Task Pattern | Agent | Model | Priority |
|-------------|-------|-------|----------|
| Architecture design/review | superclaw:sc-architect | opus | HIGH |
| Quick structure check | superclaw:sc-architect-low | haiku | LOW |
| Frontend/UI implementation | superclaw:sc-frontend | sonnet | MEDIUM |
| Code review (thorough) | superclaw:sc-code-reviewer | opus | HIGH |
| Code review (quick) | superclaw:sc-code-reviewer-low | haiku | LOW |
| Security vulnerability scan | superclaw:sc-security-reviewer | opus | HIGH |
| Secret scanning (quick) | superclaw:sc-security-reviewer-low | haiku | LOW |
| Bug debugging | superclaw:sc-debugger | sonnet | MEDIUM |
| Complex debugging | superclaw:sc-debugger-high | opus | HIGH |
| Test strategy/writing | superclaw:sc-test-engineer | sonnet | MEDIUM |
| Performance analysis | superclaw:sc-performance | sonnet | MEDIUM |
| Complex performance | superclaw:sc-performance-high | opus | HIGH |

### OMC Fallback Rules

When a task falls outside SuperClaw's domain (general software development without SC-specific integration):

| Task | Fallback Agent | Model |
|------|---------------|-------|
| General code implementation | oh-my-claudecode:executor | sonnet |
| Documentation writing | oh-my-claudecode:writer | haiku |
| General planning | oh-my-claudecode:planner | opus |
| General exploration | oh-my-claudecode:explore | haiku |
| Critical analysis | oh-my-claudecode:critic | opus |

### Integration with OMC Modes

SuperClaw agents participate in OMC modes:
- **autopilot**: Can include heartbeat setup in deployment phase
- **ralph**: SuperClaw operations continue until verified
- **ultrawork**: SC agents run in parallel with OMC agents
- **ecomode**: SC agents follow tier routing (haiku first, escalate on failure)

### Naming Collision Resolution

| Term | SuperClaw Meaning | OMC Meaning |
|------|-------------------|-------------|
| "pipeline" | Data automation pipeline (morning-brief, deploy-monitor) | Agent chaining mode |
| "memory" | SQLite knowledge graph (sc_memory_*) | Notepad/project-memory |
| "skill" | Workflow template (SKILL.md) | Same |

To disambiguate: "automation pipeline" = SC, "agent pipeline" = OMC. "SC memory" = SQLite, "notepad" = OMC.
