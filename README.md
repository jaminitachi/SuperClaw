# SuperClaw

Claude Code plugin for agentic Mac automation, persistent memory, Telegram remote control, and multi-agent orchestration.

## What It Does

SuperClaw turns Claude Code into a full autonomous workstation. One request auto-composes the right team of agents, executes in parallel, and verifies results independently.

- **41 MCP tools** across 3 servers (bridge, peekaboo, memory)
- **29 specialized agents** with 3-tier model routing (haiku / sonnet / opus)
- **15 skills** with keyword auto-detection (Korean + English)
- **9 lifecycle hooks** for context injection, tool enforcement, and session persistence
- **Smart team routing** — complex requests auto-compose multi-agent teams
- **Sisyphus pattern** — blocks session exit until autonomous tasks complete
- **Obsidian sync** — exports memory to interconnected markdown with `[[wikilinks]]`

## Quick Start

```bash
# Clone
git clone https://github.com/jaminitachi/SuperClaw.git ~/superclaw
cd ~/superclaw

# One-command setup
npm run setup

# Launch Claude Code — SuperClaw loads automatically
claude
```

The setup wizard handles everything:
1. Installs Peekaboo (Mac automation) and SoX (audio)
2. Installs dependencies and builds 3 MCP servers
3. Configures Telegram bot (optional, interactive)
4. Registers as a permanent Claude Code plugin

## Architecture

```
                         ┌─────────────────────────────────┐
                         │        Claude Code Session       │
                         │                                  │
                         │  ┌────────────────────────────┐  │
                         │  │     9 Lifecycle Hooks       │  │
                         │  │  keyword-detector (prompt)  │  │
                         │  │  session-start / session-end│  │
                         │  │  pre-tool / post-tool       │  │
                         │  │  subagent-tracker           │  │
                         │  │  persistent (Sisyphus)      │  │
                         │  │  pre-compact                │  │
                         │  └────────────────────────────┘  │
                         │                                  │
                         │  ┌────────────────────────────┐  │
                         │  │     29 Specialist Agents    │  │
                         │  │  Orchestration: prometheus, │  │
                         │  │    metis, momus, atlas      │  │
                         │  │  Dev: architect, debugger,  │  │
                         │  │    reviewer, test-engineer  │  │
                         │  │  Research: paper-reader,    │  │
                         │  │    lit-reviewer, data-analyst│  │
                         │  │  Infra: mac-control, cron,  │  │
                         │  │    pipeline, memory-curator │  │
                         │  └────────────────────────────┘  │
                         └──────────┬───────────────────────┘
                                    │ MCP (stdio)
                    ┌───────────────┼───────────────┐
                    │               │               │
             ┌──────┴──────┐ ┌─────┴──────┐ ┌──────┴──────┐
             │  sc-bridge  │ │ sc-peekaboo│ │  sc-memory  │
             │  8 tools    │ │  15 tools  │ │  18 tools   │
             │             │ │            │ │             │
             │ Telegram    │ │ Screenshot │ │ SQLite+FTS5 │
             │ Cron sched. │ │ UI inspect │ │ Knowledge   │
             │ Status      │ │ Click/type │ │  graph      │
             │ Routing     │ │ App mgmt   │ │ Obsidian    │
             └──────┬──────┘ │ AppleScript│ │  sync       │
                    │        │ OCR        │ │ Learnings   │
          ┌─────────┴─┐      └─────┬──────┘ │ Verification│
          │ Telegram   │           │        └─────────────┘
          │ Bot API    │     ┌─────┴──────┐
          └────────────┘     │  Peekaboo  │
                             │ (Homebrew) │
                             └────────────┘
```

### Data Flow Example

```
User: "이 버그 고쳐줘" (Fix this bug)

1. UserPromptSubmit hook detects "고쳐" + "버그" → Debug Team
2. Team composition injected:
   - sc-debugger (sonnet): Root cause analysis
   - sc-architect (opus): Architecture context
   - sc-test-engineer (sonnet): Reproduce & verify
3. Agents execute in parallel
4. Stop hook blocks exit until work complete (Sisyphus)
5. Results verified independently before reporting
```

