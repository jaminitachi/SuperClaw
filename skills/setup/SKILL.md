---
name: setup
description: One-command SuperClaw installation wizard with prerequisite checks
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion
---

<Purpose>
Setup is the complete installation and configuration wizard for SuperClaw. It systematically checks all prerequisites, configures services, builds MCP servers, sets up integrations (Telegram, heartbeat, memory), and validates the entire installation end-to-end. This is the single entry point for first-time setup, reconfiguration, and troubleshooting connectivity issues.
</Purpose>

<Use_When>
- User says "setup superclaw", "install superclaw", "configure superclaw"
- First-time installation of SuperClaw
- User says "getting started", "first time", "how do I set up"
- After cloning the SuperClaw repository for the first time
- Reconfiguring components after a failed setup or environment change
- User reports connectivity issues with gateway, Telegram, or memory
- After upgrading SuperClaw to a new version
</Use_When>

<Do_Not_Use_When>
- SuperClaw is already fully configured and working (use sc-status command instead)
- User wants to configure a single component (direct them to the specific skill)
- User is asking about OMC setup (use omc-setup skill instead)
- The issue is not setup-related (use analyze skill for debugging)
</Do_Not_Use_When>

<Why_This_Exists>
SuperClaw depends on multiple external systems (OpenClaw gateway, Peekaboo, Node.js, SQLite) and internal services (MCP bridge servers, Telegram bot, memory database). Getting all of these configured correctly is error-prone when done manually. Missing a single step (forgetting to build, wrong bot token, gateway not running) causes silent failures that are hard to diagnose. Setup automates the entire process into a single wizard that checks, configures, builds, and validates everything in the correct order.
</Why_This_Exists>

<Execution_Policy>
- Run ALL prerequisite checks before starting any configuration
- Never skip a failed prerequisite -- report it clearly with install instructions
- Use AskUserQuestion for interactive configuration (bot tokens, preferences)
- Build MCP servers before testing connectivity (stale builds cause phantom failures)
- Test each component individually before running the full integration test
- Save configuration to ~/superclaw/superclaw.json
- Display a final status dashboard showing all component states
- Log setup completion to memory for session continuity
</Execution_Policy>

<Steps>
1. **Check prerequisites**: Verify all required software is installed and meets minimum versions.

   | Prerequisite | Check Command | Minimum Version | Install Command |
   |-------------|---------------|-----------------|-----------------|
   | Node.js | `node --version` | v18.0.0 | `brew install node` or `nvm install 18` |
   | npm | `npm --version` | v9.0.0 | Comes with Node.js |
   | TypeScript | `npx tsc --version` | v5.0.0 | `npm install -g typescript` |
   | OpenClaw | `openclaw --version` or check process | Any | See OpenClaw docs |
   | Peekaboo | `which peekaboo` or `peekaboo --version` | Any | `brew install peekaboo` or build from source |
   | SQLite3 | `sqlite3 --version` | v3.0.0 | `brew install sqlite3` (usually pre-installed on macOS) |
   | better-sqlite3 | Check node_modules | v11.0.0 | `npm install` in superclaw root |

   For each missing prerequisite, display the install command and stop. Do not proceed with a partial setup.

2. **Verify OpenClaw gateway**: Check that the OpenClaw gateway process is running and accepting connections.
   ```bash
   # Check if gateway process is running
   pgrep -f "openclaw" || ps aux | grep openclaw

   # Test WebSocket connectivity
   # Gateway default: ws://localhost:18789
   ```
   Use `sc_gateway_status` to verify the connection. If the gateway is not running, provide start instructions:
   ```bash
   openclaw start
   # or
   openclaw gateway --port 18789
   ```

3. **Check/create superclaw.json config**: Look for existing configuration at ~/superclaw/superclaw.json. If it does not exist, create it from the template:
   ```json
   {
     "version": "1.0.0",
     "gateway": {
       "url": "ws://localhost:18789",
       "reconnect": true,
       "reconnect_interval": 5000
     },
     "telegram": {
       "enabled": false,
       "bot_token": "",
       "chat_id": "",
       "channel": "telegram"
     },
     "heartbeat": {
       "enabled": true,
       "interval_minutes": 30,
       "collectors": ["system", "dev"],
       "thresholds": {
         "cpu": 80,
         "memory": 85,
         "disk": 90
       },
       "alert_channel": "telegram"
     },
     "memory": {
       "db_path": "data/memory.db",
       "auto_compact": true,
       "max_entries": 10000
     },
     "peekaboo": {
       "enabled": true,
       "screenshot_dir": "data/screenshots"
     },
     "pipelines": {
       "store_dir": "data/pipelines"
     }
   }
   ```

