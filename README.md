# SuperClaw

Claude Code AI plugin. Mac automation, Telegram remote control, persistent memory with knowledge graph, heartbeat monitoring, research workflows, composable pipelines.

## Overview

SuperClaw extends Claude Code with agentic Mac control, proactive system monitoring, and persistent memory. Remote control via Telegram, automated workflows via pipelines, academic research tools, and self-improving skills through dynamic code generation.

**Key Capabilities:**
- 39 specialized agents with 3-tier model routing (haiku/sonnet/opus)
- 13 deep skills (208-454 lines each, auto-generated via skill-forge)
- 4 slash commands for instant access
- 31 MCP tools across 3 servers (bridge, peekaboo, memory)
- 9 lifecycle hooks for keyword detection, tool enforcement, verification
- Persistent SQLite memory with FTS5 full-text search and knowledge graph
- Persistent cross-session memory with knowledge graph

## Features

### Mac Automation
- Screenshot capture (native + Peekaboo v3)
- UI element detection and interaction
- Window/app management
- AppleScript execution
- Click/type/scroll automation

### Telegram Remote Control
- Send messages to phone from Claude
- Receive commands from Telegram
- Direct Telegram Bot API integration via TelegramPoller

### Persistent Memory
- SQLite database with FTS5 full-text search
- Knowledge graph with entity/relationship tracking
- Conversation logging with semantic search
- Persistent memory with FTS5 search and knowledge graph

### Heartbeat Monitoring
- System health checks (CPU, memory, disk)
- Process monitoring (dev servers, daemons)
- GitHub PR/issue tracking
- Calendar integration
- Sentry error tracking
- Custom metric collectors
- Proactive alerting via Telegram

### Research Workflows
- ArXiv paper fetching and analysis
- Literature review synthesis
- Experiment tracking and logging
- Statistical analysis
- Code review for research repositories

### Composable Pipelines
- Pre-built workflows (morning-brief, meeting-prep, deploy-monitor)
- Trigger-based automation
- Multi-step agent coordination
- Cron integration

### Developer Productivity
- PR review summaries
- Unread notification digests
- Code ownership analysis
- Catch-up workflows after time away

## Prerequisites

- **Node.js:** 22+
- **macOS** (for Peekaboo Mac automation; memory/pipeline features work on any OS)

Everything else is auto-installed by the setup wizard.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/jaminitachi/SuperClaw.git ~/superclaw
cd ~/superclaw

# 2. One-command setup (installs everything, configures Telegram, registers plugin permanently)
npm run setup

# 3. Done! Just launch Claude Code — SuperClaw loads automatically
claude
```

That's it. The setup wizard handles everything:
1. Installs Peekaboo via Homebrew (Mac automation)
2. Installs SoX (audio processing for TTS)
3. Installs Node.js dependencies and builds 3 MCP servers
4. Asks for Telegram bot token + chat ID (optional, interactive)
5. Creates `superclaw.json` with all settings
6. Creates data directories
7. Injects delegation rules into `~/.claude/CLAUDE.md`
8. Registers SuperClaw as a permanent Claude Code plugin (no `--plugin-dir` needed)

## Architecture

```
[Telegram Bot API] ←→ [SuperClaw Bridge (TelegramPoller)]
                              ↓
                       [Claude Code Plugin]
                       ├── MCP Servers (3)
                       ├── Skills, Agents, Hooks
                       └── SQLite Memory
                              ↓
                       [Mac Control Layer]
                       ├── Peekaboo
                       └── osascript
