---
name: heartbeat
description: Proactive system monitoring with 7 collectors, alerting, and Telegram notifications
allowed-tools: Read, Bash, Grep, Glob
---

<Purpose>
Monitor system health proactively through automated collection of system metrics, development
environment status, GitHub CI results, Sentry error counts, calendar events, process health,
and custom collectors. Evaluates metrics against configurable thresholds, generates formatted
reports, sends alerts via Telegram when critical or warning conditions are detected, and stores
results for historical trending. Heartbeat turns Claude Code from a reactive tool into a
proactive monitoring agent that catches problems before users notice them.
</Purpose>

<Use_When>
- User says "heartbeat", "system health", "check status", "is everything ok"
- User says "monitor", "what's running", "system check", "how's the system"
- User wants to set up periodic health monitoring on a cron schedule
- User asks "are there any errors?", "check CI", "check Sentry"
- User wants a morning briefing with system status, calendar, and alerts
- A long-running process needs periodic health verification
- User says "alert me if CPU goes above 80%" or similar threshold-based monitoring
</Use_When>

<Do_Not_Use_When>
- One-time quick check of a single metric -- use Bash directly (e.g., `df -h`, `top -l 1`)
- Monitoring a specific test run -- use Bash with the test command directly
- Sending a manual message to Telegram -- use telegram-control skill instead
- Checking memory database health -- use memory-mgr skill with sc_memory_stats
</Do_Not_Use_When>

<Why_This_Exists>
Developers often miss slow-building problems: disk filling up, memory leaks in dev servers,
failing CI pipelines they forgot about, new Sentry errors from last night's deploy, or
calendar conflicts for upcoming meetings. Without proactive monitoring, these issues become
emergencies. Heartbeat runs collectors on a schedule (or on-demand), evaluates against
thresholds, and pushes alerts to Telegram so the developer knows about problems even when
they are away from the terminal. It provides the "ops awareness" that solo developers lack.
</Why_This_Exists>

<Execution_Policy>
- Run all 7 collectors in parallel for maximum speed (independent data sources)
- Timeout per collector: 15 seconds (prevent one slow collector from blocking the report)
- If a collector fails: log the error, mark that section as "unavailable", continue with others
- Max report frequency: no more than 1 full heartbeat per 5 minutes (prevent spam)
- Alert deduplication: same alert not re-sent within 30 minutes
- Critical alerts: always send to Telegram immediately
- Warning alerts: batch and send every 15 minutes or with next heartbeat
- Info level: include in report only, no Telegram notification
</Execution_Policy>

<Steps>
1. **Phase 1 - Run Collector Suite** (parallel execution):
   All 7 collectors run simultaneously. Each returns a structured result with status
   (ok/warn/critical), metrics, and human-readable summary.

   **Collector 1 - System Metrics:**
   - Bash: `top -l 1 -s 0 | head -12` for CPU and memory
   - Bash: `df -h /` for disk usage
   - Bash: `uptime` for load average and uptime
   - Bash: `sysctl hw.memsize` for total memory
   - Output: CPU%, memory%, disk%, load average, uptime

   **Collector 2 - Dev Environment:**
   - Bash: `node --version`, `npm --version`, `python3 --version`
   - Bash: `git status --porcelain | wc -l` for uncommitted changes
   - Bash: `npm test 2>&1 | tail -5` or project test command (if configured)
   - Bash: `npx tsc --noEmit 2>&1 | tail -10` for TypeScript errors
   - Output: tool versions, uncommitted file count, test status, type errors

   **Collector 3 - GitHub CI:**
   - Bash: `gh run list --limit 5 --json status,conclusion,name,createdAt`
   - Bash: `gh pr list --json number,title,mergeable,reviews`
   - Output: recent CI run results, open PR status, merge conflicts

   **Collector 4 - Sentry Errors:**
   - Bash: `curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "https://sentry.io/api/0/projects/$SENTRY_ORG/$SENTRY_PROJECT/issues/?query=is:unresolved&limit=5"`
   - Output: unresolved error count, top error titles, first/last seen

   **Collector 5 - Calendar:**
   - sc_osascript: query Calendar.app for today's events via AppleScript
   - Script: `tell application "Calendar" to get summary of events of calendar "Work" whose start date >= (current date) and start date <= ((current date) + 1 * days)`
   - Output: today's remaining events with times

   **Collector 6 - Process Health:**
   - Bash: `ps aux | head -20` sorted by CPU usage
   - Bash: `lsof -i -P | grep LISTEN` for open ports
   - Bash: check if key services are running (node, docker, postgres, etc.)
   - Output: top CPU processes, listening ports, service status

   **Collector 7 - Custom Collectors:**
   - Read user-defined collector scripts from `~/superclaw/collectors/`
   - Each script is a shell script that outputs JSON: `{"status":"ok|warn|critical","metric":value,"message":"..."}`
   - Execute each script with 10-second timeout
   - Output: custom metric results

