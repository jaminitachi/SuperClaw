---
name: cron-mgr
description: Manage scheduled tasks via system crontab / node-cron
allowed-tools: Read, Bash, Grep, Glob
---

<Purpose>
Cron Manager provides complete lifecycle management for scheduled tasks through system crontab or node-cron. It handles creating, listing, modifying, and deleting cron jobs with natural language schedule parsing, cron expression generation, validation, and failure alerting. This is the single interface for all time-based automation in SuperClaw.
</Purpose>

<Use_When>
- User says "schedule", "every", "daily", "hourly", "cron", "recurring"
- User describes a time: "at 8am", "every Monday", "twice a day", "every 5 minutes"
- User wants to list, modify, or remove existing scheduled jobs
- User asks "what is scheduled?" or "show my cron jobs"
- Setting up recurring heartbeat, pipeline, or notification schedules
- User says "stop scheduling" or "remove the daily job"
</Use_When>

<Do_Not_Use_When>
- One-time immediate execution (just run the command directly)
- Complex multi-step pipeline scheduling (use automation-pipeline, which calls cron-mgr internally)
- System-level crontab editing (use Bash with crontab directly if user specifically requests OS-level cron)
- The user wants a delay/timer, not a recurring schedule ("wait 5 minutes" is not cron)
</Do_Not_Use_When>

<Why_This_Exists>
Scheduling is fundamental to automation but cron expressions are notoriously hard to write correctly. Users think in natural language ("every weekday at 8am") but cron requires cryptic syntax ("0 8 * * 1-5"). Cron Manager bridges this gap by parsing natural language into validated cron expressions and managing them through system crontab. Without it, every scheduling task requires manual cron syntax lookup.
</Why_This_Exists>

<Execution_Policy>
- Always parse natural language schedules into cron expressions before registering
- Validate every cron expression before submitting to system crontab
- Show the user the interpreted schedule in human-readable form for confirmation
- List existing jobs before adding to avoid duplicates
- Use timezone-aware scheduling when the user specifies a timezone
- Default timezone is the system local timezone unless specified otherwise
- Note: cron jobs are managed via system crontab (use `crontab -l` to list, `crontab -e` to edit)
</Execution_Policy>

<Steps>
1. **Parse schedule intent**: Convert the user's natural language into a cron schedule. Common mappings:

   | Natural Language | Cron Expression | Meaning |
   |-----------------|----------------|---------|
   | "every minute" | `* * * * *` | Every minute |
   | "every 5 minutes" | `*/5 * * * *` | Every 5th minute |
   | "every hour" | `0 * * * *` | Top of every hour |
   | "every 2 hours" | `0 */2 * * *` | Every 2nd hour |
   | "daily at 8am" | `0 8 * * *` | 8:00 AM every day |
   | "daily at 8:30am" | `30 8 * * *` | 8:30 AM every day |
   | "weekdays at 9am" | `0 9 * * 1-5` | 9:00 AM Mon-Fri |
   | "every Monday" | `0 0 * * 1` | Midnight every Monday |
   | "every Monday at 10am" | `0 10 * * 1` | 10:00 AM Monday |
   | "twice a day" | `0 8,20 * * *` | 8:00 AM and 8:00 PM |
   | "every 1st of month" | `0 0 1 * *` | Midnight, 1st of month |
   | "every Sunday at 6pm" | `0 18 * * 0` | 6:00 PM Sunday |
   | "every 15 minutes during work hours" | `*/15 9-17 * * 1-5` | Every 15m, 9-5 weekdays |

2. **Generate cron expression**: Build the 5-field cron expression:
   ```
   ┌───────────── minute (0-59)
   │ ┌───────────── hour (0-23)
   │ │ ┌───────────── day of month (1-31)
   │ │ │ ┌───────────── month (1-12)
   │ │ │ │ ┌───────────── day of week (0-6, Sun=0)
   │ │ │ │ │
   * * * * *
   ```

   Special characters:
   - `*` -- any value
   - `,` -- value list separator (1,3,5)
   - `-` -- range (1-5)
   - `/` -- step values (*/5 = every 5th)

3. **Validate expression**: Verify the expression is syntactically correct:
   - All 5 fields present
   - Values within valid ranges
   - No contradictory fields (e.g., day 31 with month 2)
   - Step values divide evenly into the range

4. **Check for duplicates**: List existing cron jobs via `crontab -l` and check if a job with a very similar schedule already exists. Warn the user if so.

5. **Register via system crontab**: Add the validated job to system crontab:
   ```bash
   # Edit crontab
   crontab -l > /tmp/crontab.txt
   echo "0 8 * * 1-5 /path/to/command # job-name" >> /tmp/crontab.txt
   crontab /tmp/crontab.txt
   ```

6. **Verify registration**: Call `crontab -l` after adding to confirm the job appears in the crontab. If it does not appear, report the error.

7. **Report to user**: Show the user:
   - Job name
   - Cron expression
   - Human-readable schedule interpretation
   - Next 3 scheduled run times
</Steps>

<Tool_Usage>
- `Bash` -- Manage system crontab via `crontab -l`, `crontab -e`, `crontab <file>`. Calculate next run times, validate expressions.
- `Read` -- Read pipeline definitions that reference cron schedules.
- `Grep` -- Search for cron references across configuration files.
</Tool_Usage>

