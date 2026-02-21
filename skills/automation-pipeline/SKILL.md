---
name: automation-pipeline
description: Build and run composable data/automation pipelines with triggers
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

<Purpose>
Automation Pipeline designs, builds, and executes multi-step automation pipelines that chain collectors, transforms, and actions into composable workflows. Pipelines can be triggered by cron schedules, webhooks, or events. Unlike agent-chaining pipelines (which chain agents sequentially), this skill builds data/automation pipelines that process information through defined stages -- collect data, transform it, and take action on the results.
</Purpose>

<Use_When>
- User says "pipeline", "automate", "workflow", "chain steps"
- User describes recurring workflows: "every morning send me a brief", "when CI fails notify me"
- User says "schedule", "morning brief", "deploy monitor", "meeting prep"
- User wants to connect multiple data sources into a single report
- User needs event-driven automation (webhook triggers, file watchers)
- User asks to "chain" collectors, transforms, and actions together
</Use_When>

<Do_Not_Use_When>
- Simple one-shot action with no chaining (use telegram-control or mac-control directly)
- Agent-to-agent chaining for code tasks (use agent Task tool for sequential agent chaining)
- Single cron job with no pipeline logic (use cron-mgr instead)
- Task requires human-in-the-loop approval at each step (not yet supported)
- The workflow is truly one-off with no recurrence value
</Do_Not_Use_When>

<Why_This_Exists>
Many useful automations require chaining multiple steps: collect system metrics, check if any exceed thresholds, format a report, send it to Telegram. Without a pipeline abstraction, each step must be manually orchestrated every time. Automation Pipeline provides a declarative JSON schema for defining these chains, a registry for storing them, and trigger mechanisms for running them automatically. This turns multi-step manual workflows into fire-and-forget automation.
</Why_This_Exists>

<Execution_Policy>
- Pipelines are defined as JSON objects following the pipeline schema below
- Every pipeline MUST have at least one collector step and one action step
- Transforms are optional but recommended for non-trivial data processing
- All pipelines must be validated before registration (dry run)
- Recurring pipelines must use cron triggers via sc_cron_add
- Pipeline definitions are stored in ~/superclaw/data/pipelines/
- Always test with a dry run before scheduling for production
- Error recovery strategy must be defined for each pipeline (fail-fast, skip-step, or retry)
</Execution_Policy>

<Steps>
1. **Define pipeline goal**: Clarify what the pipeline should accomplish. Identify the data sources (collectors), any processing needed (transforms), and the desired output (actions).

2. **Select step types**: Choose from the available step types:

   **Collectors** (data sources):
   | Collector | Description | Config |
   |-----------|-------------|--------|
   | `system-metrics` | CPU, memory, disk usage | `{ thresholds: { cpu: 80, mem: 85, disk: 90 } }` |
   | `github-status` | CI status, open PRs, issues | `{ repos: ["owner/repo"], checks: true }` |
   | `calendar-events` | Upcoming calendar events | `{ hours_ahead: 24, calendars: ["Work"] }` |
   | `sentry-errors` | Recent error reports | `{ project: "my-app", hours: 24 }` |
   | `process-monitor` | Running process health | `{ watch: ["node", "postgres"] }` |
   | `file-watcher` | File system changes | `{ paths: ["/src"], extensions: [".ts"] }` |
   | `custom-script` | Run arbitrary script | `{ command: "node script.js", parse: "json" }` |

   **Transforms** (data processing):
   | Transform | Description | Config |
   |-----------|-------------|--------|
   | `filter` | Filter items by condition | `{ field: "status", operator: "eq", value: "failed" }` |
   | `aggregate` | Summarize/count/average | `{ operation: "count", group_by: "severity" }` |
   | `format` | Template string rendering | `{ template: "{{count}} errors in {{project}}" }` |
   | `threshold-check` | Flag items exceeding limits | `{ field: "cpu", threshold: 80, direction: "above" }` |
   | `merge` | Combine multiple collector outputs | `{ strategy: "concat" }` |
   | `custom-script` | Run transform script | `{ command: "node transform.js" }` |

   **Actions** (outputs):
   | Action | Description | Config |
   |--------|-------------|--------|
   | `telegram-notify` | Send to Telegram | `{ channel: "telegram", format: "markdown" }` |
   | `mac-notify` | macOS notification | `{ title: "Pipeline Alert", sound: true }` |
   | `write-file` | Save to file | `{ path: "~/reports/daily.md", append: false }` |
   | `memory-store` | Store in SuperClaw memory | `{ category: "pipeline_output", confidence: 0.8 }` |
   | `webhook-post` | POST to URL | `{ url: "https://...", headers: {} }` |
   | `custom-script` | Run action script | `{ command: "node action.js" }` |

3. **Configure triggers**: Set up how the pipeline is activated:
   | Trigger | Description | Config |
   |---------|-------------|--------|
   | `cron` | Time-based schedule | `{ expression: "0 8 * * *", timezone: "local" }` |
   | `webhook` | HTTP endpoint trigger | `{ path: "/pipeline/morning", method: "POST" }` |
   | `event` | Event-driven trigger | `{ event: "ci_failure", source: "github" }` |
   | `manual` | On-demand only | `{}` |