2. **Phase 2 - Evaluate Against Thresholds**: Compare collected metrics to alert rules
   - Default thresholds (overridable in config):

   | Metric | Warning | Critical |
   |--------|---------|----------|
   | CPU % | > 70% | > 90% |
   | Memory % | > 75% | > 90% |
   | Disk % | > 80% | > 95% |
   | Load Average | > 4.0 | > 8.0 |
   | Uncommitted Files | > 20 | > 50 |
   | Failed CI Runs | >= 1 | >= 3 |
   | Unresolved Sentry | >= 5 | >= 20 |
   | TypeScript Errors | >= 1 | >= 10 |

   - Each metric evaluated independently
   - Overall status = worst individual status (any critical -> overall critical)

3. **Phase 3 - Generate Report**: Format results into a structured heartbeat report
   - Format:
   ```
   === SuperClaw Heartbeat ===
   Time: 2026-02-12 10:30:00
   Overall: OK | WARN | CRITICAL

   [System]
   CPU: 23% (ok)  |  Memory: 61% (ok)  |  Disk: 45% (ok)
   Load: 1.2  |  Uptime: 14d 3h

   [Dev Environment]
   Node: v22.1.0  |  TypeScript Errors: 0 (ok)
   Uncommitted: 3 files  |  Tests: passing

   [GitHub CI]
   Last 5 runs: 4 passed, 1 failed
   Open PRs: 2 (1 needs review)

   [Sentry]
   Unresolved: 3 issues (warn)
   Top: "TypeError: Cannot read property 'id' of undefined" (12 events)

   [Calendar]
   14:00 - Team standup (30min)
   16:00 - Design review (1hr)

   [Processes]
   Top CPU: node (8.2%), postgres (3.1%), docker (2.4%)
   Listening: :3000 (node), :5432 (postgres), :6379 (redis)

   [Alerts]
   WARN: 1 failed CI run on main branch
   WARN: 3 unresolved Sentry issues
   ```

4. **Phase 4 - Alert on Critical/Warn**: Send notifications for threshold violations
   - Critical: immediately send to Telegram via `sc_send_message`
   - Warning: include in report, send to Telegram if configured for warn-level
   - Info: include in report only
   - Alert message format: "[CRITICAL] CPU at 92% on hostname | Heartbeat 10:30"
   - Deduplicate: skip if same alert was sent within the last 30 minutes

5. **Phase 5 - Send to Telegram** (if configured):
   - Tool: `sc_send_message` with channel="telegram"
   - Full report sent as formatted text (truncated to 4096 chars if needed)
   - Critical alerts sent as separate urgent messages
   - Respect quiet hours if configured (no non-critical alerts between 22:00-08:00)

6. **Phase 6 - Store Results for Trending**:
   - Write heartbeat result to `~/superclaw/heartbeat/history/YYYY-MM-DD-HH-mm.json`
   - Keep last 7 days of history (auto-prune older files)
   - Format: JSON with all collector results, thresholds, alert states
   - Enables "show me CPU trend for the last week" queries

7. **Phase 7 - Schedule Next Run** (if periodic monitoring requested):
   - Add to system crontab with the cron expression (e.g., "*/30 * * * *" for every 30 minutes)
   - Verify the job was added via `crontab -l`
</Steps>

<Tool_Usage>
**Messaging (2 tools):**
- `sc_telegram_status` -- Check if Telegram bot is configured before attempting alerts; no params
- `sc_send_message` -- Send heartbeat report or alert to Telegram; params: `channel` (string, "telegram"), `text` (string, formatted report/alert)

