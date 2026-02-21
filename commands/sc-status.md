---
name: sc-status
description: Quick system health status dashboard
allowed-tools: Read, Bash, Grep
---

# /sc-status - System Status Dashboard

Show a comprehensive status dashboard for all SuperClaw components in a single view.

## Activation

Triggered by: `/sc-status`, "superclaw status", "system status", "is everything working?"

## Steps

1. **Check Telegram Bot API**: Call `sc_telegram_status` to verify the Telegram Bot API is reachable. Record connection status and bot information.

2. **Check memory database**: Call `sc_memory_stats` to get entity count and database size. If it returns an error, report memory as unavailable.

3. **Check Peekaboo**: Run `which peekaboo` via Bash to verify Peekaboo is installed. If found, report version. If not found, report as missing.

4. **Check Telegram configuration**: Read `~/superclaw/superclaw.json` and check if `telegram.enabled` is true and `telegram.bot_token` is non-empty. Do NOT test-send a message -- just verify config exists.

5. **Check heartbeat**: Look for the most recent file in `~/superclaw/data/heartbeats/` via Bash (`ls -t ~/superclaw/data/heartbeats/ | head -1`). Report the timestamp of the last heartbeat. If directory is empty, report as inactive.

6. **Check cron jobs**: Call `sc_cron_list` to count active scheduled jobs and show the next scheduled run time.

7. **Check MCP bridge files**: Verify these files exist:
   - `~/superclaw/bridge/sc-bridge.cjs`
   - `~/superclaw/bridge/sc-peekaboo.cjs`
   - `~/superclaw/bridge/sc-memory.cjs`

8. **Format status table**: Display all results in a clean table:

```
============================================
 SuperClaw Status Dashboard
============================================

| Component   | Status          | Details                   |
|-------------|-----------------|---------------------------|
| Telegram    | [OK/ERROR]      | [bot username or error]    |
| Memory DB   | [OK/ERROR]      | [entity count, KB size]    |
| Peekaboo    | [Found/Missing] | [version or install cmd]   |
| Heartbeat   | [Active/Idle]   | [last run timestamp]       |
| Cron Jobs   | [N active]      | [next scheduled run]       |
| MCP Bridges | [OK/Missing]    | [which files present]      |

============================================
```

## Error Handling

- If the Telegram Bot API is unreachable, still show all other component statuses
- If superclaw.json does not exist, report "Config: NOT FOUND -- run /sc-setup"
- If any check throws an exception, report that component as "ERROR" with the message
- Never fail the entire dashboard because one component is down

## Notes

- This command is read-only. It never modifies any state or configuration.
- For fixing issues found by this dashboard, use the `setup` skill.
- Run this after setup to verify everything is working.