```

**Data Flow:**
1. User says "send to phone: meeting at 3pm"
2. UserPromptSubmit hook detects "send to phone" keyword
3. telegram-control skill activates
4. Delegates to mac-control agent (sonnet tier)
5. Agent calls sc-bridge MCP tool `sc_telegram_send`
6. Bridge sends message via Telegram Bot API
7. Message delivered to Telegram
8. Memory system logs interaction

## Agent Domains

| Domain | Agents | Models | Use Cases |
|--------|--------|--------|-----------|
| **Mac Automation** | mac-control, mac-control-low | sonnet, haiku | Screenshots, UI automation, app control |
| **Memory/Knowledge** | memory-curator, memory-curator-low, memory-curator-high | sonnet, haiku, opus | Knowledge graph updates, semantic search, relationship extraction |
| **Pipelines** | pipeline-builder, pipeline-builder-high, workflow-monitor | sonnet, opus, haiku | Workflow design, multi-step automation, monitoring |
| **System Health** | heartbeat-mgr, system-monitor, system-monitor-high, cron-mgr | haiku, sonnet, opus | Proactive monitoring, alerting, cron management |
| **Telegram** | telegram-debugger | sonnet | Telegram Bot API diagnostics |
| **Research** | paper-reader, literature-reviewer, experiment-tracker, research-assistant, research-code-reviewer | sonnet, opus, haiku | Academic workflows, data analysis, experiment logging |
| **Infrastructure** | data-analyst, sc-verifier, setup-validator | sonnet, haiku | Data analysis, verification, installation validation |
| **Developer Tools** | sc-architect, sc-architect-low, sc-frontend, sc-code-reviewer, sc-code-reviewer-low, sc-debugger, sc-debugger-high, sc-test-engineer, sc-security-reviewer, sc-security-reviewer-low, sc-performance, sc-performance-high | opus, sonnet, haiku | Architecture analysis, frontend design, code review, debugging, testing, security audit, performance profiling |
| **Orchestration** | sc-prometheus, sc-metis, sc-momus, sc-atlas, sc-junior | opus, sonnet | 3-tier planning/execution/worker system for ultrawork mode |
| **Meta** | skill-forger | sonnet | Skill generation, dynamic code creation |

## Skills

| Skill | Trigger | Description | Lines |
|-------|---------|-------------|-------|
| `telegram-control` | "send to phone" | Send Telegram messages | 208 |
| `mac-control` | "screenshot", "click on" | Mac UI automation | 312 |
| `memory-mgr` | "remember this", "search memory" | Persistent knowledge operations | 287 |
| `heartbeat` | "system health", "check status" | Proactive monitoring | 341 |
| `automation-pipeline` | "pipeline", "morning brief" | Composable workflows | 389 |
| `cron-mgr` | "schedule", "every morning" | Cron job management | 234 |
| `setup` | "setup superclaw" | Installation wizard | 412 |
| `skill-forge` | "create skill" | Auto-generate new skills | 454 |
| `paper-review` | "read paper", "arxiv" | Academic paper analysis | 298 |
| `experiment-log` | "log experiment" | Research experiment tracking | 223 |
| `lit-review` | "literature review" | Multi-paper synthesis | 367 |
| `research-analysis` | "analyze data" | Statistical analysis | 276 |
| `dev-workflow` | "check PRs", "catch me up" | Developer productivity | 319 |

All skills are invoked via `/superclaw:skill-name` or auto-detected via keyword matching.

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/sc-status` | System health dashboard | Shows Telegram, memory, heartbeat status |
| `/sc-screenshot` | Quick screenshot via Peekaboo | Captures screen and analyzes content |
| `/sc-memory <query>` | Search memory database | `/sc-memory "API design decisions"` |
| `/sc-heartbeat` | Run health check now | Executes all collectors and reports |

## MCP Tools (31 Total)

### sc-bridge (8 tools)
- `sc_status` - Check SuperClaw system status
- `sc_telegram_send` - Send message to Telegram
- `sc_telegram_inbox` - Fetch pending Telegram messages
- `sc_telegram_status` - Check Telegram Bot API connection
- `list_cron_jobs` - View scheduled tasks
- `add_cron_job` - Schedule new job
- `remove_cron_job` - Delete job
- `validate_cron_expression` - Check cron syntax

### sc-peekaboo (15 tools)
- `screenshot` - Capture screen
- `detect_ui_elements` - Find clickable elements
- `click_element` - Click by label/role
- `type_text` - Keyboard input
- `list_apps` - Running applications
- `list_windows` - Open windows
- `focus_window` - Activate window
- `run_applescript` - Execute AppleScript
- `get_app_info` - App metadata
- `execute_shortcut` - Keyboard shortcuts
- `scroll` - Scroll in direction
- `drag` - Drag and drop
- `get_screen_bounds` - Display dimensions
- `wait_for_element` - Element polling
- `get_element_text` - Extract text from UI

### sc-memory (8 tools)
- `store_knowledge` - Save to memory
- `search_knowledge` - FTS5 full-text search
- `get_related_knowledge` - Knowledge graph traversal
- `update_knowledge` - Modify entries
- `delete_knowledge` - Remove entries
- `log_conversation` - Save conversation turn
- `search_conversations` - Search logs
- `get_memory_stats` - Database statistics

## Configuration

Config file: `~/superclaw/superclaw.json`

```json
{
  "telegram": {
    "botToken": "your-bot-token",
    "allowFrom": ["your-chat-id"],
    "defaultChatId": "your-chat-id"
  },
  "peekaboo": {
    "binaryPath": "/opt/homebrew/bin/peekaboo"
  },
  "heartbeat": {
    "interval": 300000,
    "collectors": ["system", "process", "github", "calendar"]
  },
  "memory": {
    "dbPath": "~/superclaw/memory.db"
  }
}
```

Created automatically by `/superclaw:setup`.

## Security

- **Telegram:** `allowFrom` whitelist for authorized chat IDs, bot token authentication
- **Config:** 0600 permissions on token files
- **Shell Safety:** No user input in shell commands, all paths validated
- **MCP Isolation:** Each server runs in separate process

## Development

```bash
# Install dependencies
npm install

# Build plugin
npm run build

# Watch mode
npm run build:watch

# Run tests
npm test

# Type check
npm run typecheck
```

## Troubleshooting

**Telegram Bot API connection failed:**
```bash
# Verify bot token in config
cat ~/superclaw/superclaw.json | grep botToken

# Test bot token manually
curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
```

**Peekaboo not found:**
```bash
# Install via Homebrew
brew install peekaboo

# Or specify custom path in config
```

**Memory database locked:**
```bash
# Check for stale connections
lsof ~/superclaw/memory.db

# Reset if needed
rm ~/superclaw/memory.db
/superclaw:setup  # Re-run setup
```

## License

MIT

## Version

2.0.0
