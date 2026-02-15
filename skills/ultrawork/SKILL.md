---
name: ultrawork
description: Autonomous parallel execution with Ralph Loop - iterates until completion promise is fulfilled, accumulating learnings and independently verifying all results
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task, WebFetch, WebSearch
---

<Purpose>
Ultrawork is SuperClaw's autonomous execution engine that combines parallel task dispatch with Ralph Loop persistence. It takes a user's high-level goal, decomposes it, executes in parallel waves, independently verifies all results (never trusting subagent claims), accumulates learnings between iterations, and continues until the user's completion promise is satisfied or max iterations reached.
</Purpose>

<Use_When>
- User says "ulw", "ultrawork"
- User says "완료될 때까지", "끝날 때까지", "다 해줘"
- Complex multi-file tasks that benefit from parallel execution
- Tasks requiring persistence — "don't stop until done"
- User defines a completion condition (completion promise)
</Use_When>

<Do_Not_Use_When>
- Simple single-file changes — delegate directly to executor
- Pure research/exploration — use explore agents instead
- User wants manual step-by-step control
</Do_Not_Use_When>

<Why_This_Exists>
Complex development tasks fail when: (1) agents stop prematurely, (2) verification is skipped, (3) learnings from failures aren't passed forward, (4) independent tasks run sequentially instead of in parallel. Ultrawork solves all four by enforcing completion promises, independent verification, learning accumulation, and parallel dispatch.
</Why_This_Exists>

<Execution_Policy>
## Phase 0: Initialization
1. Extract or ask for **Completion Promise** — the natural language condition that defines "done"
   - Example: "All TypeScript errors fixed, tests pass, no new warnings"
   - Store in state: `completion_promise`, `max_iterations` (default: 10)
2. Store initial state via sc_learning_store (category: "decisions", content: completion promise)

## Phase 1: Planning (3-Tier Orchestration)
1. Delegate to **sc-prometheus** (opus) for requirements gathering (skip if user gave clear specs)
2. Delegate to **sc-metis** (opus) for gap analysis
3. Delegate to **sc-momus** (sonnet) for plan validation
4. If plan validation fails → loop back to prometheus with feedback

## Phase 2: Execution (Parallel Waves)
For each iteration (1 to max_iterations):

### 2a. Decompose & Route
Atlas (sc-atlas) analyzes plan and:
- Identifies independent tasks (no file conflicts)
- Assigns **category** to each task for model routing:

  **Category Routing (with fallbacks):**
  | Category | Codex Available | Gemini Available | Fallback (Claude only) |
  |----------|----------------|-----------------|----------------------|
  | ultrabrain | ask_codex (architect role) | — | Task(model="opus") |
  | deep | ask_codex (deep-executor role) | — | Task(model="opus") |
  | visual-engineering | — | ask_gemini (designer role) | Task(model="sonnet") |
  | artistry | — | ask_gemini (designer role) | Task(model="sonnet") |
  | quick | — | — | Task(model="haiku") |
  | unspecified-high | — | — | Task(model="opus") |
  | unspecified-low | — | — | Task(model="sonnet") |
  | writing | — | ask_gemini (writer role) | Task(model="haiku") |

  **Detection**: Check MCP tool availability:
  - Codex: try calling ask_codex with a minimal prompt — if error, mark unavailable
  - Gemini: try calling ask_gemini with a minimal prompt — if error, mark unavailable

### 2b. Dispatch
- Fire all independent tasks in parallel (multiple Task tool calls in one message)
- Each task prompt includes:
  - Specific atomic goal
  - Relevant learnings from previous iterations (via sc_learning_recall)
  - "Report evidence: file:line changes, build results, test results"

### 2c. Independent Verification (CRITICAL — "Never Trust Subagent Claims")
After ALL tasks in a wave complete:
1. Atlas reads EVERY changed file directly (Read tool)
2. Atlas runs `lsp_diagnostics_directory` on affected directories
3. Atlas runs relevant tests (if they exist)
4. Atlas compares claimed results vs actual state
5. Log each verification via `sc_verification_log`:
   - task_description, claimed_result, verified_result, passed (bool), evidence

### 2d. Learning Accumulation
After verification:
1. Extract learnings from this iteration:
   - **successes**: What worked well
   - **failures**: What failed and why
   - **gotchas**: Unexpected issues encountered
   - **conventions**: Patterns discovered in the codebase
   - **decisions**: Architectural choices made
2. Store each via `sc_learning_store` with iteration number
3. These learnings are injected into the next iteration's agent prompts

### 2e. Completion Evaluation
Evaluate the completion promise:
1. Read the promise: "{completion_promise}"
2. Check against actual state:
   - Run relevant commands (build, test, lint)
   - Check for remaining TODO items
   - Verify all requested features exist
3. If **FULFILLED** → exit loop, report success
4. If **NOT FULFILLED** → identify remaining gaps, create new plan for next iteration
5. If **max_iterations reached** → report partial completion with summary of what's done vs remaining

