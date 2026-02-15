---
name: telegram-control
description: Send messages, images, and commands via Telegram through OpenClaw gateway
allowed-tools: Read, Bash, Grep, Glob
---

<Purpose>
Bridge between Claude Code and Telegram for remote control and notifications. Enables sending
text messages, screenshots, status reports, and formatted alerts to your phone via the OpenClaw
gateway. Also handles incoming command routing so Telegram acts as a bidirectional control channel
for SuperClaw operations.
</Purpose>

<Use_When>
- User says "send to phone", "text me", "notify me", "telegram"
- User wants to share a screenshot or status update remotely
- User says "send message", "alert me", "message me when done"
- A long-running task completes and the user previously asked for notification
- User wants to route a command from Telegram (e.g., /status, /screenshot)
- User asks to set up Telegram notifications for heartbeat or CI results
</Use_When>

<Do_Not_Use_When>
- Local-only operations with no messaging need -- just run the task directly
- User has not configured the OpenClaw gateway or Telegram channel
- User wants macOS notifications only -- use mac-control with sc_notify instead
- User wants Slack messages -- use the Slack MCP tools directly
</Do_Not_Use_When>

<Why_This_Exists>
Claude Code runs on a Mac but the user is often away from the screen. Telegram provides a
persistent, mobile-accessible channel for receiving updates, screenshots, and alerts. Without
this skill, long-running builds, deployments, or monitoring tasks have no way to reach the
user when they step away. The OpenClaw gateway acts as the transport layer, handling WebSocket
connections, message queuing, and retry logic so the skill only needs to format and send.
</Why_This_Exists>

<Execution_Policy>
- Execute sequentially: check gateway first, then format, then send, then verify
- Max retries: 2 for transient gateway errors (reconnect between retries)
- Timeout: 10 seconds per send operation
- Cancel: If gateway is unreachable after 2 retries, report failure and suggest alternatives
- Never block on delivery confirmation -- Telegram delivery is async
</Execution_Policy>

<Steps>
1. **Phase 1 - Gateway Health Check**: Verify the OpenClaw gateway is reachable
   - Tool: `sc_gateway_status` (no parameters)
   - Output: Connection status JSON with gateway state, enabled channels, heartbeat config
   - If gateway is down: attempt `ensureConnected` via sc_gateway_request, retry once
   - If still down: report to user with troubleshooting steps and stop

2. **Phase 2 - Content Preparation**: Format the message for Telegram
   - Plain text: wrap in appropriate formatting (bold headers, monospace for code)
   - Screenshots: capture via `sc_screenshot` first, then reference the file path
   - Status reports: collect data, format as a structured summary with emoji indicators
   - Long messages: split at 4096 characters (Telegram message limit)
   - Markdown: Telegram supports a subset -- use *bold*, _italic_, `code`, ```pre```

3. **Phase 3 - Send Message**: Deliver via the gateway
   - Tool: `sc_send_message` with parameters:
     - `channel`: "telegram" (default)
     - `text`: formatted message string
   - For screenshots: send the text description first, then the image path
   - Returns: delivery confirmation or error

4. **Phase 4 - Command Routing** (for incoming commands):
   - Tool: `sc_route_command` with parameters:
     - `text`: command string (e.g., "/status", "/screenshot Safari", "/run morning-brief")
     - `channel`: "claude-code" (default) or source channel
   - Supported commands: /status, /screenshot [target], /run [pipeline], /ask [question], /mac [command], /memory [query]
   - Returns: command response string

5. **Phase 5 - Delivery Verification**: Confirm the message was accepted
   - Check return value from sc_send_message for success/error
   - On error: retry once with exponential backoff
   - On persistent failure: notify user locally via sc_notify as fallback
   - Log delivery status for debugging
</Steps>

<Tool_Usage>
- `sc_gateway_status` -- Check OpenClaw gateway connection health (no params)
- `sc_send_message` -- Send text to Telegram; params: `channel` (string, default "telegram"), `text` (string, the message content)
- `sc_route_command` -- Simulate an incoming command through the channel router; params: `text` (string, command like "/status"), `channel` (string, default "claude-code")
- `sc_gateway_request` -- Send raw JSON-RPC to gateway for advanced operations; params: `method` (string, e.g. "sessions.list"), `params` (optional object)
- `sc_screenshot` -- Capture screen for sending; params: `window` (optional string), `format` (optional "png"|"jpg")
- `sc_notify` -- Fallback macOS notification if Telegram is unreachable; params: `title` (string), `message` (string)
</Tool_Usage>