4. **Install dependencies and build**: Run npm install and build the MCP server bridges.
   ```bash
   cd ~/superclaw
   npm install
   npm run build
   ```
   Verify build output exists:
   - `bridge/sc-bridge.cjs` -- OpenClaw gateway bridge
   - `bridge/sc-peekaboo.cjs` -- Peekaboo (macOS automation) bridge
   - `bridge/sc-memory.cjs` -- Memory/knowledge graph bridge

5. **Configure Telegram** (optional): Ask the user if they want Telegram integration.
   ```
   AskUserQuestion(
     question: "Do you want to set up Telegram integration for remote notifications?",
     options: ["Yes, I have a bot token", "Yes, help me create one", "Skip for now"]
   )
   ```

   If yes with token:
   ```
   AskUserQuestion(
     question: "Please enter your Telegram bot token (from @BotFather):",
     type: "text"
   )
   ```
   Then ask for the chat ID:
   ```
   AskUserQuestion(
     question: "Enter your Telegram chat ID (send /start to @userinfobot to find it):",
     type: "text"
   )
   ```

   If yes without token, provide step-by-step instructions:
   1. Open Telegram and search for @BotFather
   2. Send `/newbot` and follow the prompts
   3. Copy the bot token (looks like `123456789:ABCdef...`)
   4. Start a chat with your new bot
   5. Send `/start` to @userinfobot to get your chat ID

   Save the token and chat ID to superclaw.json.

6. **Test gateway connectivity**: Use the MCP bridge to verify the gateway connection works end-to-end.
   ```
   sc_gateway_status()
   ```
   Expected response: connected with latency information. If this fails:
   - Check gateway is running (step 2)
   - Check gateway URL in superclaw.json matches actual port
   - Check firewall/network settings

7. **Test each MCP server**: Verify each bridge server responds correctly.

   **sc-bridge** (gateway):
   ```
   sc_gateway_status()  -- Should return { connected: true }
   ```

   **sc-memory** (knowledge):
   ```
   sc_memory_stats()  -- Should return { entities: N, size_kb: N }
   ```

   **sc-peekaboo** (macOS automation):
   ```
   sc_screenshot({ display: 1 })  -- Should capture and return a file path
   ```

   If any server fails, check:
   - Build output exists (step 4)
   - .mcp.json references correct paths
   - Required system services are running

8. **Initialize memory database**: If ~/superclaw/data/memory.db does not exist or is empty, initialize it:
   ```
   sc_memory_store({
     content: "SuperClaw initialized successfully",
     category: "system",
     confidence: 1.0,
     metadata: { event: "setup_complete", timestamp: "now" }
   })
   ```
   Verify with `sc_memory_stats()`.

9. **Create data directories**: Ensure all required data directories exist:
   ```bash
   mkdir -p ~/superclaw/data/heartbeats
   mkdir -p ~/superclaw/data/pipelines
   mkdir -p ~/superclaw/data/screenshots
   mkdir -p ~/superclaw/data/skill_metrics
   ```

10. **Run setup-validator agent**: Delegate final validation to a dedicated agent:
    ```
    Task(subagent_type="superclaw:setup-validator", model="haiku", prompt="
      Validate SuperClaw installation:
      1. Check all bridge files exist in ~/superclaw/bridge/
      2. Verify .mcp.json has all 3 server entries
      3. Test sc_gateway_status returns connected
      4. Test sc_memory_stats returns valid stats
      5. Check superclaw.json exists and is valid JSON
      6. Verify data directories exist
      Report pass/fail for each check.
    ")
    ```

11. **Display status dashboard**: Show the final installation status:
    ```
    ============================================
     SuperClaw Setup Complete
    ============================================

    | Component      | Status      | Details          |
    |----------------|-------------|------------------|
    | Node.js        | OK          | v22.0.0          |
    | OpenClaw GW    | Connected   | ws://localhost:18789, 12ms |
    | sc-bridge      | OK          | Built, responding |
    | sc-memory      | OK          | 42 entities, 48KB |
    | sc-peekaboo    | OK          | Peekaboo found   |
    | Telegram       | Configured  | Bot @mybot       |
    | Heartbeat      | Enabled     | Every 30 min     |
    | Memory DB      | OK          | data/memory.db   |
    | Data Dirs      | OK          | All created       |

    SuperClaw is ready! Try:
    - "take a screenshot and send to telegram"
    - "schedule a heartbeat every 30 minutes"
    - "remember this architecture decision"
    ============================================
    ```

