---
name: lit-review
description: Paper analysis (single or multi) with structured extraction, gap analysis, and citation graph
allowed-tools: Read, Bash, Grep, Glob, WebFetch, WebSearch
---

<Purpose>
Unified academic paper skill: handles both single-paper deep analysis and multi-paper literature reviews.

Single-paper mode: Read and extract structured information (methodology, findings, limitations, contributions) from a specific paper. Store as queryable knowledge in memory.

Multi-paper mode: Synthesize knowledge across multiple papers -- comparing methodologies, synthesizing findings, identifying research gaps, building citation graphs, and generating publication-ready related work sections.
</Purpose>

<Use_When>
- User says "read this paper", "summarize paper", "review paper", "analyze this research"
- User provides an arxiv URL, DOI link, or PDF file path
- User asks "what does this paper say about X?"
- User says "literature review", "related work", "survey of", "research landscape"
- User asks "what's known about X?", "compare papers on Y", "what are the approaches to Z?"
- User needs a related work section for a paper or proposal
- User wants to identify research gaps in a topic area
- User wants to compare methodologies across multiple papers
- User says "what has been done on <topic> since <year>?"
</Use_When>

<Do_Not_Use_When>
- Quick citation lookup ("who wrote X?") -- use research-assistant agent directly
- General web research not about academic papers -- use `research` skill instead
- Reading non-academic documents (blog posts, docs) -- use standard Read tool
</Do_Not_Use_When>

<Why_This_Exists>
Individual paper reviews miss the forest for the trees. Researchers need to understand how papers relate to each other -- which methods build on which, where findings agree or conflict, and what has NOT been studied. Manual literature reviews take days and are biased by reading order and recency. This skill systematically covers the landscape, identifies gaps, and produces structured synthesis that would take a human researcher significantly longer.
</Why_This_Exists>

<Execution_Policy>
- Always define scope boundaries before starting (topic, time range, methodology focus)
- Search existing memory first to avoid re-reading papers already stored
- Read new papers in parallel (up to 5 concurrent research-reviewer agents)
- Use opus-tier agent for cross-paper synthesis (requires complex reasoning)
- Build citation graph incrementally as papers are processed
- Output must include gap analysis -- what is NOT covered is as important as what is
- Default model routing: research-reviewer agent at sonnet (parallel), research-reviewer at opus (synthesis)
</Execution_Policy>

<Steps>
## Mode A: Single Paper Analysis

When user provides a specific paper (URL, DOI, PDF, or title):

1. **Identify Source**: Parse the paper reference
   - Arxiv URL: Extract paper ID, fetch abstract via WebFetch
   - DOI link: Resolve to full paper via WebFetch
   - PDF file path: Read directly via Read tool
   - Paper title: Search via WebSearch to locate the paper

2. **Check Existing**: Search memory for this paper
   ```
   sc_memory_search(query="<paper title or ID>", category="paper")
   ```
   - If found: Show existing entry, ask if user wants to update or view

3. **Extract Structure**: Extract structured sections:
   - [PAPER] Title, authors, year, venue, DOI/URL
   - [ABSTRACT] Core claim in 2-3 sentences
   - [METHOD] Methodology details -- dataset, approach, baselines, evaluation metrics
   - [FINDING] Key findings with statistical evidence (exact numbers, p-values, CIs)
   - [LIMITATION] Stated and unstated limitations, threats to validity
   - [CONTRIBUTION] Novel contributions claimed by authors
   - [CITATION_KEY] Papers this work builds on (for graph linking)

4. **Store in Memory**: `sc_memory_store(content="<full extraction>", category="paper", confidence=0.9)`

5. **Connect to Existing Papers**: Query memory for related work and add relations

6. **Report**: One-paragraph overview, key findings table, methodology summary, limitations, connections

## Mode B: Multi-Paper Literature Review

When user requests a review across multiple papers:

