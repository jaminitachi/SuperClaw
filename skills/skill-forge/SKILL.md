---
name: skill-forge
description: Detect repeated patterns and auto-generate self-improving skills
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

<Purpose>
Skill Forge is SuperClaw's self-improvement engine. It analyzes session history for repeated workflow patterns (3+ similar tasks), extracts their structure, and automatically generates new SKILL.md files that codify those patterns into reusable skills. This transforms implicit tribal knowledge into explicit, version-controlled automation that any future session can invoke immediately.
</Purpose>

<Use_When>
- User explicitly says "create skill", "make a skill for", "automate this", "skill forge"
- User says "I keep doing this", "pattern", "every time I..."
- You detect 3+ similar workflows in session history or memory
- A recurring task has no existing skill coverage
- User wants to codify a workflow they repeat across sessions
- After completing a multi-step task that could benefit others
</Use_When>

<Do_Not_Use_When>
- Task is genuinely one-off with no recurrence pattern
- An existing skill already covers the workflow (check skills/ directory first)
- The pattern is too simple to justify a skill (single command, trivial alias)
- User is in the middle of urgent work and skill creation would interrupt flow
- The pattern involves sensitive credentials that should not be codified
</Do_Not_Use_When>

<Why_This_Exists>
Agents repeat similar workflows across sessions but each session starts from scratch. Without Skill Forge, the same multi-step processes get reinvented every time -- same tool sequences, same error handling, same verification steps. Skill Forge closes this loop by detecting repetition, extracting the pattern, and producing a SKILL.md that future sessions can invoke directly. This makes SuperClaw genuinely self-improving: the more you use it, the more capable it becomes.
</Why_This_Exists>

<Execution_Policy>
- Always search memory before creating a skill to confirm the pattern exists 3+ times
- Never create skills that duplicate existing ones -- check skills/ directory first
- Generated skills MUST follow the full SuperClaw SKILL.md template (all 11 sections)
- Test the draft against at least 2 past examples before installing
- Skills are installed to ~/superclaw/skills/{skill-name}/SKILL.md
- Track skill creation in memory with category "skill_metrics"
- Quality threshold: a generated skill must cover at least 80% of the pattern variants
</Execution_Policy>

<Steps>
1. **Search for patterns**: Use `sc_memory_search` to find repeated workflows in session history. Look for tasks with similar tool sequences, similar goals, or similar file patterns. Minimum threshold: 3 occurrences of a similar pattern.

2. **Extract pattern structure**: From the matched sessions, identify:
   - Common entry conditions (what triggers this workflow)
   - Required inputs and parameters
   - Step sequence (which tools in what order)
   - Variable parts (parameters that change between instances)
   - Fixed parts (steps that are always the same)
   - Error handling patterns
   - Verification/completion criteria

3. **Check for existing coverage**: Search ~/superclaw/skills/ for skills that already cover this pattern. If a skill exists but is incomplete, consider enhancing it rather than creating a new one.

4. **Generate SKILL.md draft**: Delegate to `skill-forger` agent to produce a complete SKILL.md following the SuperClaw template:
   ```
   Task(subagent_type="superclaw:skill-forger", model="sonnet", prompt="
     Generate a SKILL.md for pattern: {extracted_pattern}
     Based on {N} occurrences found in memory.
     Variable parameters: {params}
     Fixed steps: {steps}
     Must include all 11 sections: Purpose, Use_When, Do_Not_Use_When,
     Why_This_Exists, Execution_Policy, Steps, Tool_Usage, Examples,
     Escalation_And_Stop_Conditions, Final_Checklist, Advanced
   ")
   ```

5. **Validate against past examples**: Replay at least 2 past task instances against the generated skill. Confirm that:
   - The skill's Use_When triggers would have matched
   - The Steps cover all actions taken in the past instances
   - The Tool_Usage lists all tools that were actually used
   - The Final_Checklist captures the verification that was performed

6. **Install the skill**: Write the SKILL.md to ~/superclaw/skills/{skill-name}/SKILL.md. Create the directory if it does not exist.

7. **Log to skill metrics**: Store creation metadata in memory:
   ```
   sc_memory_store({
     content: "Skill created: {name} from {N} pattern occurrences",
     category: "skill_metrics",
     confidence: 0.9,
     metadata: { skill_name, pattern_count, created_at, source_sessions }
   })
   ```

8. **Report to user**: Show the user what was created, what pattern it captures, and how to invoke it. Include the trigger phrases from Use_When.
</Steps>

<Tool_Usage>
- `sc_memory_search` -- Search session history for repeated patterns. Use broad queries first, then narrow.
- `sc_memory_store` -- Log skill creation events and effectiveness metrics.
- `sc_memory_recall` -- Recall specific past sessions for pattern validation.
- `Glob` -- Search skills/ directory for existing skills that might overlap.
- `Read` -- Read existing SKILL.md files to check for coverage gaps.
- `Write` -- Write the generated SKILL.md to the skills/ directory.
- `Grep` -- Search for specific tool usage patterns across session logs.
- `Bash` -- Verify directory structure, run any validation scripts.
</Tool_Usage>