12. **Log setup to memory**: Store setup completion for future reference:
    ```
    sc_memory_store({
      content: "SuperClaw setup completed successfully. All components verified.",
      category: "system",
      confidence: 1.0,
      metadata: { event: "setup_complete", version: "1.0.0" }
    })
    ```
</Steps>

<Tool_Usage>
- `Bash` -- Run prerequisite checks (node --version, which peekaboo, etc.), build commands (npm install, npm run build), create directories.
- `sc_gateway_status` -- Test OpenClaw gateway connectivity and latency.
- `sc_memory_stats` -- Verify memory database is initialized and responding.
- `sc_memory_store` -- Initialize memory with setup event, store configuration history.
- `sc_screenshot` -- Test Peekaboo integration by taking a test screenshot.
- `sc_send_message` -- Test Telegram integration by sending a test message.
- `Read` -- Read existing superclaw.json configuration.
- `Write` -- Create or update superclaw.json configuration file.
- `AskUserQuestion` -- Interactive prompts for Telegram bot token, preferences, and confirmations.
- `Glob` -- Find build output files and verify directory structure.
- `Grep` -- Search configuration files for specific settings.
</Tool_Usage>

<Examples>
<Good>
Fresh installation on a new machine:
1. Check prerequisites: Node.js v22 OK, npm v10 OK, Peekaboo found, SQLite3 OK
2. OpenClaw gateway: NOT RUNNING -> show start command, user starts it -> Connected
3. Config: superclaw.json not found -> create from template
4. Build: npm install -> 168 packages, npm run build -> 3 bridge files generated
5. Telegram: User provides bot token and chat ID -> saved to config
6. Test gateway: sc_gateway_status -> { connected: true, latency: 8ms }
7. Test memory: sc_memory_stats -> { entities: 0, size_kb: 49 }
8. Test Peekaboo: sc_screenshot -> /tmp/screenshot-123.png saved
9. Validator: all 6 checks passed
10. Dashboard displayed with all green status

Why good: Every step checked, clear error messages, interactive config, comprehensive verification.
</Good>

<Good>
Reconfiguration after Telegram token change:
1. Prerequisites: all OK (skip detailed check since already installed)
2. Gateway: already running and connected
3. Config: existing superclaw.json found, read current values
4. User provides new bot token via AskUserQuestion
5. Update superclaw.json with new token
6. Test: sc_send_message("Test from SuperClaw") -> delivered
7. Dashboard: Telegram status updated to new bot

Why good: Minimal disruption, only reconfigures what changed, verifies the change works.
</Good>

<Bad>
Setup proceeds despite Node.js not being installed, tries to run npm install, fails with cryptic error.

Why bad: Must check ALL prerequisites before starting configuration. Never skip failed prerequisites.
</Bad>

<Bad>
Setup completes but does not run npm run build. User tries to use SuperClaw and gets "bridge file not found" errors.

Why bad: Build step is critical. Stale or missing builds cause phantom failures that are hard to diagnose.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- If any prerequisite is missing, STOP and show install instructions. Do not proceed with partial setup.
- If the OpenClaw gateway cannot be started after 3 attempts, escalate to user with manual start instructions
- If npm install fails, check for Node.js version compatibility and suggest `nvm use 18` or higher
- If npm run build fails, show the build error output and suggest checking tsconfig.json
- If Telegram test message fails, verify bot token format and chat ID. Suggest the user check @BotFather.
- If memory database is corrupted (sc_memory_stats returns error), back up the existing file and create a fresh one
- If the setup-validator agent reports failures, show which specific checks failed and suggest fixes
- Stop if user explicitly cancels setup at any point
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] All prerequisites met (Node.js, npm, OpenClaw, Peekaboo, SQLite3)
- [ ] OpenClaw gateway running and connected
- [ ] superclaw.json configuration file exists and is valid
- [ ] npm install completed without errors
- [ ] npm run build completed, all 3 bridge files exist
- [ ] Telegram configured (or explicitly skipped by user)
- [ ] Gateway connectivity test passed
- [ ] Each MCP server tested individually
- [ ] Memory database initialized and responding
- [ ] All data directories created
- [ ] Setup-validator agent reports all checks passed
- [ ] Status dashboard displayed to user
- [ ] Setup completion logged to memory
</Final_Checklist>

