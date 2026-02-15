---
name: experiment-log
description: Track experiment parameters, results, and observations with full reproducibility
allowed-tools: Read, Write, Bash, Grep, Glob
---

<Purpose>
Log experiments with full reproducibility information -- parameters, results, git commit, environment snapshot, and links to related papers. Every experiment gets a unique ID, a hypothesis, recorded parameters, captured results, and comparison against previous runs. This creates a persistent, queryable experiment history that prevents repeated failures and enables systematic iteration.
</Purpose>

<Use_When>
- User says "log experiment", "record results", "track results"
- User asks "what did we try?", "what worked?", "what failed?"
- User wants to compare experiment runs or parameter configurations
- User says "reproduce", "reproducibility", "replicate"
- User is about to run an experiment and wants to capture the setup
- User finishes an experiment and wants to record outcomes
- User says "experiment", "run", "trial", "parameter sweep"
</Use_When>

<Do_Not_Use_When>
- Data analysis or statistical testing on results -- use `research-analysis` instead
- Reading or reviewing academic papers -- use `paper-review` instead
- General research or literature search -- use `lit-review` or `research` instead
- One-time script execution without tracking -- just use Bash directly
- Logging non-experiment events (deploys, incidents) -- use `dev-workflow` instead
</Do_Not_Use_When>

<Why_This_Exists>
Experiments without systematic logging lead to three critical failures: (1) lost insights when you cannot remember what parameters produced good results, (2) irreproducible results when the environment, commit, or exact command is not captured, and (3) repeated failures when you retry configurations that already failed. Every experiment needs parameters, results, environment context, and a reproducibility trail stored persistently.
</Why_This_Exists>

<Execution_Policy>
- Every experiment gets a unique ID in the format `exp-YYYYMMDD-HHMMSS-<short-hash>`
- Always capture git commit hash and dirty status before logging
- Always capture relevant environment variables and package versions
- Compare against previous experiments on the same topic automatically
- Store all experiment data in both the knowledge graph and a local JSON log
- Default model routing: experiment-tracker agent at sonnet tier
- Never overwrite existing experiment entries -- append only
</Execution_Policy>

<Steps>
1. **Register Experiment**: Create experiment entry with metadata
   - Generate unique experiment ID: `exp-YYYYMMDD-HHMMSS-<hash>`
   - Record hypothesis: What do you expect to happen and why?
   - Record parameters: All configurable values being tested
   - Record baseline: What are you comparing against?
   ```
   sc_memory_add_entity(
     name="exp-20240115-143022-a1b2",
     type="experiment",
     properties={hypothesis, parameters, baseline, status: "registered"}
   )
   ```

2. **Capture Environment**: Snapshot the execution context
   - Git commit: `git rev-parse HEAD` and `git diff --stat`
   - Branch: `git branch --show-current`
   - Package versions: language-specific (pip freeze, npm list, etc.)
   - System info: OS, CPU, memory, GPU if applicable
   - Environment variables: Relevant env vars (filtered for secrets)
   ```bash
   git rev-parse HEAD
   git diff --stat
   python --version 2>/dev/null || node --version 2>/dev/null
   ```

3. **Execute** (optional): Run the experiment command if provided
   - Capture stdout/stderr
   - Record wall-clock time
   - Record exit code
   - If long-running, use `run_in_background: true`

4. **Record Results**: Log outcomes and observations
   - Primary metric(s) with exact values
   - Secondary metrics
   - Observations and qualitative notes
   - Error messages if the experiment failed
   - Artifacts produced (model files, plots, logs)
   ```
   sc_memory_add_relation(
     from="exp-20240115-143022-a1b2",
     to="result-accuracy-0.847",
     type="produced_result"
   )
   ```

5. **Compare with Previous**: Query memory for related experiments
   ```
   sc_memory_search(query="experiment <topic>", category="experiment")
   sc_memory_graph_query(query="experiments with method=<method>")
   ```
   - Generate comparison table: parameters vs results across runs
   - Highlight improvements, regressions, and anomalies
   - Note which parameter changes correlated with result changes

6. **Store Persistently**: Save complete experiment record
   - Knowledge graph: entity + relations
   - Local JSON log: `~/superclaw/data/experiments/<exp-id>.json`
   - Memory store: searchable text record
   ```
   sc_memory_store(
     content="Experiment <id>: <summary>",
     category="experiment",
     confidence=1.0
   )
   ```
</Steps>

<Tool_Usage>
- `sc_memory_store` -- Save searchable experiment summary
- `sc_memory_search` -- Find previous experiments on the same topic
- `sc_memory_add_entity` -- Create experiment entity in knowledge graph
- `sc_memory_add_relation` -- Link experiments to results, methods, and papers
- `sc_memory_graph_query` -- Query experiment history for comparisons
- `Bash` -- Capture git state, environment, run experiments, measure timing
- `Write` -- Save experiment JSON logs to `~/superclaw/data/experiments/`
- `Read` -- Load previous experiment logs for comparison
- `Grep` -- Search experiment logs for specific parameters or results
- `Glob` -- Find experiment log files matching patterns
</Tool_Usage>

<Examples>
<Good>
User: "log experiment: learning rate 0.001 with batch size 32, got accuracy 0.847"
Action:
1. Generate ID: exp-20240115-143022-a1b2
2. Capture git commit: abc123 (clean)
3. Record: hypothesis="lower LR improves accuracy", params={lr: 0.001, batch: 32}, result={accuracy: 0.847}
4. Search memory: found 3 previous experiments on same model
5. Comparison table shows lr=0.001 is best so far (previous: 0.82, 0.83, 0.79)
6. Store entity + relations + JSON log
7. Present comparison table to user
Why good: Full capture, automatic comparison, persistent storage.
</Good>