## MCP Tools (41)

### sc-bridge (8 tools)
| Tool | Description |
|------|-------------|
| `sc_send_message` | Send Telegram message |
| `sc_telegram_inbox` | Get recent incoming messages |
| `sc_telegram_status` | Bot connection status |
| `sc_route_command` | Internal command router |
| `sc_status` | System-wide health check |
| `sc_cron_list` | List scheduled jobs |
| `sc_cron_add` | Add cron job (5-field expression) |
| `sc_cron_remove` | Remove cron job by name |

### sc-peekaboo (15 tools)
| Tool | Description |
|------|-------------|
| `sc_screenshot` | Capture screen/window |
| `sc_see` | Inspect UI elements |
| `sc_click` | Click element or coordinates |
| `sc_type` | Type text at cursor |
| `sc_hotkey` | Press keyboard shortcut |
| `sc_ocr` | Extract text from screen |
| `sc_app_launch` | Launch/activate app |
| `sc_app_quit` | Quit app |
| `sc_app_list` | List running apps |
| `sc_app_frontmost` | Get focused app |
| `sc_window_list` | List app windows |
| `sc_window_move` | Reposition window |
| `sc_window_resize` | Resize window |
| `sc_osascript` | Execute AppleScript/JXA |
| `sc_notify` | Send macOS notification |

### sc-memory (18 tools)
| Tool | Description |
|------|-------------|
| `sc_memory_store` | Store knowledge with category/confidence |
| `sc_memory_search` | FTS5 full-text search (progressive disclosure) |
| `sc_memory_recall` | Recall by ID or category |
| `sc_memory_delete` | Delete from any table |
| `sc_memory_graph_query` | Query entity relationships |
| `sc_memory_add_entity` | Add/update knowledge graph entity |
| `sc_memory_add_relation` | Create entity relationship |
| `sc_memory_log_conversation` | Log conversation for history |
| `sc_memory_stats` | Database statistics |
| `sc_memory_session_history` | Past session listing |
| `sc_learning_store` | Store learning (7 categories) |
| `sc_learning_recall` | Recall learnings by filter |
| `sc_learning_summary` | Category-grouped summary |
| `sc_verification_log` | Log claimed vs verified results |
| `sc_obsidian_sync` | Export to Obsidian vault with wikilinks |
| `sc_notepad_write` | Cross-session scratchpad write |
| `sc_notepad_read` | Read scratchpad memos |
| `sc_notepad_clear` | Clear scratchpad entries |

## Agents (29)

### Orchestration
| Agent | Model | Role |
|-------|-------|------|
| `sc-prometheus` | opus | Strategic planning, requirements discovery |
| `sc-metis` | opus | Gap analysis, catches hidden assumptions |
| `sc-momus` | sonnet | Plan validation and critique |
| `sc-atlas` | opus | Execution orchestration, worker coordination |
| `sc-junior` | sonnet | Task execution, atomic operations |

### Development
| Agent | Model | Role |
|-------|-------|------|
| `sc-architect` | opus | Architecture analysis and design |
| `sc-code-reviewer` | opus | Code review with issue tracking |
| `sc-security-reviewer` | opus | OWASP vulnerability detection |
| `sc-debugger` | sonnet | Root cause analysis, bug patterns |
| `sc-debugger-high` | opus | Concurrency, cross-system bugs |
| `sc-test-engineer` | sonnet | Test strategy, coverage tracking |
| `sc-performance` | sonnet | Hotspot identification, benchmarks |
| `sc-performance-high` | opus | GPU, distributed system profiling |
| `sc-frontend` | sonnet | UI/UX for data dashboards |

