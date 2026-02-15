---
name: sc-heartbeat
description: Quick heartbeat - run collectors and show compact report
allowed-tools: Read, Bash, Grep
---

# /sc-heartbeat - Quick Heartbeat Report

Run all enabled collectors and display a compact system health report.

## Activation

Triggered by: `/sc-heartbeat`, "heartbeat", "system health", "how is the system", "quick check"

## Steps

1. **Run system collector**: Gather core system metrics via Bash:
   ```bash
   # CPU usage
   top -l 1 -n 0 | grep "CPU usage"

   # Memory usage
   memory_pressure | head -1
   # or: vm_stat | head -5

   # Disk usage
   df -h / | tail -1
   ```

   Format into metrics:
   - CPU: usage percentage and load average
   - Memory: used/total and pressure level
   - Disk: used/total and percentage

2. **Run dev collector**: Check development environment health:
   ```bash
   # Git status of current project
   git -C ~/superclaw status --short | wc -l

   # Node.js processes
   pgrep -c node

   # Recent build status (check if bridge files are fresh)
   ls -la ~/superclaw/bridge/*.cjs 2>/dev/null | awk '{print $6, $7, $8, $9}'
   ```

3. **Check thresholds**: Compare metrics against default thresholds:
   | Metric | Warning | Critical |
   |--------|---------|----------|
   | CPU | > 70% | > 90% |
   | Memory | > 75% | > 90% |
   | Disk | > 80% | > 95% |

   Flag any metrics that exceed thresholds.

4. **Save heartbeat**: Write the report to ~/superclaw/data/heartbeats/ with a timestamped filename:
   ```
   ~/superclaw/data/heartbeats/heartbeat-2026-02-12T10-30-00.json
   ```

5. **Format compact report**: Display results in a concise format:
   ```
   Heartbeat Report - 2026-02-12 10:30:00
   ----------------------------------------
   CPU:    23% (load: 2.1, 1.8, 1.5)     OK
   Memory: 12.4/16 GB (78%)              WARN
   Disk:   180/500 GB (36%)              OK
   ----------------------------------------
   Processes: 4 node | Git: 2 changes
   Bridges:   3/3 built (12 min ago)
   ----------------------------------------
   Alerts: 1 warning (memory > 75%)
   ```

6. **Alert if critical**: If any metric exceeds the critical threshold, send an alert to Telegram (if configured):
   ```
   sc_send_message({
     channel: "telegram",
     message: "CRITICAL: Memory at 92% on MacBook"
   })
   ```

## Error Handling

- If system commands fail (e.g., top not available), skip that metric and note it as "unavailable"
- If heartbeat directory does not exist, create it before saving
- If Telegram is not configured, skip the alert step (still show the report locally)
- If previous heartbeat file cannot be written, still display the report to the user

## Notes

- This is a quick one-shot check. For recurring heartbeats, use the cron-mgr skill to schedule this.
- The full heartbeat skill provides more collectors (GitHub, Sentry, calendar). This command runs only system and dev collectors for speed.
- Heartbeat history is stored as JSON files for trend analysis.