<Examples>
<Good>
User has deployed 4 projects in the past week, each time running the same sequence: build, test, tag version, push, notify Telegram. Skill Forge detects this pattern:

```
Pattern detected: "deploy-notify" (4 occurrences)
Fixed steps: npm run build -> npm test -> git tag -> git push --tags -> sc_send_message
Variable params: project_name, version_tag, telegram_channel
```

Generated skill covers all variants, includes error handling for failed builds, and triggers on "deploy", "release and notify", "push release".

Why good: Clear pattern with 4+ occurrences, well-defined variable/fixed separation, actionable triggers.
</Good>

<Good>
User asks "I keep doing this same thing to set up new React components". Skill Forge searches memory, finds 5 instances of component scaffolding with the same file structure. Generates a "react-scaffold" skill with parameterized component name, style variant, and test inclusion flag.

Why good: User explicitly requested skill creation, strong pattern evidence in memory.
</Good>

<Bad>
User runs a one-off data migration script. Skill Forge tries to create a "data-migration" skill from a single instance.

Why bad: Only 1 occurrence. Does not meet the 3+ threshold. This is a one-off task, not a pattern.
</Bad>

<Bad>
An existing "heartbeat" skill already covers system monitoring. Skill Forge creates a "system-check" skill that duplicates 90% of heartbeat's functionality.

Why bad: Failed to check existing skills first. Should have suggested enhancing heartbeat instead.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- If fewer than 3 pattern occurrences are found, inform the user and suggest they invoke Skill Forge again after more repetitions accumulate
- If the pattern is too variable (less than 50% fixed steps across instances), warn the user that the generated skill may be too generic to be useful
- If an existing skill covers 70%+ of the pattern, suggest enhancing that skill rather than creating a new one
- If memory search returns no results, check if memory is initialized and suggest running setup if not
- After 3 failed validation attempts against past examples, escalate to the user for manual review of the generated skill
- Stop if the user cancels or indicates the pattern is not worth automating
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Pattern detected with 3+ occurrences in memory
- [ ] No existing skill already covers this pattern
- [ ] SKILL.md generated with all 11 template sections
- [ ] Validated against at least 2 past task examples
- [ ] Installed to ~/superclaw/skills/{name}/SKILL.md
- [ ] Skill creation logged to memory with category "skill_metrics"
- [ ] User informed of trigger phrases and how to invoke
- [ ] No hardcoded secrets or credentials in the generated skill
</Final_Checklist>

<Advanced>
## Skill Template Reference

Every generated skill MUST include these 11 sections in the SKILL.md:

```markdown
---
name: {skill-name}
description: {one-line description}
allowed-tools: {comma-separated tool list}
---

<Purpose>...</Purpose>
<Use_When>...</Use_When>
<Do_Not_Use_When>...</Do_Not_Use_When>
<Why_This_Exists>...</Why_This_Exists>
<Execution_Policy>...</Execution_Policy>
<Steps>...</Steps>
<Tool_Usage>...</Tool_Usage>
<Examples>...</Examples>
<Escalation_And_Stop_Conditions>...</Escalation_And_Stop_Conditions>
<Final_Checklist>...</Final_Checklist>
<Advanced>...</Advanced>
```

## Quality Thresholds

| Metric | Minimum | Target |
|--------|---------|--------|
| Pattern occurrences | 3 | 5+ |
| Fixed step ratio | 50% | 70%+ |
| Validation pass rate | 2/3 examples | All examples |
| Section completeness | All 11 sections | All with examples |

## Effectiveness Tracking

After a skill is installed, Skill Forge tracks its usage over time:
- **Invocation count**: How many times the skill is triggered
- **Success rate**: Percentage of invocations that complete successfully
- **User overrides**: How often users deviate from the skill's steps
- **Staleness**: Time since last invocation (skills unused for 30+ days are flagged)

Store metrics via `sc_memory_store` with category "skill_metrics" and the skill name in metadata.

## Installation Location

Skills are installed to a single location:
- `~/superclaw/skills/{name}/SKILL.md`

This makes skills available system-wide when SuperClaw is active.

## Skill Evolution

Skills are not static. Skill Forge can also:
- **Enhance**: Add new steps or parameters when new pattern variants emerge
- **Merge**: Combine two related skills into a more general one
- **Deprecate**: Flag skills that have not been used in 60+ days
- **Version**: Track changes to skills over time via memory entries

## Troubleshooting

| Issue | Resolution |
|-------|-----------|
| Memory search returns empty | Verify memory.db exists at ~/superclaw/data/memory.db. Run setup if not. |
| Pattern too variable | Lower the fixed-step threshold or ask user to confirm which steps are essential |
| Generated skill triggers too broadly | Narrow Use_When phrases and add more Do_Not_Use_When exclusions |
| Validation fails on past examples | Review extracted pattern -- a step may have been missed or a parameter not captured |
| Duplicate skill detected | Suggest merging with existing skill rather than creating new |
</Advanced>