## Phase 3: Completion Report
Generate final report:
- Iterations completed: N
- Tasks executed: M
- Verification results: X passed, Y failed
- Learnings accumulated: categorized summary
- Completion promise status: FULFILLED / PARTIAL (with remaining items)
- Store comprehensive summary via sc_memory_store (category: "project-completion")
- If critical failures, alert via Telegram (sc_gateway_request)
</Execution_Policy>

<Steps>
(The detailed steps are in Execution_Policy above. Summary flow:)
1. Get/extract completion promise from user
2. Plan via 3-tier (prometheus → metis → momus)
3. Loop: decompose → route by category → dispatch parallel → verify independently → accumulate learnings → evaluate promise
4. Exit when promise fulfilled or max iterations
5. Report with evidence
</Steps>

<Output_Format>
## Ultrawork Report — Iteration {N}/{max}

### Completion Promise
> {user's completion promise}

### Status: {FULFILLED / IN_PROGRESS / PARTIAL}

### This Iteration
- Tasks dispatched: {count}
- Parallel waves: {count}
- Verification: {passed}/{total} passed

### Learnings
- Conventions: {list}
- Gotchas: {list}
- Decisions: {list}

### Remaining (if not fulfilled)
- [ ] {remaining item 1}
- [ ] {remaining item 2}

### Evidence
- Build: {command} → {result}
- Tests: {command} → {result}
- Diagnostics: {count} errors, {count} warnings
</Output_Format>

<Tool_Usage>
- `Task` — Delegate to specialized agents (sc-prometheus, sc-metis, sc-momus, sc-atlas, sc-executor-*)
- `sc_learning_store` — Accumulate learnings from each iteration
- `sc_learning_recall` — Inject learnings into next iteration's prompts
- `sc_verification_log` — Log verification results for audit trail
- `sc_memory_store` — Store completion reports for trend analysis
- `sc_gateway_request` — Send critical alerts to Telegram
- `Read` — Verify changed files, read build outputs
- `Bash` — Run builds, tests, diagnostics
- `mcp__plugin_oh-my-claudecode_t__lsp_diagnostics_directory` — Project-level type checking
- `Grep` — Search for error patterns
- `Glob` — Find test files, build outputs
</Tool_Usage>

<Examples>
<Good>
User: "ulw — fix all TypeScript errors"
Action:
1. Completion promise: "Zero TypeScript compilation errors"
2. Plan:
   - sc-prometheus: Gather list of all TS errors via lsp_diagnostics_directory
   - sc-metis: Categorize errors by type (type mismatch, missing import, etc.)
   - sc-momus: Validate plan — ensure no conflicting fixes
3. Iteration 1:
   - Atlas: Identify 8 independent files with errors
   - Dispatch 8 parallel tasks to sc-executor-low (all type fixes, low complexity)
   - Verify: Read all 8 files, run lsp_diagnostics_directory
   - Result: 6 passed, 2 failed (still have errors)
   - Store learnings: "Files src/auth.ts and src/db.ts have circular import issues"
4. Iteration 2:
   - Atlas: Create dependency graph, fix circular imports first
   - Dispatch 2 tasks to sc-executor (medium complexity)
   - Verify: Confirm all TS errors cleared
   - Result: FULFILLED
5. Report: 2 iterations, 10 tasks, all verified, completion promise fulfilled.
Why good: Parallel execution, independent verification, learning accumulation, clear completion criteria.
</Good>

<Good>
User: "다 해줘 — implement the user dashboard"
Action:
1. Ask user for completion promise: "What defines 'done' for the user dashboard?"
2. User: "Dashboard loads, shows user stats, graphs render, no errors"
3. Plan via 3-tier:
   - prometheus: Requirements for dashboard components
   - metis: Identify gaps in current codebase
   - momus: Validate plan for completeness
4. Iteration loop (parallel waves):
   - Wave 1: Create Dashboard.tsx, UserStats.tsx, GraphComponent.tsx (3 parallel tasks to sc-frontend)
   - Verify: Read files, check for TypeScript errors
   - Wave 2: Implement API calls, state management (2 parallel tasks to sc-executor)
   - Verify: Run build, check for runtime errors
   - Wave 3: Add tests (1 task to sc-test-engineer)
   - Verify: Run test suite
5. Exit when completion promise fulfilled.
Why good: Handles vague user request ("다 해줘") by clarifying completion criteria, uses 3-tier planning, parallel execution, verification at each wave.
</Good>

<Bad>
User: "fix the build"
Action: Activating ultrawork mode.
Why bad: "Fix the build" is a single-focus task, not a complex multi-file job. Should delegate directly to sc-debugger or sc-executor. Ultrawork is overkill for simple fixes.
</Bad>

<Bad>
User: "ulw — refactor the auth module"
Action: Starting ultrawork without asking for completion promise.
Why bad: "Refactor" is vague — need to establish what "done" means. Should ask: "What defines completion for this refactor? Zero TS errors? All tests passing? Specific performance target?"
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- If user's completion promise is vague or missing, STOP and ask for clarification
- If max_iterations reached and promise not fulfilled, report partial completion with remaining items
- If critical MCP tools (sc_learning_store, sc_verification_log) are unavailable, degrade gracefully but warn user
- If all subagents fail repeatedly (3+ iterations with zero progress), escalate to sc-architect for architectural review
- If verification consistently fails (5+ tasks in a row), stop and report to user — may indicate fundamental issue
- If user says "stop", "cancel", "cancelomc", exit immediately with current state report
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Completion promise explicitly defined (either given by user or asked)
- [ ] Planning completed via 3-tier (prometheus → metis → momus)
- [ ] Each iteration includes: decompose, dispatch, verify, learn, evaluate
- [ ] ALL verifications are independent (never trust subagent claims)
- [ ] Learnings accumulated and injected into subsequent iterations
- [ ] Final report includes: status, iterations, verification results, learnings, evidence
- [ ] If critical failures, Telegram alert sent
- [ ] Completion promise status clearly stated: FULFILLED / PARTIAL / IN_PROGRESS
</Final_Checklist>

<Advanced>
## Completion Promise Templates

For common task types:

**Bug Fixes:**
```
Completion Promise: "Zero occurrences of [bug description], all related tests passing, no new warnings introduced"
```

**Feature Implementation:**
```
Completion Promise: "Feature [X] implemented, user can [action], tests cover happy path and edge cases, docs updated"
```

**Refactoring:**
```
Completion Promise: "Module [X] refactored to [pattern], all existing tests passing, no new TypeScript errors, performance within [threshold]"
```

**Build Fixes:**
```
Completion Promise: "Build completes successfully (exit code 0), zero compilation errors, zero warnings"
```

## Learning Categories

Learnings are stored with these categories:

| Category | Example |
|----------|---------|
| successes | "Parallel execution of independent file changes saved 40% time" |
| failures | "Circular import fix required dependency graph analysis, not file-by-file" |
| gotchas | "Auth module uses singleton pattern — can't be refactored without breaking tests" |
| conventions | "All API calls use custom useQuery hook, not raw fetch" |
| decisions | "Chose to use context API over prop drilling for dashboard state" |

## Verification Evidence Templates

Each verification log includes:

```
{
  task_description: "Fix TypeScript error in src/auth.ts line 42",
  claimed_result: "Type error fixed by adding 'as User' cast",
  verified_result: "File read confirms cast added, lsp_diagnostics shows zero errors in auth.ts",
  passed: true,
  evidence: "lsp_diagnostics output: 0 errors, 0 warnings"
}
```

## Category Routing Examples

| Task | Category | Route |
|------|----------|-------|
| "Design new UI component layout" | artistry | ask_gemini (designer) → fallback Task(model="sonnet") |
| "Debug race condition in WebSocket handler" | ultrabrain | ask_codex (architect) → fallback Task(model="opus") |
| "Fix typo in error message" | quick | Task(model="haiku") |
| "Implement OAuth2 flow with security review" | deep | ask_codex (deep-executor) → fallback Task(model="opus") |
| "Write API documentation" | writing | ask_gemini (writer) → fallback Task(model="haiku") |
| "Add form validation" | unspecified-low | Task(model="sonnet") |

## Parallel Wave Strategy

**Wave Sizing:**
- Small tasks (<5 min): up to 10 parallel
- Medium tasks (5-20 min): up to 5 parallel
- Large tasks (>20 min): up to 3 parallel

**Dependency Detection:**
Atlas identifies conflicts:
- Same file modified by 2+ tasks → sequential
- Import dependency (A imports B) → B before A
- Test depends on implementation → implementation first

**Optimal Wave Example:**
```
Files: src/auth.ts, src/db.ts, src/api.ts, tests/auth.test.ts
Wave 1: [auth.ts, db.ts, api.ts] — all independent, fire in parallel
Wave 2: [auth.test.ts] — depends on auth.ts, runs after Wave 1
```

## Iteration Budget Tuning

Default: max_iterations = 10

**Adjust based on task scope:**
- Simple multi-file fix: max_iterations = 3
- Medium feature implementation: max_iterations = 10
- Complex refactor: max_iterations = 20
- Full system build: max_iterations = 50

**Progress Velocity Tracking:**
If iterations 1-3 show <10% progress toward completion, escalate to sc-architect for replanning.

## Integration with Other Skills

Ultrawork can be combined with:

- **ralph**: ralph activates ultrawork automatically for persistence
- **plan**: Use plan first for broad requests, then feed plan to ultrawork
- **analyze**: Run analyze before ultrawork to gather context
- **ultraqa**: Transition to ultraqa after ultrawork completes for QA cycling

**Example Flow:**
```
User: "build the entire analytics dashboard"
1. Run `plan` to gather requirements and create detailed plan
2. Activate `ultrawork` with plan as input
3. Ultrawork executes in parallel waves
4. On completion, transition to `ultraqa` for comprehensive testing
```
</Advanced>