4. **Build pipeline JSON**: Assemble the complete pipeline definition:
   ```json
   {
     "name": "pipeline-name",
     "description": "What this pipeline does",
     "version": "1.0.0",
     "trigger": { "type": "cron", "config": { "expression": "0 8 * * 1-5" } },
     "error_strategy": "skip-step",
     "steps": [
       { "id": "step-1", "type": "collector", "collector": "system-metrics", "config": {} },
       { "id": "step-2", "type": "transform", "transform": "threshold-check", "config": {}, "depends_on": ["step-1"] },
       { "id": "step-3", "type": "action", "action": "telegram-notify", "config": {}, "depends_on": ["step-2"] }
     ]
   }
   ```

5. **Validate with pipeline-builder agent**: Delegate validation to ensure the pipeline is well-formed:
   ```
   Task(subagent_type="superclaw:pipeline-builder", model="sonnet", prompt="
     Validate pipeline definition: {pipeline_json}
     Check: all step IDs unique, depends_on references valid,
     at least one collector and one action, trigger config complete
   ")
   ```

6. **Register the pipeline**: Save to ~/superclaw/data/pipelines/{name}.json

7. **Schedule if recurring**: For cron-triggered pipelines, add to system crontab:
   ```bash
   crontab -l > /tmp/crontab.txt
   echo "0 8 * * 1-5 /path/to/run-pipeline.sh {name} # pipeline:{name}" >> /tmp/crontab.txt
   crontab /tmp/crontab.txt
   ```

8. **Dry run test**: Execute the pipeline once to verify all steps work

9. **Report results**: Show the user the pipeline definition, trigger schedule, and dry run results.
</Steps>

<Tool_Usage>
- `Bash` -- Manage system crontab for scheduling, run custom scripts referenced in pipeline steps
- `sc_send_message` -- Direct message sending for testing action steps
- `sc_memory_store` -- Store pipeline execution history and results
- `sc_memory_search` -- Search for past pipeline runs and outputs
- `Write` -- Save pipeline JSON definitions to ~/superclaw/data/pipelines/
- `Read` -- Load existing pipeline definitions for modification
</Tool_Usage>

<Examples>
<Good>
Morning briefing pipeline with 3 collectors merged into a single Telegram report:
```json
{
  "name": "morning-brief",
  "description": "Daily morning briefing with system health, GitHub status, and calendar",
  "version": "1.0.0",
  "trigger": { "type": "cron", "config": { "expression": "0 8 * * 1-5", "timezone": "Asia/Seoul" } },
  "error_strategy": "skip-step",
  "steps": [
    { "id": "sys", "type": "collector", "collector": "system-metrics", "config": { "thresholds": { "cpu": 80, "mem": 85, "disk": 90 } } },
    { "id": "gh", "type": "collector", "collector": "github-status", "config": { "repos": ["user/main-app"], "checks": true } },
    { "id": "cal", "type": "collector", "collector": "calendar-events", "config": { "hours_ahead": 12 } },
    { "id": "merge", "type": "transform", "transform": "merge", "config": { "strategy": "concat" }, "depends_on": ["sys", "gh", "cal"] },
    { "id": "fmt", "type": "transform", "transform": "format", "config": { "template": "Good morning! Here is your briefing:\n\n**System**: {{sys}}\n**GitHub**: {{gh}}\n**Calendar**: {{cal}}" }, "depends_on": ["merge"] },
    { "id": "send", "type": "action", "action": "telegram-notify", "config": { "channel": "telegram", "format": "markdown" }, "depends_on": ["fmt"] }
  ]
}
```
Why good: Multiple collectors, proper dependencies, meaningful format template, cron trigger for weekdays only.
</Good>

<Good>
Deploy monitor pipeline that alerts on CI failures:
```json
{
  "name": "deploy-monitor",
  "description": "Monitor CI and alert on failures within 5 minutes",
  "version": "1.0.0",
  "trigger": { "type": "cron", "config": { "expression": "*/5 * * * *" } },
  "error_strategy": "retry",
  "steps": [
    { "id": "ci", "type": "collector", "collector": "github-status", "config": { "repos": ["user/app"], "checks": true } },
    { "id": "filter", "type": "transform", "transform": "filter", "config": { "field": "status", "operator": "eq", "value": "failure" }, "depends_on": ["ci"] },
    { "id": "alert", "type": "action", "action": "telegram-notify", "config": { "channel": "telegram", "format": "markdown", "prefix": "CI FAILURE ALERT" }, "depends_on": ["filter"] }
  ]
}
```
Why good: Frequent polling, filter for failures only, clear alert action.
</Good>

<Bad>
A pipeline with a single step that just sends a message:
```json
{
  "name": "just-send",
  "steps": [
    { "id": "send", "type": "action", "action": "telegram-notify", "config": { "message": "hello" } }
  ]
}
```
Why bad: No collector step. A single action does not need a pipeline -- use telegram-control directly.
</Bad>