<Examples>
<Good>
User: "Send me a screenshot on Telegram"
Action: 1) sc_gateway_status to verify connection, 2) sc_screenshot to capture screen, 3) sc_send_message with channel="telegram" and text="Screenshot captured: [path]" plus image data
Why good: Checks gateway first, captures fresh screenshot, sends with context
</Good>

<Good>
User: "Text me when the build finishes"
Action: 1) Run the build, 2) On completion, sc_send_message with channel="telegram" and text="Build completed successfully in 2m 34s. 0 errors, 0 warnings."
Why good: Defers the Telegram send until the triggering event completes, includes useful details
</Good>

<Good>
User: "Route /status from Telegram"
Action: sc_route_command with text="/status" and channel="telegram"
Why good: Uses the command router to simulate an incoming Telegram command, returns formatted status
</Good>

<Bad>
User: "Send a message to Telegram"
Action: Immediately call sc_send_message without checking sc_gateway_status first
Why bad: Gateway may be offline; always verify connectivity before attempting to send
</Bad>

<Bad>
User: "Notify me on my phone"
Action: Use sc_notify (macOS notification) instead of sc_send_message
Why bad: sc_notify sends a local macOS notification, not a Telegram message. "Phone" implies remote notification via Telegram
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- **Stop** if gateway is unreachable after 2 connection attempts -- inform user with: "OpenClaw gateway is not running. Start it with `superclaw daemon start` or check ~/superclaw/superclaw.json"
- **Stop** if Telegram channel is not configured -- inform user: "Telegram channel not configured. Run `superclaw setup telegram` to connect your bot"
- **Escalate** if messages are sending but not arriving -- suggest checking Telegram bot token and chat ID in gateway config
- **Escalate** if gateway connects but sc_send_message returns persistent errors -- may indicate an OpenClaw version mismatch
- **Fallback** to sc_notify (macOS notification) if all remote delivery fails and user needs immediate notification
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Gateway connection verified via sc_gateway_status before any send
- [ ] Message properly formatted (within 4096 char limit, correct markdown subset)
- [ ] sc_send_message called with correct channel ("telegram") and text
- [ ] Delivery confirmation received (non-error response)
- [ ] User informed of delivery status
- [ ] For commands: sc_route_command response relayed back to user
- [ ] No sensitive data (passwords, tokens, keys) included in message text
- [ ] Fallback notification sent if Telegram delivery failed
</Final_Checklist>

<Advanced>
## Configuration

The OpenClaw gateway configuration lives in `~/superclaw/superclaw.json`:

```yaml
gateway:
  host: localhost
  port: 18789
  autoConnect: true

channels:
  telegram:
    enabled: true
    botToken: "YOUR_BOT_TOKEN"
    chatId: "YOUR_CHAT_ID"
    allowFrom:
      - "your_telegram_username"
    parseMode: "Markdown"
```

Key settings:
- `allowFrom`: Whitelist of Telegram usernames that can send commands (security)
- `parseMode`: "Markdown" or "HTML" for message formatting
- `chatId`: Your Telegram chat ID (get it from @userinfobot)

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Gateway not connected" | Daemon not running | Run `superclaw daemon start` |
| "Send failed: channel not found" | Telegram not configured | Add telegram config to superclaw.json |
| Messages send but not received | Wrong chatId or botToken | Verify with `curl https://api.telegram.org/bot<TOKEN>/getMe` |
| "allowFrom rejected" | Username not whitelisted | Add username to allowFrom array |
| Gateway connects then drops | Port conflict or firewall | Check port 18789 is free, no VPN blocking localhost |

## Common Patterns

**Notification after long task:**
```
1. Start task (build, deploy, test suite)
2. Capture result (exit code, duration, summary)
3. Format: "Task: {name}\nStatus: {pass/fail}\nDuration: {time}\nDetails: {summary}"
4. sc_send_message(channel="telegram", text=formatted)
```

**Periodic status update:**
```
1. sc_cron_add(name="status-update", schedule="0 */2 * * *", command="/status")
2. Cron triggers /status command via channel router
3. Router formats and sends to Telegram automatically
```

**Screenshot sharing:**
```
1. sc_screenshot(window="Safari") -> path
2. sc_send_message(channel="telegram", text="Safari screenshot: {path}")
```

**Command routing from Telegram:**
Supported commands the router handles:
- `/status` -- SuperClaw system status
- `/screenshot [app]` -- Request screenshot
- `/run [pipeline-name]` -- Execute a named pipeline
- `/ask [question]` -- Forward question to active agent
- `/mac [command]` -- Route to mac-control
- `/memory [query]` -- Search persistent memory
</Advanced>