### Research
| Agent | Model | Role |
|-------|-------|------|
| `paper-reader` | sonnet | Paper extraction and analysis |
| `literature-reviewer` | opus | Multi-paper synthesis |
| `experiment-tracker` | sonnet | Experiment logging |
| `research-assistant` | haiku | Citations, BibTeX |
| `research-code-reviewer` | opus | Reproducibility review |
| `data-analyst` | sonnet | Metrics and visualization |

### Infrastructure
| Agent | Model | Role |
|-------|-------|------|
| `mac-control` | sonnet | macOS UI automation |
| `memory-curator` | sonnet | Knowledge graph curation |
| `gateway-debugger` | sonnet | Telegram diagnostics |
| `system-monitor` | haiku | System health checks |
| `heartbeat-mgr` | haiku | Monitoring configuration |
| `cron-mgr` | haiku | Scheduled task management |
| `pipeline-builder` | sonnet | Workflow automation |
| `workflow-monitor` | haiku | Pipeline execution tracking |
| `skill-forger` | sonnet | Auto-generate new skills |
| `setup-validator` | haiku | Installation verification |
| `sc-verifier` | sonnet | Operations verification |

## Skills (15)

| Skill | Trigger Keywords | Description |
|-------|-----------------|-------------|
| `telegram-control` | "send to phone", "텔레그램" | Telegram messaging |
| `mac-control` | "screenshot", "click on", "앱 열어" | Mac UI automation |
| `memory-mgr` | "remember this", "기억해" | Persistent knowledge |
| `heartbeat` | "system health", "상태 확인" | Proactive monitoring |
| `automation-pipeline` | "pipeline", "자동화" | Composable workflows |
| `cron-mgr` | "schedule", "매일" | Cron job management |
| `setup` | "setup superclaw", "설정" | Installation wizard |
| `skill-forge` | "create skill", "스킬 만들" | Auto-generate skills |
| `paper-review` | "read paper", "논문" | Paper analysis |
| `experiment-log` | "log experiment", "실험" | Experiment tracking |
| `lit-review` | "literature review", "문헌 조사" | Multi-paper synthesis |
| `research-analysis` | "analyze data", "통계" | Statistical analysis |
| `dev-workflow` | "check PRs", "PR 확인" | Developer productivity |
| `tts` | n/a | Text-to-speech generation |
| `ultrawork` | "ulw", "다 해줘" | Autonomous execution loop |

## Smart Team Routing (v3)

Complex requests auto-compose multi-agent teams:

| Request Pattern | Team | Agents |
|----------------|------|--------|
| "앱 만들어" / "build a service" | Dev Team | architect + junior + test-engineer + code-reviewer |
| "논문 조사해" / "research papers" | Research Team | paper-reader + lit-reviewer + research-assistant + data-analyst |
| "리팩토링해" / "refactor this" | Refactor Team | architect + junior + test-engineer |
| "버그 고쳐" / "fix this bug" | Debug Team | debugger + architect + test-engineer |
| "배포해" / "deploy to production" | Deploy Team | security-reviewer + code-reviewer + test-engineer |

**Ecomode**: Automatic model tier selection based on task complexity.
- Simple lookups → haiku ($)
- Standard implementation → sonnet ($$)
- Architecture/security → opus ($$$)

## Hooks (9)

| Hook | Event | Purpose |
|------|-------|---------|
| `sc-keyword-detector` | UserPromptSubmit | Detect keywords → auto-invoke skills and compose teams |
| `session-start` | SessionStart | Load memory context, recent learnings, notepad cleanup |
| `session-end` | SessionEnd | Extract learnings, Obsidian sync, session summary |
| `sc-pre-tool` | PreToolUse | Model suggestions, tool reminders |
| `sc-post-tool` | PostToolUse | Failure detection, circuit breaker, ultrawork verification |
| `sc-subagent-tracker` | SubagentStart/Stop | Track agent lifecycle |
| `sc-persistent` | Stop | Sisyphus — block exit when autonomous tasks active |
| `pre-compact` | PreCompact | Save context before compression |

## Commands (4)