**Scheduling:**
- `Bash` -- Manage system crontab via `crontab -l`, `crontab -e`, `crontab <file>` for scheduling periodic heartbeat runs

**System Data (via Bash):**
- `top -l 1 -s 0 | head -12` -- CPU and memory usage snapshot
- `df -h /` -- Disk usage for root volume
- `uptime` -- System uptime and load averages
- `ps aux --sort=-%cpu | head -10` -- Top CPU-consuming processes
- `lsof -i -P | grep LISTEN` -- Listening network ports

**GitHub Data (via Bash with gh CLI):**
- `gh run list --limit 5 --json status,conclusion,name,createdAt` -- Recent CI runs
- `gh pr list --json number,title,mergeable` -- Open pull requests

**Calendar Data (via SuperClaw):**
- `sc_osascript` -- Query Calendar.app via AppleScript for today's events

**Notification Fallback:**
- `sc_notify` -- Send macOS notification if Telegram is unavailable; params: `title`, `message`
</Tool_Usage>

<Examples>
<Good>
User: "Run a heartbeat check"
Action: Execute all 7 collectors in parallel via Bash commands, evaluate thresholds, format report, display to user, send to Telegram if gateway is connected
Why good: Comprehensive check with all collectors, parallel execution for speed, formatted output
</Good>

<Good>
User: "Set up heartbeat every 30 minutes"
Action: 1) Run initial heartbeat to verify all collectors work, 2) Add `*/30 * * * * /path/to/heartbeat.sh` to crontab, 3) Verify via `crontab -l`, 4) Report schedule to user
Why good: Validates collectors before scheduling, confirms cron registration, informs user
</Good>

<Good>
User: "Alert me if disk goes above 90%"
Action: 1) Check current disk usage, 2) Configure disk threshold to 90% warn, 3) Set up heartbeat cron if not already running, 4) Confirm alert will go to Telegram
Why good: Addresses the specific threshold request, ensures monitoring is active
</Good>

<Good>
User: "Morning briefing"
Action: Run heartbeat with all collectors, include calendar events prominently, format as a daily summary, send to Telegram with "Good morning" header
Why good: Recognizes "morning briefing" as a heartbeat variant, emphasizes calendar, sends remotely
</Good>

<Bad>
User: "Check CPU usage"
Action: Run all 7 collectors including GitHub, Sentry, and Calendar
Why bad: For a single metric check, use Bash directly: `top -l 1 -s 0 | head -5`. Full heartbeat is overkill for one metric
</Bad>

<Bad>
User: "Set up monitoring"
Action: Schedule heartbeat every 1 minute
Why bad: Too frequent. Minimum recommended interval is 5 minutes. Every 15-30 minutes is typical. Frequent checks waste resources and spam Telegram
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- **Stop** if all collectors fail -- system may be in a broken state, inform user to check manually
- **Stop** if crontab modification fails repeatedly -- check permissions
- **Escalate** if critical alerts persist across 3+ consecutive heartbeats -- problem is not self-resolving
- **Escalate** if disk usage is above 95% -- immediate user action required
- **Escalate** if GitHub CI has been failing for more than 24 hours -- may indicate a broken main branch
- **Warn** if Sentry collector fails with auth error -- token may have expired
- **Warn** if Calendar collector returns permission error -- Automation permission needed for Calendar.app
- **Fallback** to sc_notify (macOS notification) if Telegram is unreachable for alerts
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] All enabled collectors executed (failed ones marked as "unavailable", not blocking)
- [ ] Thresholds evaluated for every collected metric
- [ ] Report formatted with clear status indicators (ok/warn/critical)
- [ ] Critical alerts sent to Telegram immediately
- [ ] Warning alerts included in report and sent if configured
- [ ] Results stored to history file for trending
- [ ] Cron schedule verified if periodic monitoring was requested
- [ ] No collector timeout exceeded 15 seconds
</Final_Checklist>

<Advanced>
## Configuration

Heartbeat configuration in `~/superclaw/superclaw.json`:

```yaml
heartbeat:
  enabled: true
  defaultSchedule: "*/30 * * * *"  # Every 30 minutes
  quietHours:
    start: "22:00"
    end: "08:00"
    timezone: "America/New_York"
  alertChannel: "telegram"
  historyRetentionDays: 7

  collectors:
    system: true
    dev: true
    github: true
    sentry: false          # Requires SENTRY_AUTH_TOKEN
    calendar: true
    process: true
    custom: true

  thresholds:
    cpu_warn: 70
    cpu_critical: 90
    memory_warn: 75
    memory_critical: 90
    disk_warn: 80
    disk_critical: 95
    load_warn: 4.0
    load_critical: 8.0
    uncommitted_warn: 20
    uncommitted_critical: 50
    ci_failures_warn: 1
    ci_failures_critical: 3
    sentry_unresolved_warn: 5
    sentry_unresolved_critical: 20
    typescript_errors_warn: 1
    typescript_errors_critical: 10
```

Environment variables for external collectors:
```bash
export SENTRY_AUTH_TOKEN="sntrys_..."
export SENTRY_ORG="my-org"
export SENTRY_PROJECT="my-project"
export GITHUB_TOKEN="ghp_..."  # Usually set by gh CLI auth
```

## Custom Collector Creation

Create executable scripts in `~/superclaw/collectors/`:

```bash
#!/bin/bash
# ~/superclaw/collectors/docker-health.sh
# Custom collector for Docker container health

RUNNING=$(docker ps --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')
STOPPED=$(docker ps -a --filter "status=exited" --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')

if [ "$STOPPED" -gt 2 ]; then
  STATUS="warn"
elif [ "$STOPPED" -gt 5 ]; then
  STATUS="critical"
else
  STATUS="ok"
fi

echo "{\"status\":\"$STATUS\",\"running\":$RUNNING,\"stopped\":$STOPPED,\"message\":\"$RUNNING running, $STOPPED stopped\"}"
```

Make it executable: `chmod +x ~/superclaw/collectors/docker-health.sh`

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| GitHub collector returns empty | gh CLI not authenticated | Run `gh auth login` |
| Sentry collector fails | Missing or expired token | Set SENTRY_AUTH_TOKEN env var |
| Calendar collector empty | No automation permission | Grant Terminal access to Calendar in System Settings > Privacy > Automation |
| Cron jobs don't fire | Cron daemon not running | Check `sudo launchctl list | grep cron` on macOS |
| Report too long for Telegram | Many alerts or verbose collectors | Report auto-truncates at 4096 chars; reduce collector verbosity |
| History files accumulating | Auto-prune not running | Manually: `find ~/superclaw/heartbeat/history -mtime +7 -delete` |
| Process collector slow | Too many processes | Limit to top 10 by CPU; avoid `ps aux` without `head` |

## Collector-Specific Notes

**System Collector (macOS):**
- Uses `top -l 1 -s 0` which takes a 1-second sample (not instantaneous)
- `vm_stat` provides more detailed memory breakdown if needed
- Disk check uses root volume `/` by default; add more mount points in config

**GitHub Collector:**
- Requires `gh` CLI installed and authenticated
- Rate limited to 5000 requests/hour with authenticated token
- Only checks the current repository (determined by git remote)

**Sentry Collector:**
- Requires SENTRY_AUTH_TOKEN with project:read scope
- Queries unresolved issues only (resolved issues are excluded)
- Limited to 5 most recent issues to keep report concise

**Calendar Collector:**
- Uses AppleScript to query Calendar.app
- Only returns events for the current day
- Respects calendar visibility settings in Calendar.app
- May require "Full Disk Access" on some macOS versions

## Common Patterns

**Morning Briefing Pipeline:**
```
1. Run full heartbeat (all 7 collectors)
2. Format as morning summary with calendar first
3. Send to Telegram with "Good morning" header
4. Schedule: Add `0 8 * * 1-5 /path/to/heartbeat.sh # morning-brief` to crontab
```

**CI Watcher:**
```
1. Enable only GitHub collector
2. Set ci_failures_warn=1, ci_failures_critical=1
3. Schedule every 10 minutes: schedule="*/10 * * * *"
4. Immediate Telegram alert on any CI failure
```

**Disk Space Guard:**
```
1. Enable only system collector
2. Set disk_warn=80, disk_critical=90
3. Schedule hourly: schedule="0 * * * *"
4. Alert triggers cleanup recommendations
```
</Advanced>
