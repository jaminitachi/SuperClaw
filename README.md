# SuperClaw

Claude Code plugin for agentic Mac automation, persistent memory, Telegram remote control, and multi-agent orchestration.

## What It Does

SuperClaw turns Claude Code into a full autonomous workstation. One request auto-composes the right team of agents, executes in parallel, and verifies results independently.

- **36 MCP tools** across 3 servers (bridge, peekaboo, memory)
- **10 team agents** with 3-tier model routing (haiku / sonnet / opus)
- **9 skills** with keyword auto-detection (Korean + English)
- **7 lifecycle hooks** for context injection, tool enforcement, and session persistence



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
                         │  │      10 Team Agents         │  │
                         │  │  Dev: dev-architect,        │  │
                         │  │    dev-backend, dev-frontend,│  │
                         │  │    dev-qa                   │  │
                         │  │  Research: research-reviewer,│  │
                         │  │    research-writer,          │  │
                         │  │    research-assistant        │  │
                         │  │  Infra: infra-monitor,      │  │
                         │  │    infra-mac                 │  │
                         │  │  Verify: verify             │  │
                         │  └────────────────────────────┘  │
                         └──────────┬───────────────────────┘
                                    │ MCP (stdio)
                    ┌───────────────┼───────────────┐
                    │               │               │
             ┌──────┴──────┐ ┌─────┴──────┐ ┌──────┴──────┐
             │  sc-bridge  │ │ sc-peekaboo│ │  sc-memory  │
             │  8 tools    │ │  15 tools  │ │  13 tools   │
             │             │ │            │ │             │
             │ Telegram    │ │ Screenshot │ │ SQLite+FTS5 │
             │ Cron sched. │ │ UI inspect │ │ Persistent  │
             │ Status      │ │ Click/type │ │  memory     │
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
   - dev-backend (sonnet): Root cause analysis
   - dev-architect (opus): Architecture context
   - dev-qa (sonnet): Reproduce & verify
3. Agents execute in parallel
4. Stop hook blocks exit until work complete (Sisyphus)
5. Results verified independently before reporting
```

## MCP Tools (36)

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

### sc-memory (13 tools)
| Tool | Description |
|------|-------------|
| `sc_memory_store` | Store knowledge with category/confidence |
| `sc_memory_search` | FTS5 full-text search (progressive disclosure) |
| `sc_memory_recall` | Recall by ID or category |
| `sc_memory_delete` | Delete from any table |
| `sc_memory_stats` | Database statistics |
| `sc_learning_store` | Store learning (7 categories) |
| `sc_learning_recall` | Recall learnings by filter |
| `sc_learning_summary` | Category-grouped summary |
| `sc_verification_log` | Log claimed vs verified results |
| `sc_obsidian_sync` | Export to Obsidian vault with wikilinks |
| `sc_notepad_write` | Cross-session scratchpad write |
| `sc_notepad_read` | Read scratchpad memos |
| `sc_notepad_clear` | Clear scratchpad entries |

## Agents (10 Team-Based)

v4 consolidates 29 individual agents into 10 focused team roles.

### DEV Team
| Agent | Model | Role |
|-------|-------|------|
| `dev-architect` | opus | Architecture, planning, code review, security, performance |
| `dev-backend` | sonnet | Backend implementation, debugging |
| `dev-frontend` | sonnet | Frontend/UI implementation |
| `dev-qa` | sonnet | TDD, unit/integration/e2e testing |

### RESEARCH Team
| Agent | Model | Role |
|-------|-------|------|
| `research-reviewer` | opus | Paper analysis, literature synthesis, data analysis |
| `research-writer` | opus | Academic writing, ideation |
| `research-assistant` | haiku | Citations, BibTeX, quick lookups |

### INFRA Team
| Agent | Model | Role |
|-------|-------|------|
| `infra-monitor` | haiku | System monitoring, heartbeat, cron, pipelines |
| `infra-mac` | sonnet | macOS UI automation via Peekaboo |

### VERIFY Team
| Agent | Model | Role |
|-------|-------|------|
| `verify` | sonnet | Independent operations verification |

## Skills (9)

| Skill | Trigger Keywords | Description |
|-------|-----------------|-------------|
| `telegram-control` | "send to phone", "텔레그램" | Telegram messaging |
| `mac-control` | "screenshot", "click on", "앱 열어" | Mac UI automation |
| `memory-mgr` | "remember this", "기억해" | Persistent knowledge |
| `heartbeat` | "system health", "상태 확인" | Proactive monitoring |
| `cron-mgr` | "schedule", "매일" | Cron job management |
| `setup` | "setup superclaw", "설정" | Installation wizard |
| `lit-review` | "literature review", "문헌 조사" | Multi-paper synthesis |
| `dev-workflow` | "check PRs", "PR 확인" | Developer productivity |
| `ultrawork` | "ulw", "다 해줘" | PO-driven team orchestration |

## Smart Team Routing (v4)

Complex requests auto-compose multi-agent teams:

| Request Pattern | Team | Agents |
|----------------|------|--------|
| "앱 만들어" / "build a service" | Dev Team | dev-architect + dev-backend + dev-frontend + dev-qa |
| "논문 조사해" / "research papers" | Research Team | research-reviewer + research-writer + research-assistant |
| "버그 고쳐" / "fix this bug" | Dev Team | dev-backend + dev-architect + dev-qa |
| "시스템 점검" / "check system" | Infra Team | infra-monitor + infra-mac |
| "검증해" / "verify this" | Verify Team | verify + dev-qa |

**Ecomode**: Automatic model tier selection based on task complexity.
- Simple lookups → haiku ($)
- Standard implementation → sonnet ($$)
- Architecture/security → opus ($$$)

## Hooks (7)

| Hook | Event | Purpose |
|------|-------|---------|
| `sc-keyword-detector` | UserPromptSubmit | Detect keywords → auto-invoke skills and compose teams |
| `session-start` | SessionStart | Load memory context, recent learnings, notepad cleanup |
| `session-end` | SessionEnd | Extract learnings, Obsidian sync, session summary |
| `sc-pre-tool` | PreToolUse | Model suggestions, tool reminders |
| `sc-post-tool` | PostToolUse | Failure detection, circuit breaker, ultrawork verification |
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

SQLite database with FTS5 full-text search.

### Tables
- **knowledge** — Categorized facts with confidence scores
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
│   ├── memory/             # DB, Obsidian export
│   └── config/             # Zod schema + defaults
├── agents/                 # 10 agent definitions (.md)
├── skills/                 # 9 skill definitions (SKILL.md)
├── commands/               # 5 slash commands (.md)
├── hooks/                  # hooks.json (7 lifecycle hooks)
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

## Changelog (v2 → v3 → v4)

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
- MCP tools renamed: `sc_` prefix standardized across all 36 tools
- Agent count reduced from 39 → 29 → 10 (consolidated into focused team roles)
- Hooks system: 7 hooks with keyword detection, tool enforcement, and session persistence

## License

MIT

## Version

4.0.0