<Examples>
<Good>
User says "schedule a heartbeat every 30 minutes":
1. Parse: "every 30 minutes" -> `*/30 * * * *`
2. Validate: expression is correct
3. Check duplicates: no existing heartbeat cron via `crontab -l`
4. Register: Add `*/30 * * * * /path/to/heartbeat.sh # heartbeat-30m` to crontab
5. Verify: job appears in `crontab -l`
6. Report: "Heartbeat scheduled every 30 minutes. Next runs: 10:00, 10:30, 11:00"

Why good: Clean natural language parsing, full validation cycle, clear confirmation.
</Good>

<Good>
User says "show me all my scheduled jobs":
1. Call `crontab -l`
2. Parse output and format as table:
   | Name | Schedule | Expression |
   |------|----------|------------|
   | heartbeat-30m | Every 30 min | */30 * * * * |
   | morning-brief | Weekdays 8am | 0 8 * * 1-5 |
   | deploy-monitor | Every 5 min | */5 * * * * |
3. Show next scheduled run for each

Why good: Clear, tabular output with all relevant information.
</Good>

<Bad>
User says "run this at 8am" and the agent registers `0 8 * * *` without asking if they mean daily or just once.

Why bad: "at 8am" is ambiguous -- could mean once or daily. Should clarify with user before registering a recurring job.
</Bad>

<Bad>
Agent registers a cron job but does not verify it appears in `crontab -l` afterward.

Why bad: Silent failure. The job might not have been added due to a syntax error. Always verify.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- If a cron expression cannot be parsed from natural language, ask the user for clarification rather than guessing
- If a duplicate job exists, ask user whether to replace or rename
- If crontab modification fails, report the specific error message to the user
- If the user's schedule is ambiguous (e.g., "at 8" -- 8am or 8pm?), ask for clarification
- After 3 failed registration attempts, check crontab permissions and escalate
- Stop if the user cancels or decides not to schedule
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Schedule intent parsed correctly from natural language
- [ ] Cron expression generated and validated
- [ ] No duplicate jobs with the same schedule
- [ ] Job added to system crontab
- [ ] Registration verified via `crontab -l`
- [ ] User shown human-readable schedule and next run times
- [ ] Timezone handled correctly (default to local if unspecified)
</Final_Checklist>

<Advanced>
## Cron Expression Reference

### Field Ranges
| Field | Allowed Values | Special Characters |
|-------|---------------|-------------------|
| Minute | 0-59 | * , - / |
| Hour | 0-23 | * , - / |
| Day of Month | 1-31 | * , - / |
| Month | 1-12 | * , - / |
| Day of Week | 0-6 (Sun=0) | * , - / |

### Complex Expression Examples
| Expression | Meaning |
|-----------|---------|
| `0 0 */2 * *` | Every other day at midnight |
| `0 9-17 * * 1-5` | Every hour 9am-5pm weekdays |
| `0 0 1,15 * *` | 1st and 15th of each month |
| `30 4 * * 0` | 4:30 AM every Sunday |
| `0 */4 * * *` | Every 4 hours |
| `0 8 * * 1-5` | Weekdays at 8 AM |
| `*/10 * * * *` | Every 10 minutes |
| `0 0 * * 6,0` | Midnight on weekends |

### System Crontab Management

System crontab provides standard scheduling with:
- **Comments for names**: Use `# job-name` comments to identify jobs
- **Standard cron syntax**: 5-field expressions (minute hour day month weekday)
- **System-level scheduling**: Jobs run even when user is not logged in
- **Timezone support**: Set `TZ` environment variable in crontab for specific timezones

### Timezone Handling

When the user specifies a timezone:
1. Validate it is a valid IANA timezone (e.g., "America/New_York", "Asia/Seoul", "Europe/London")
2. Pass it as the `timezone` parameter to `sc_cron_add`
3. Show scheduled times in both the specified timezone and UTC

Common timezone shortcuts:
| Shortcut | IANA Zone |
|----------|-----------|
| KST | Asia/Seoul |
| EST | America/New_York |
| PST | America/Los_Angeles |
| UTC | UTC |
| JST | Asia/Tokyo |
| CET | Europe/Berlin |

### Monitoring Cron Failures

Set up logging and monitoring for cron jobs:
```bash
# Add logging to crontab entries
*/30 * * * * /path/to/script.sh >> /var/log/cron-heartbeat.log 2>&1
```

This captures stdout and stderr for debugging failed jobs.

### Modifying Existing Jobs

To modify a job, edit the crontab:
```bash
crontab -e  # Opens editor to modify cron entries
```

Or programmatically:
```bash
crontab -l | sed '/old-job/d' | crontab -  # Remove old job
crontab -l > /tmp/crontab.txt
echo "0 9 * * 1-5 /path/to/cmd # old-job" >> /tmp/crontab.txt
crontab /tmp/crontab.txt
```

### Troubleshooting

| Issue | Resolution |
|-------|-----------|
| Job not running | Check `crontab -l` for status. Verify cron daemon is running. |
| Wrong time execution | Check timezone configuration. Default is system local. |
| Job runs but no effect | Verify the command path is absolute and executable. |
| Duplicate job error | Remove duplicate via `crontab -e` or programmatically. |
| Expression parse error | Verify 5 fields present, values in range. Use the reference table above. |
| Crontab not updating | Check permissions. May need `sudo` for system-wide crontab. |
</Advanced>