| Command | Description |
|---------|-------------|
| `/sc-status` | System health dashboard |
| `/sc-screenshot` | Quick screenshot with analysis |
| `/sc-memory <query>` | Search memory database |
| `/sc-heartbeat` | Run health check |

## Ultrawork Mode

Autonomous execution that iterates until completion conditions are met.

```
User: "ulw 이 기능 전부 구현해줘"

Phase 0: Understand → extract completion conditions
Phase 1: Plan → decompose tasks, assign agents
Phase 2: Execute → parallel dispatch → verify → learn → repeat
Phase 3: Report → evidence-based completion report
```

- **Sisyphus**: Stop hook blocks session exit while ultrawork is active
- **Independent verification**: Never trusts agent claims — reads files, runs tests directly
- **Learning accumulation**: Each iteration's failures inform the next
- **Circuit breaker**: 3 consecutive failures → escalate to architectural review

## Persistent Memory

SQLite database with FTS5 full-text search and knowledge graph.

### Tables
- **knowledge** — Categorized facts with confidence scores
- **entities** — Knowledge graph nodes (projects, technologies, people)
- **relations** — Entity relationships (uses, depends-on, created-by)
- **learnings** — Accumulated insights across sessions (7 categories)
- **conversations** — Cross-session conversation history
- **verification_log** — Claimed vs verified results
- **skill_metrics** — Skill usage tracking

### Progressive Disclosure
Search results show truncated previews (200 chars) with guidance to use `sc_memory_recall(id=N)` for full content. Saves tokens while maintaining discoverability.

### Obsidian Sync
Exports entire memory to an Obsidian vault with:
- YAML frontmatter on every note
- `[[wikilinks]]` auto-injected for entity cross-references
- Index files (Knowledge Map, Entity Map, All Learnings, Graph Stats)
- Incremental sync (only exports changes since last sync)

## Cron Scheduler

Built-in cron with 5-field expressions, cross-process lock files, and idle-aware execution.

```
# Examples
sc_cron_add("morning-brief", "0 9 * * 1-5", "pipeline:morning-brief")
sc_cron_add("backup", "0 3 * * *", "tar -czf ~/backup.tar.gz ~/superclaw/data")
```

Features:
- Cross-process lock files prevent duplicate execution across multiple sc-bridge instances
- `requiresIdle` option skips job when user is actively using Mac
- 5-minute timeout with process group kill
- Jobs persist to `data/cron-jobs.json`

## HUD (Status Line)

14-element status line showing real-time session info:
- Model, permission mode, git branch
- Active agents and task counts
- Context usage with warnings
- Session cost estimate
- Thinking indicator

## Configuration

`~/superclaw/superclaw.json`:

```json
{
  "telegram": {
    "enabled": true,
    "botToken": "YOUR_BOT_TOKEN",
    "allowFrom": ["YOUR_CHAT_ID"],
    "defaultChatId": "YOUR_CHAT_ID"
  },
  "heartbeat": {
    "enabled": true,
    "intervalSeconds": 300,
    "collectors": ["system", "process", "github"]
  },
  "memory": {
    "dbPath": "data/memory.db"
  },
  "peekaboo": {
    "path": "/opt/homebrew/bin/peekaboo"
  },
  "obsidian": {
    "vaultPath": "~/obsidian/superclaw-brain",
    "autoSync": true,
    "syncOn": ["session_end"],
    "include": ["knowledge", "entities", "conversations"]
  }
}
```

## Prerequisites

- **Node.js** 22+
- **macOS** (for Peekaboo; memory/pipeline features work on any OS)

## Development

```bash
npm install          # Install dependencies
npm run build        # Build 3 MCP servers
npm run build:watch  # Watch mode
npm run typecheck    # TypeScript check
npm test             # Run tests
npm run qa           # Full QA pipeline (spawns real Claude Code session)
```

### Plugin Registration

