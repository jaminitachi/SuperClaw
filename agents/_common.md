---
name: _common
description: Shared rules for all SuperClaw v4 team agents
---

## Core Rules (ALL agents)

1. **Evidence-based only**: Never speculate. Cite file:line for every claim.
2. **Memory recall first**: Before starting, run `sc_memory_search` for prior context.
3. **Minimal output**: Report what changed, what was verified, what's blocked. No filler.
4. **Failure reporting**: If blocked after 3 attempts, report BLOCKED with specific reason.
5. **4-Status Protocol**: End every task with exactly one of:
   - DONE — task complete, evidence attached
   - DONE_WITH_CONCERNS — complete but risks identified
   - BLOCKED — cannot proceed, reason given
   - NEEDS_CONTEXT — missing information, specific question asked

## Minimalism / 미니멀리즘 (ALL agents)

**YAGNI decision ladder** — stop at the first rung that holds:
1. Does this need to exist? If no, skip it entirely.
2. Does stdlib do it? Use stdlib.
3. Is there a native platform feature? Use it.
4. Is there an already-installed dependency? Use it.
5. Is it a one-liner? Write the one-liner.
6. Only then: write the minimum that works.

**Safety floors** — never simplify these away:
- Trust-boundary input validation
- Data-loss error handling
- Security controls
- Accessibility requirements
- Hardware calibration logic
- Anything explicitly requested by the user

Lazy = efficient, not careless.

**`ponytail:` debt-comment convention** — every deliberate shortcut gets an inline comment naming the ceiling AND the upgrade trigger:
```
// ponytail: global lock; per-account locks if throughput matters
```
A shortcut with no upgrade trigger is a silent-rot risk. Do not merge shortcuts without a `ponytail:` comment.

## Claude Code Harness Tools (ALL agents MUST use)

You are running inside Claude Code. These built-in tools are available:

### Planning & Tracking
- **EnterPlanMode** — Use before starting complex tasks. Explore codebase first, then plan.
- **ExitPlanMode** — Present plan for approval. Gates will check this.
- **TaskCreate** — Break work into trackable sub-tasks. Always create tasks for multi-step work.
- **TaskUpdate** — Mark tasks in_progress when starting, completed when done.

### Code Operations
- **Read** — Read files (NOT cat/head). Always read before editing.
- **Write** — Create new files. Read first if file exists.
- **Edit** — Modify existing files with exact string replacement.
- **Grep** — Search file contents (NOT grep command).
- **Glob** — Find files by pattern (NOT find command).
- **Bash** — System commands, git, npm, test execution.

### Delegation
- **Agent** — Spawn sub-agents for parallel work. Use subagent_type parameter.

### Important: Context
You receive your task via the `prompt` parameter of the Agent tool. This prompt contains:
- Your specific task description
- Relevant context from the parent session
- File paths and acceptance criteria

You do NOT have access to the parent session's full conversation. Work with what's in your prompt.

## Tool Usage (ALL agents)

- **Memory**: sc_memory_store (save findings), sc_memory_search (recall prior work)
- **Verification**: Always run `npm test` or `npx tsc --noEmit` after code changes
- **Multi-model** (--debate 모드에서만): For critical decisions, use `node ~/superclaw/tools/ask-model.mjs --cross-validate`

## Communication

- Results are saved to inbox JSONL: `~/.claude/.sc/inbox/{session}/{team}.jsonl`
- Each entry: `{"timestamp", "agent", "status", "summary", "files_changed", "evidence"}`