1. **Scope Definition**: Define the literature review boundaries
   - Research question: What specific question is being investigated?
   - Topic boundaries: What is in scope vs out of scope?
   - Temporal bounds: Papers from when to when?
   - Methodology focus: Any specific approaches to prioritize?
   - If scope is too broad ("tell me about AI"), ask user to narrow down

2. **Gather Existing Knowledge**: Search memory for papers already reviewed
   ```
   sc_memory_search(query="<topic keywords>", category="paper")
   ```
   - Collect all previously extracted papers on the topic
   - Note which sub-areas are already covered vs gaps in coverage

3. **Discover New Papers**: Search for papers not yet in the knowledge base
   ```
   WebSearch(query="<topic> research paper <year range>")
   WebSearch(query="<topic> survey <year>")
   WebSearch(query="<specific methodology> <topic> arxiv")
   ```
   - Prioritize: surveys/reviews first, then seminal papers, then recent work
   - Target 10-30 papers depending on scope breadth
   - Filter by venue quality and citation count when possible

4. **Read Papers in Parallel**: Extract structured info from new papers
   - Fire up to 5 research-reviewer agents simultaneously
   - Each extracts: [PAPER], [METHOD], [FINDING], [LIMITATION], [CONTRIBUTION]
   - Store each via `research-reviewer` workflow
   ```
   # Parallel extraction
   Agent 1: research-reviewer(sonnet) -> paper A
   Agent 2: research-reviewer(sonnet) -> paper B
   Agent 3: research-reviewer(sonnet) -> paper C
   Agent 4: research-reviewer(sonnet) -> paper D
   Agent 5: research-reviewer(sonnet) -> paper E
   ```

5. **Cross-Paper Synthesis**: Analyze across all papers (opus tier)
   - **Methodology comparison**: Which approaches are used? How do they differ?
   - **Findings synthesis**: Where do results agree? Where do they conflict?
   - **Trend analysis**: How has the field evolved over time?
   - **Strength assessment**: Which methods have strongest evidence?
   ```
   literature-reviewer(opus) analyzes all extracted papers together
   ```

6. **Gap Analysis**: Identify what is NOT covered
   - Missing methodologies: What approaches have NOT been tried?
   - Missing datasets: What data domains are underrepresented?
   - Missing evaluations: What metrics are not measured?
   - Conflicting results: Where do papers disagree and why?
   - Open questions: What do authors consistently list as future work?

7. **Build Citation Map**: Document relationships between papers in memory
   - Track relationships: cites, builds_on, extends, contradicts, replicates, same_topic
   - Store as structured entries via sc_memory_store with category "paper"

8. **Generate Output**: Produce structured literature review
   - Executive summary (1 paragraph)
   - Methodology comparison table
   - Findings synthesis with evidence quality ratings
   - Gap analysis with research opportunities
   - Citation graph summary
   - Optional: Publication-ready related work section
</Steps>

<Tool_Usage>
- `sc_memory_search` -- Find existing papers on the topic in memory
- `sc_memory_store` -- Store the literature review itself as a knowledge entry
- `WebSearch` -- Discover papers not yet in the knowledge base
- `WebFetch` -- Access paper abstracts and open-access content
- `Read` -- Load local PDFs and previously saved paper extractions
- `Grep` -- Search across stored paper extractions for specific claims or methods
- `Glob` -- Find paper extraction files in the data directory
</Tool_Usage>

<Examples>
<Good>
User: "literature review on attention mechanisms in NLP since 2020"
Action:
1. Scope: attention mechanisms, NLP domain, 2020-present, all methodology types
2. Search memory: found 4 papers already reviewed on attention
3. WebSearch: discovered 12 additional relevant papers
4. Parallel read: 5 agents extract from new papers simultaneously (3 batches)
5. Synthesis (opus): Compare self-attention, cross-attention, sparse attention, linear attention approaches across all 16 papers
6. Gaps: No papers on attention in low-resource languages, conflicting efficiency claims between sparse and linear approaches
7. Citation graph: 47 relations mapped across 16 papers
8. Output: 3-page structured review with methodology table, findings matrix, gap analysis
Why good: Clear scope, leverages existing knowledge, parallel execution, deep synthesis, explicit gaps.
</Good>