<Advanced>
## Full Prerequisite List

| Software | Purpose | Required | Check | Install |
|----------|---------|----------|-------|---------|
| Node.js >= 18 | Runtime for MCP bridges | Yes | `node -v` | `brew install node` / `nvm install 18` |
| npm >= 9 | Package manager | Yes | `npm -v` | Bundled with Node.js |
| TypeScript >= 5 | Build system | Yes | `npx tsc -v` | `npm i -g typescript` |
| OpenClaw | Gateway server | Yes | `openclaw -v` / process check | See OpenClaw docs |
| Peekaboo | macOS automation | Yes (macOS) | `which peekaboo` | `brew install peekaboo` |
| SQLite3 | Memory database engine | Yes | `sqlite3 --version` | Pre-installed on macOS |
| better-sqlite3 | Node.js SQLite binding | Yes | Check node_modules | `npm install` |
| esbuild | Build bundler | Dev | Check node_modules | `npm install` |

## Configuration File Template (superclaw.json)

```json
{
  "version": "1.0.0",
  "gateway": {
    "url": "ws://localhost:18789",
    "reconnect": true,
    "reconnect_interval": 5000,
    "timeout": 30000
  },
  "telegram": {
    "enabled": false,
    "bot_token": "",
    "chat_id": "",
    "channel": "telegram",
    "parse_mode": "Markdown"
  },
  "heartbeat": {
    "enabled": true,
    "interval_minutes": 30,
    "collectors": ["system", "dev"],
    "thresholds": { "cpu": 80, "memory": 85, "disk": 90 },
    "alert_channel": "telegram"
  },
  "memory": {
    "db_path": "data/memory.db",
    "auto_compact": true,
    "max_entries": 10000,
    "backup_interval_hours": 24
  },
  "peekaboo": {
    "enabled": true,
    "screenshot_dir": "data/screenshots",
    "default_display": 1
  },
  "pipelines": {
    "store_dir": "data/pipelines",
    "max_concurrent": 3
  },
  "cron": {
    "default_timezone": "Asia/Seoul",
    "health_check_interval": "0 */6 * * *"
  }
}
```

## Manual Setup Steps

If the wizard fails, here is the manual process:

1. `cd ~/superclaw && npm install`
2. `npm run build`
3. Copy the config template above to `superclaw.json` and fill in values
4. Start OpenClaw gateway: `openclaw start`
5. Test: Open Claude Code in the superclaw directory, try `sc_gateway_status`

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Cannot find module sc-bridge.cjs" | Build not run | `npm run build` |
| "ECONNREFUSED ws://localhost:18789" | Gateway not running | `openclaw start` |
| "SQLITE_CANTOPEN" | Missing data directory | `mkdir -p data` |
| "Telegram 401 Unauthorized" | Invalid bot token | Re-check token from @BotFather |
| "Telegram 400 Bad Request" | Invalid chat ID | Send /start to @userinfobot |
| "Peekaboo not found" | Not installed | `brew install peekaboo` |
| "node: command not found" | Node.js not in PATH | Install via nvm or brew |
| "npm ERR! peer dep" | Version conflict | Delete node_modules, `npm install` |
| Build succeeds but bridge fails | Stale build cache | `rm -rf bridge/*.cjs && npm run build` |

## Uninstall Instructions

To completely remove SuperClaw:
```bash
# Remove cron jobs
sc_cron_list  # note all job names
# Delete each via sc_gateway_request({ method: "cron.delete", params: { name: "..." } })

# Remove files
rm -rf ~/superclaw/node_modules
rm -rf ~/superclaw/bridge/*.cjs
rm ~/superclaw/superclaw.json
rm ~/superclaw/data/memory.db

# Optionally remove the entire directory
rm -rf ~/superclaw
```

## Upgrade Guide

When upgrading to a new SuperClaw version:
1. `cd ~/superclaw && git pull` (or download new version)
2. `npm install` (update dependencies)
3. `npm run build` (rebuild bridges)
4. Run setup wizard again -- it will detect existing config and only update what is new
5. Verify with `/sc-status` command

The setup wizard preserves existing configuration values and only adds new fields from the updated template.
</Advanced>
