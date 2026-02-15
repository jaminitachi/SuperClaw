---
name: research-analysis
description: Statistical analysis of collected data with hypothesis-driven methodology
allowed-tools: Read, Write, Bash, Grep, Glob
---

<Purpose>
Analyze data from SuperClaw's heartbeat metrics, experiment results, or external datasets with scientific rigor. This skill applies hypothesis-driven statistical methodology -- stating objectives, exploring data, running appropriate tests, generating visualizations, documenting limitations, and storing results. It bridges the gap between raw data and actionable insights with proper statistical reasoning.
</Purpose>

<Use_When>
- User says "analyze data", "correlate", "statistics", "what's the trend?"
- User wants to visualize data: "plot this", "chart", "graph", "show me"
- User asks "compare metrics", "is X correlated with Y?", "hypothesis test"
- User wants to analyze heartbeat metrics over time
- User wants to analyze experiment results from experiment-log
- User provides a dataset (CSV, JSON, database) for analysis
- User asks "what's significant?", "is this result meaningful?"
</Use_When>

<Do_Not_Use_When>
- Simple data lookup: "what's the latest metric value?" -- use memory-curator-low directly
- Paper reading or literature review -- use `paper-review` or `lit-review`
- Logging experiment parameters and results -- use `experiment-log` instead
- Web research or information gathering -- use `research` skill instead
- Generating reports without analysis -- use `dev-workflow` instead
</Do_Not_Use_When>

<Why_This_Exists>
Raw data without proper analysis leads to false conclusions. Eyeballing charts misses significance, cherry-picked metrics mislead, and missing controls invalidate comparisons. This skill enforces scientific rigor: every analysis states its objective, documents its methodology, tests for significance, visualizes results with proper labeling, and acknowledges limitations. The difference between "it looks like X improved" and "X improved by 12% (p=0.003, n=150)" is the difference between guessing and knowing.
</Why_This_Exists>

<Execution_Policy>
- Every analysis starts with a clearly stated objective
- Always explore data before testing hypotheses (descriptive stats first)
- Use appropriate statistical tests -- do not default to t-tests for everything
- All visualizations must have labeled axes, titles, and legends
- Report effect sizes alongside p-values (statistical significance is not practical significance)
- Document all assumptions made and whether they were validated
- Save all plots to ~/superclaw/data/analysis/ with descriptive filenames
- Store analysis results in memory for longitudinal tracking
- Default model routing: data-analyst agent at sonnet tier, python_repl for computation
</Execution_Policy>

<Steps>
1. **State Objective**: Define what the analysis aims to answer [OBJECTIVE]
   - Research question: What specific question are we answering?
   - Hypothesis (if applicable): What do we expect to find?
   - Success criteria: What would constitute a meaningful result?

2. **Load and Explore Data**: Use data-analyst agent to understand the data [DATA]
   ```python
   import pandas as pd
   import numpy as np

   # Load data
   df = pd.read_csv("data.csv")  # or from memory, JSON, etc.

   # Descriptive statistics
   print(df.describe())
   print(df.info())
   print(df.isnull().sum())
   ```
   - Shape: rows, columns, types
   - Distributions: mean, median, std, skew, outliers
   - Missing data: count, patterns, imputation strategy
   - Data quality: duplicates, invalid values, range checks

3. **Analyze**: Execute appropriate statistical methods [FINDING] [STAT:*]
   - Choose test based on data type and question:

   | Question Type | Data Type | Recommended Test |
   |---------------|-----------|------------------|
   | Group comparison (2 groups) | Continuous, normal | Independent t-test |
   | Group comparison (2 groups) | Continuous, non-normal | Mann-Whitney U |
   | Group comparison (3+ groups) | Continuous, normal | One-way ANOVA |
   | Group comparison (3+ groups) | Continuous, non-normal | Kruskal-Wallis |
   | Correlation | Continuous, continuous | Pearson r (normal) or Spearman rho |
   | Trend over time | Time series | Linear regression, Mann-Kendall |
   | Proportion comparison | Categorical | Chi-squared, Fisher's exact |
   | Prediction | Mixed | Linear/logistic regression |

   - Report: test statistic, p-value, effect size, confidence interval
   - Tag results: `[STAT:test_name] statistic=X, p=Y, effect=Z, CI=[a,b]`