<Good>
User: "what experiments have we run on the transformer model?"
Action:
1. Search memory for experiments mentioning "transformer"
2. Load JSON logs for each matching experiment
3. Generate comparison table sorted by primary metric
4. Highlight best configuration and trend
Why good: Leverages stored history for insight.
</Good>

<Bad>
User: "log experiment: accuracy was 0.85"
Action: Storing "accuracy 0.85" in memory.
Why bad: No experiment ID, no parameters, no git state, no environment, no comparison. This is a bare number with no reproducibility context.
</Bad>

<Bad>
User: "analyze the correlation between learning rate and accuracy across our experiments"
Action: Running experiment-log skill.
Why bad: This is statistical analysis, not logging. Use `research-analysis` skill instead.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- If git state cannot be captured (not a git repo), log without it but warn the user about reduced reproducibility
- If the experiment command fails, still log the failure with error details (failed experiments are valuable data)
- If no previous experiments exist for comparison, skip the comparison step and note this is the first run
- If memory storage fails, save the JSON log locally and retry memory storage later
- If the user provides incomplete parameters, ask for the missing critical ones before logging
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Unique experiment ID generated
- [ ] Hypothesis or objective recorded
- [ ] All parameters captured with exact values
- [ ] Git commit hash and dirty status recorded
- [ ] Environment snapshot taken (versions, system info)
- [ ] Results recorded with primary and secondary metrics
- [ ] Comparison with previous experiments generated (if any exist)
- [ ] Experiment entity stored in knowledge graph
- [ ] JSON log saved to ~/superclaw/data/experiments/
- [ ] Searchable summary stored in memory
</Final_Checklist>

<Advanced>
## Experiment JSON Schema

```json
{
  "id": "exp-20240115-143022-a1b2",
  "timestamp": "2024-01-15T14:30:22Z",
  "hypothesis": "Lower learning rate will improve convergence",
  "parameters": {
    "learning_rate": 0.001,
    "batch_size": 32,
    "epochs": 100,
    "optimizer": "adam"
  },
  "environment": {
    "git_commit": "abc123def456",
    "git_branch": "feature/experiment",
    "git_dirty": false,
    "python_version": "3.11.5",
    "packages": {"torch": "2.1.0", "numpy": "1.24.0"},
    "system": {"os": "Darwin 24.6.0", "cpu": "Apple M2", "memory": "16GB"}
  },
  "command": "python train.py --lr 0.001 --batch 32",
  "results": {
    "primary": {"accuracy": 0.847, "loss": 0.312},
    "secondary": {"training_time_s": 3600, "peak_memory_mb": 4096},
    "artifacts": ["models/exp-a1b2.pt", "plots/loss-curve-a1b2.png"]
  },
  "observations": "Model converged faster than lr=0.01 run. No overfitting observed.",
  "status": "completed",
  "linked_paper": "attention-is-all-you-need-2017",
  "tags": ["transformer", "learning-rate-search"]
}
```

## Comparison Table Format

```
| Exp ID    | LR     | Batch | Accuracy | Loss  | Time   | Status    |
|-----------|--------|-------|----------|-------|--------|-----------|
| exp-a1b2  | 0.001  | 32    | 0.847    | 0.312 | 60min  | completed |
| exp-c3d4  | 0.01   | 32    | 0.823    | 0.389 | 45min  | completed |
| exp-e5f6  | 0.001  | 64    | 0.831    | 0.341 | 50min  | completed |
| exp-g7h8  | 0.1    | 32    | 0.790    | 0.567 | 30min  | completed |
```

## Reproducibility Checklist Template

- [ ] Exact command recorded
- [ ] Git commit pinned (clean state preferred)
- [ ] Random seeds fixed and recorded
- [ ] Package versions frozen
- [ ] Data version or hash recorded
- [ ] Hardware specs noted (GPU model if used)
- [ ] Environment variables captured

## Automated Parameter Sweeps

For systematic parameter exploration:
1. Define parameter grid: `{lr: [0.001, 0.01, 0.1], batch: [16, 32, 64]}`
2. Generate experiment entries for each combination
3. Execute sequentially or in parallel (if resources allow)
4. Auto-generate comparison table on completion
5. Highlight Pareto-optimal configurations

## Linking to Papers

When an experiment is inspired by or replicates a paper:
```
sc_memory_add_relation(
  from="exp-20240115-143022-a1b2",
  to="attention-is-all-you-need-2017",
  type="replicates"
)
```
Relation types: `replicates`, `inspired_by`, `extends`, `contradicts`

## Exporting to CSV

Generate CSV from experiment history for external analysis:
```bash
# Query all experiments, format as CSV
sc_memory_search(query="experiment", category="experiment")
# Parse results into CSV format
```
Output to `~/superclaw/data/experiments/export-YYYYMMDD.csv`

## Troubleshooting

**Experiment ID collision?**
- IDs include timestamp + hash, collisions are extremely unlikely
- If it happens, append a counter suffix: `-a1b2-2`

**Git state capture failing?**
- Verify the working directory is a git repository
- For non-git projects, skip git capture but log a warning

**Comparison table too large?**
- Filter by date range, tags, or specific parameters
- Show only the top N experiments by primary metric
</Advanced>
