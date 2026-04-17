---
name: sc-health
description: Quick one-line system health check
---

# /sc-health - Quick Health Check

Run a quick health check and report in ONE line:

1. Check memory DB: `sc_memory_stats` → entry count
2. Check Telegram: `sc_telegram_status` → connected/disconnected
3. Check cron: `sc_cron_list` → active job count
4. System: uptime via `Bash: uptime`

Format output as a single line:
`Health: memory={N} entries | telegram={status} | cron={N} jobs | uptime={X}`

Do NOT write lengthy reports. ONE line only.