4. **Visualize**: Generate publication-quality plots [FIGURE]
   ```python
   import matplotlib.pyplot as plt
   import matplotlib
   matplotlib.use('Agg')  # Non-interactive backend

   fig, ax = plt.subplots(figsize=(10, 6))
   # ... plot code ...
   ax.set_xlabel("X Label")
   ax.set_ylabel("Y Label")
   ax.set_title("Descriptive Title")
   ax.legend()
   plt.tight_layout()
   plt.savefig(os.path.expanduser("~/superclaw/data/analysis/plot-name.png"), dpi=150)
   ```
   - Save all plots to `~/superclaw/data/analysis/`
   - Use descriptive filenames: `<topic>-<chart-type>-<date>.png`
   - Common plot types: scatter, line, bar, box, histogram, heatmap

5. **Document Limitations**: Record caveats and assumptions [LIMITATION]
   - Sample size adequacy
   - Assumption violations (normality, independence, homoscedasticity)
   - Confounding variables not controlled for
   - Data quality issues that may affect results
   - Generalizability constraints

6. **Store Results**: Persist analysis in memory
   ```
   sc_memory_store(
     content="Analysis: <objective>. Finding: <result>. Stat: <test> p=<value>",
     category="analysis",
     confidence=0.85
   )
   sc_memory_add_entity(name="analysis-<id>", type="analysis", properties={...})
   sc_memory_add_relation(from="analysis-<id>", to="exp-<id>", type="analyzes")
   ```

7. **Report**: Generate formatted analysis report
   - Objective and hypothesis
   - Data description (source, size, quality)
   - Key findings with statistical evidence
   - Visualizations with interpretations
   - Limitations and caveats
   - Actionable recommendations
</Steps>

<Tool_Usage>
- `python_repl` -- Execute pandas, numpy, scipy, matplotlib, seaborn for all computations
- `sc_memory_search` -- Find historical data, previous analyses, experiment results
- `sc_memory_store` -- Save analysis results for longitudinal tracking
- `sc_memory_add_entity` -- Create analysis entities in knowledge graph
- `sc_memory_add_relation` -- Link analyses to experiments, papers, and metrics
- `sc_memory_graph_query` -- Query historical analysis trends
- `Read` -- Load CSV, JSON, or other data files
- `Write` -- Save analysis reports and exported data
- `Bash` -- Data preprocessing, file manipulation, environment setup
- `Grep` -- Search data files for specific patterns or values
</Tool_Usage>

<Examples>
<Good>
User: "analyze the correlation between CPU usage and response time from heartbeat data"
Action:
1. Objective: Determine if CPU usage correlates with API response time
2. Load heartbeat metrics from memory, filter last 30 days, N=720 data points
3. Descriptive stats: CPU mean=45%, response_time mean=120ms
4. Normality check: Shapiro-Wilk p=0.03 (non-normal), use Spearman
5. Spearman rho=0.67, p<0.001, 95% CI [0.61, 0.73]
6. Scatter plot with regression line saved to ~/superclaw/data/analysis/cpu-response-correlation.png
7. Limitation: Correlation does not imply causation, other factors (memory, network) not controlled
8. Store finding in memory, link to heartbeat data
9. Recommendation: Investigate if CPU throttling at >70% causes response degradation
Why good: Proper test selection (non-normal data), effect size reported, limitation documented, actionable insight.
</Good>

<Good>
User: "compare experiment results between method A and method B"
Action:
1. Load experiment results from experiment-log entries
2. Check assumptions: normality, equal variance
3. Run appropriate comparison test
4. Generate box plot with individual data points
5. Report with effect size and practical significance assessment
Why good: Connects to experiment-log data, proper statistical comparison.
</Good>

<Bad>
User: "analyze the data"
Action: Running t-test on the first two columns.
Why bad: No objective stated, no exploration, arbitrary test choice, no visualization, no limitations. Should ask: "What data and what question do you want answered?"
</Bad>