<Good>
User: "what's known about federated learning for healthcare?"
Action:
1. Scope clarification: "federated learning", healthcare domain, no time restriction, all approaches
2. Search existing memory + web for papers
3. Systematic extraction and comparison
4. Output includes privacy-specific considerations unique to healthcare domain
Why good: Recognizes domain-specific aspects, comprehensive coverage.
</Good>

<Bad>
User: "tell me about AI"
Action: Starting literature review.
Why bad: Scope is impossibly broad. Should ask user to narrow: "Which aspect of AI? NLP, computer vision, reinforcement learning, generative models? And what time period?"
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- If scope is too broad (would require 50+ papers), ask user to narrow the topic or time range
- If fewer than 3 papers are found on the topic, report that the area may be too niche and suggest broadening scope
- If paper access is restricted (paywalls), note which papers could not be fully analyzed and how this limits the review
- If conflicting findings cannot be resolved, document the conflict explicitly with evidence from both sides
- If the review exceeds reasonable length (>5000 words), offer to split into sub-topic sections
- After 3 failed attempts to access a specific paper source, skip it and note in limitations
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Scope clearly defined with topic, time range, and boundaries
- [ ] Existing knowledge in memory leveraged (no redundant re-reading)
- [ ] Sufficient papers covered (minimum 5 for meaningful synthesis)
- [ ] Methodology comparison table generated
- [ ] Findings synthesized with agreement/conflict analysis
- [ ] Gap analysis identifies what is NOT covered
- [ ] Citation graph built in knowledge store
- [ ] Research opportunities derived from gaps
- [ ] Output formatted as structured literature review
- [ ] Review itself stored in memory for future reference
</Final_Checklist>

<Advanced>
## Citation Graph Visualization

Citation relationships stored in memory can be queried for:
- **Clusters**: Groups of papers that cite each other heavily (research communities)
- **Bridges**: Papers that connect different research communities
- **Seminal papers**: Nodes with high in-degree (many papers cite them)
- **Recent frontiers**: Recent papers with low in-degree (newest work)

Query examples:
```
sc_memory_search(query="papers cited <topic>")
sc_memory_search(query="contradicts <claim>")
```

## BibTeX Export

Generate BibTeX entries from reviewed papers:
```bibtex
@article{smith2024attention,
  title={Efficient Attention Mechanisms for Long Documents},
  author={Smith, J. and Jones, M.},
  journal={NeurIPS},
  year={2024}
}
```
Export to `~/superclaw/data/reviews/<review-id>.bib`

## Related Work Section Generation

For paper writing, generate a publication-ready related work section:
- Organized by methodology category, not chronologically
- Each paragraph covers one approach family with key papers
- Transitions explain how approaches relate to each other
- Final paragraph positions the user's work relative to existing literature

## Gap-to-Experiment Pipeline

When gaps are identified, automatically suggest experiments:
1. Gap: "No evaluation of method X on dataset Y"
2. Suggested experiment: parameters from method X paper + dataset Y
3. Link to research-reviewer agent (experiment-track mode) for tracking

## Review Update Strategy

When new papers are published:
1. Search for papers published after the last review date
2. Extract and compare against existing review findings
3. Update synthesis with new evidence
4. Flag if any gaps have been filled or new gaps emerged

## Troubleshooting

**Too many papers found?**
- Narrow by venue quality (top-tier conferences/journals)
- Narrow by citation count threshold
- Focus on surveys first, then follow their references selectively

**Conflicting synthesis?**
- Check if papers use different evaluation metrics
- Check if papers use different datasets
- Check if methodology descriptions use different terminology for similar approaches

**Citation graph disconnected?**
- Some papers may be from different research communities
- Add `same_topic` relations even without direct citations
- Check if terminology differences hide connections
</Advanced>