<Bad>
Pipeline with circular dependencies:
```json
{
  "steps": [
    { "id": "a", "depends_on": ["b"] },
    { "id": "b", "depends_on": ["a"] }
  ]
}
```
Why bad: Circular dependency makes the pipeline impossible to execute. Validation should catch this.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- If a collector step fails during dry run, report the specific error and suggest checking the data source configuration
- If cron registration fails, fall back to manual trigger and inform the user
- If more than 2 steps fail in a single pipeline run, halt execution and report (do not continue blindly)
- If a pipeline has been failing for 3+ consecutive runs, disable it and alert the user
- Escalate to user if pipeline dependencies form a cycle (should be caught in validation)
- Stop if the user indicates the pipeline is no longer needed
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Pipeline goal clearly defined
- [ ] At least one collector and one action step present
- [ ] All step IDs unique and depends_on references valid
- [ ] Trigger configured (cron, webhook, event, or manual)
- [ ] Error strategy defined (fail-fast, skip-step, or retry)
- [ ] Pipeline JSON saved to ~/superclaw/data/pipelines/
- [ ] Dry run completed successfully
- [ ] Cron job registered if pipeline is recurring
- [ ] User shown the pipeline definition and schedule
</Final_Checklist>

<Advanced>
## Pipeline JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["name", "steps"],
  "properties": {
    "name": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "description": { "type": "string" },
    "version": { "type": "string", "default": "1.0.0" },
    "trigger": {
      "type": "object",
      "properties": {
        "type": { "enum": ["cron", "webhook", "event", "manual"] },
        "config": { "type": "object" }
      }
    },
    "error_strategy": { "enum": ["fail-fast", "skip-step", "retry"], "default": "skip-step" },
    "steps": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "type"],
        "properties": {
          "id": { "type": "string" },
          "type": { "enum": ["collector", "transform", "action"] },
          "depends_on": { "type": "array", "items": { "type": "string" } },
          "config": { "type": "object" }
        }
      }
    }
  }
}
```

## Preset Pipelines

### Meeting Prep
```json
{
  "name": "meeting-prep",
  "description": "Prepare meeting context 30 minutes before each calendar event",
  "trigger": { "type": "cron", "config": { "expression": "*/30 * * * 1-5" } },
  "error_strategy": "skip-step",
  "steps": [
    { "id": "cal", "type": "collector", "collector": "calendar-events", "config": { "hours_ahead": 1, "calendars": ["Work"] } },
    { "id": "filter", "type": "transform", "transform": "filter", "config": { "field": "minutes_until", "operator": "lte", "value": 30 }, "depends_on": ["cal"] },
    { "id": "context", "type": "collector", "collector": "custom-script", "config": { "command": "node scripts/meeting-context.js", "parse": "json" }, "depends_on": ["filter"] },
    { "id": "fmt", "type": "transform", "transform": "format", "config": { "template": "Meeting in {{minutes_until}}m: {{title}}\nAttendees: {{attendees}}\nContext: {{context}}" }, "depends_on": ["context"] },
    { "id": "notify", "type": "action", "action": "telegram-notify", "config": { "channel": "telegram" }, "depends_on": ["fmt"] }
  ]
}
```

## Custom Step Creation

Create custom collectors, transforms, or actions by using the `custom-script` type with a Node.js or shell script. Scripts receive input via stdin (JSON) and must output JSON to stdout.

```javascript
// scripts/custom-collector.js
const data = await collectMyData();
console.log(JSON.stringify({ status: "ok", data }));
```

## Conditional Branching

Use the `filter` transform with different operators to create conditional paths:
- `eq`, `neq` -- equality checks
- `gt`, `gte`, `lt`, `lte` -- numeric comparisons
- `contains`, `not_contains` -- string matching
- `exists`, `not_exists` -- field presence

Steps with empty input after filtering are skipped, allowing conditional execution of downstream actions.

## Error Recovery Strategies

| Strategy | Behavior |
|----------|----------|
| `fail-fast` | Stop entire pipeline on first error. Use for critical pipelines. |
| `skip-step` | Skip the failed step, continue with remaining. Default. |
| `retry` | Retry failed step up to 3 times with exponential backoff. |

## Pipeline Composition

Pipelines can reference other pipelines as steps using the `pipeline-ref` type:
```json
{ "id": "sub", "type": "pipeline-ref", "pipeline": "health-check", "depends_on": ["start"] }
```

This allows building complex workflows from smaller, tested pipeline components.

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| Pipeline not triggering | Check cron expression with `crontab -l`. Verify cron daemon is running. |
| Collector returns empty | Verify data source is accessible. Check config parameters. |
| Transform produces no output | Likely filter is too restrictive. Test with broader conditions. |
| Action fails silently | Check logs. Verify Telegram channel is configured. |
| Pipeline runs but no notification | Check error_strategy -- skip-step may be hiding failures. Try fail-fast for debugging. |
</Advanced>