<Bad>
User: "is X better than Y?"
Action: "Yes, X has a higher mean (0.85 vs 0.82)"
Why bad: No significance test, no effect size, no confidence interval, no consideration of variance. A 0.03 difference could easily be noise.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- If the data is too small for meaningful statistical testing (n<10), report descriptive statistics only and warn about low power
- If multiple comparisons are needed, apply Bonferroni or FDR correction and explain why
- If assumptions are severely violated and no non-parametric alternative exists, report the limitation prominently
- If the user's question cannot be answered with the available data, explain what additional data would be needed
- If analysis reveals unexpected patterns (outliers, bimodal distributions), pause to investigate before proceeding with tests
- After 3 failed computation attempts (library errors, data format issues), report the technical blocker
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Analysis objective clearly stated
- [ ] Data explored with descriptive statistics before hypothesis testing
- [ ] Appropriate statistical test selected with justification
- [ ] Results include: test statistic, p-value, effect size, confidence interval
- [ ] Visualizations have labeled axes, titles, legends, and are saved to disk
- [ ] Limitations and assumption violations documented
- [ ] Confounding variables identified (even if not controlled)
- [ ] Results stored in memory for future reference
- [ ] Actionable recommendations provided based on findings
- [ ] No unsupported causal claims (correlation vs causation distinguished)
</Final_Checklist>

<Advanced>
## Common Analysis Patterns

### Time Series Analysis
```python
from scipy import stats

# Mann-Kendall trend test
trend_stat, trend_p = stats.kendalltau(range(len(data)), data)
# Seasonal decomposition
from statsmodels.tsa.seasonal import seasonal_decompose
result = seasonal_decompose(data, period=24)  # hourly data, daily seasonality
```

### A/B Comparison
```python
from scipy.stats import mannwhitneyu, ttest_ind

# Check normality first
_, norm_p_a = stats.shapiro(group_a)
_, norm_p_b = stats.shapiro(group_b)

if norm_p_a > 0.05 and norm_p_b > 0.05:
    stat, p = ttest_ind(group_a, group_b)
    test_name = "Independent t-test"
else:
    stat, p = mannwhitneyu(group_a, group_b)
    test_name = "Mann-Whitney U"

# Effect size (Cohen's d)
cohens_d = (np.mean(group_a) - np.mean(group_b)) / np.sqrt(
    (np.std(group_a)**2 + np.std(group_b)**2) / 2
)
```

### Correlation Matrix
```python
import seaborn as sns

corr = df[numeric_columns].corr(method='spearman')
fig, ax = plt.subplots(figsize=(12, 10))
sns.heatmap(corr, annot=True, cmap='coolwarm', center=0, ax=ax)
plt.title("Spearman Correlation Matrix")
plt.savefig("~/superclaw/data/analysis/correlation-matrix.png", dpi=150)
```

## Statistical Test Selection Guide

```
Is the outcome continuous?
├── Yes: How many groups?
│   ├── 2: Normal distribution?
│   │   ├── Yes: Independent t-test (or paired t-test if matched)
│   │   └── No: Mann-Whitney U (or Wilcoxon signed-rank if paired)
│   └── 3+: Normal distribution?
│       ├── Yes: One-way ANOVA (+ post-hoc Tukey HSD)
│       └── No: Kruskal-Wallis (+ post-hoc Dunn's test)
└── No: Categorical outcome?
    ├── Binary: Logistic regression or Chi-squared
    └── Multi-class: Multinomial logistic or Chi-squared
```

## Automated Reporting

Generate a standardized analysis report:
```markdown
# Analysis Report: <title>
**Date:** YYYY-MM-DD
**Analyst:** SuperClaw Research Analysis

## Objective
<stated objective>

## Data Summary
- Source: <where data came from>
- N = <sample size>
- Variables: <list>
- Quality: <issues found>

## Results
<findings with statistics>

## Visualizations
<embedded or linked plots>

## Limitations
<documented caveats>

## Recommendations
<actionable next steps>
```

## Connecting Analysis to Experiments

Link analysis back to experiment-log entries:
```
sc_memory_add_relation(from="analysis-20240115", to="exp-a1b2", type="analyzes")
sc_memory_add_relation(from="analysis-20240115", to="exp-c3d4", type="analyzes")
```
This enables queries like: "show all analyses that included experiment X"

## Troubleshooting

**Python library not available?**
- Core libraries (pandas, numpy, scipy, matplotlib) should be pre-installed
- For seaborn or statsmodels: `pip install seaborn statsmodels`
- Fall back to scipy for most statistical tests

**Data too large for memory?**
- Use chunked reading: `pd.read_csv(file, chunksize=10000)`
- Compute statistics incrementally
- Sample if full analysis is not feasible

**Plot not rendering?**
- Ensure `matplotlib.use('Agg')` is set before importing pyplot
- Check file path permissions for saving
- Verify the data directory exists: `~/superclaw/data/analysis/`
</Advanced>