```bash
# Auto-registered by npm run setup, or manually:
claude plugin marketplace add ~/superclaw
claude plugin install superclaw@superclaw

# Verify
claude plugin list

# Uninstall
claude plugin uninstall superclaw@superclaw
claude plugin marketplace remove superclaw
```

## Project Structure

```
superclaw/
├── src/                    # TypeScript source (~10K lines)
│   ├── mcp/               # 3 MCP servers (bridge, peekaboo, memory)
│   ├── telegram/           # Telegram Bot API poller
│   ├── cron/               # Cron scheduler with lock files
│   ├── daemon/             # Background daemon (gateway, ACP bridge)
│   ├── heartbeat/          # 7 health collectors + alerting
│   ├── mac-control/        # Peekaboo + AppleScript wrappers
│   ├── memory/             # DB, knowledge graph, Obsidian export
│   ├── pipelines/          # Pipeline engine + 3 presets
│   ├── skills/             # Skill evaluator, generator, installer
│   └── config/             # Zod schema + defaults
├── agents/                 # 29 agent definitions (.md)
├── skills/                 # 15 skill definitions (SKILL.md)
├── commands/               # 4 slash commands (.md)
├── hooks/                  # hooks.json (9 lifecycle hooks)
├── scripts/                # Hook scripts (.mjs) + build + QA
├── hud/                    # 14-element status line
├── bridge/                 # Built CJS bundles (3 MCP servers)
├── docs/                   # CLAUDE.md (delegation protocol)
└── data/                   # SQLite DB, logs, cron jobs
```

## Troubleshooting

**Telegram not connecting:**
```bash
cat ~/superclaw/superclaw.json | grep botToken
curl https://api.telegram.org/bot<TOKEN>/getMe
```

**Peekaboo not found:**
```bash
brew install peekaboo
# Or set custom path in superclaw.json
```

**Memory database issues:**
```bash
lsof ~/superclaw/data/memory.db
# Reset: rm ~/superclaw/data/memory.db && restart Claude Code
```

**Hook not firing:**
```bash
# Check hook logs
cat ~/superclaw/data/logs/hooks.log | tail -20
```

## Changelog (v2 → v3)

### New Features
- **Smart Team Routing** — keyword detection auto-composes multi-agent teams (dev/research/debug/refactor/deploy)
- **Ecomode** — automatic model tier routing (haiku/sonnet/opus) based on task complexity
- **Sisyphus Pattern** — Stop hook blocks session exit while autonomous tasks are active
- **Ultrawork Mode** — iterative execution loop with independent verification and learning accumulation
- **Circuit Breaker** — 3 consecutive agent failures → auto-escalate to higher tier
- **Progressive Disclosure** — memory search returns 200-char previews, guides `sc_memory_recall` for full content
- **Obsidian Sync** — incremental export to Obsidian vault with `[[wikilinks]]` and YAML frontmatter
- **HUD Statusline** — 14-element real-time status (model, agents, context, cost, git)
- **Pre-Compact Hook** — saves critical context before compression
- **Session Lifecycle** — auto-load recent memories on start, auto-extract learnings on end

### Bug Fixes
- Zombie peekaboo process accumulation (watchdog + timeout)
- Morning briefing 7x explosion (max-turns limit)
- Cron duplicate execution across multiple sc-bridge instances (cross-process lock files)
- Session-end Obsidian sync (transcript check bypass)
- Notepad bloat 148KB → auto-cleanup
- Knowledge session-summary duplication (30-entry cap)
- HUD usage API ETIMEDOUT + retry interval stale indicator
- FTS5 hyphen-in-query auto-quoting
- Memory add_entity FK violation (upsert)

### Breaking Changes
- Config file moved to `~/superclaw/superclaw.json` (was inline)
- MCP tools renamed: `sc_` prefix standardized across all 41 tools
- Agent count reduced from 39 to 29 (consolidated redundant agents)
- Hooks system rewritten (9 hooks, all use `${CLAUDE_PLUGIN_ROOT}` paths)

## License

MIT

## Version

3.0.0
