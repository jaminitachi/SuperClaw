---
name: paper-review
description: Read, analyze, and store structured information from academic papers
allowed-tools: Read, Bash, Grep, Glob, WebFetch, WebSearch
---

<Purpose>
Read and analyze academic papers from any source (arxiv, PDF, DOI) and extract structured information into SuperClaw's knowledge graph. This skill transforms raw papers into queryable knowledge -- methodology, statistical evidence, limitations, key findings, and citation connections that persist across sessions and can be cross-referenced later.
</Purpose>

<Use_When>
- User says "read this paper", "summarize paper", "review paper", "analyze this research"
- User provides an arxiv URL, DOI link, or PDF file path
- User asks "what does this paper say about X?"
- User wants to extract methodology, findings, or limitations from a specific paper
- User mentions a paper title and wants structured analysis
- User wants to add a paper to their knowledge base
</Use_When>

<Do_Not_Use_When>
- Multi-paper comparison or synthesis across papers -- use `lit-review` instead
- Quick citation lookup or "who wrote X?" -- use research-assistant agent directly
- General topic research without a specific paper -- use `research` skill instead
- Reading non-academic documents (blog posts, docs) -- use standard Read tool
- Data analysis of results from papers -- use `research-analysis` instead
</Do_Not_Use_When>

<Why_This_Exists>
Researchers need more than summaries. They need structured extraction -- methodology details, statistical evidence quality, specific limitations, and how each paper connects to others they have read. Without systematic extraction, papers are read once and forgotten, connections between findings are missed, and the same paper gets re-read months later. This skill creates a persistent, queryable knowledge base from every paper reviewed.
</Why_This_Exists>

<Execution_Policy>
- Always check memory first for existing entries on the same paper (avoid duplicates)
- Extract ALL structured sections, not just abstract-level summaries
- Store entities and relations in the knowledge graph, not just flat text
- Link new papers to existing papers in the graph when topic overlap exists
- Preserve exact statistical claims with their confidence intervals and p-values
- Flag methodological concerns explicitly in the LIMITATION section
- Default model routing: paper-reader agent at sonnet tier for extraction, memory-curator at haiku for storage
</Execution_Policy>

<Steps>
1. **Identify Source**: Parse the paper reference provided by the user
   - Arxiv URL: Extract paper ID, fetch abstract via WebFetch
   - DOI link: Resolve to full paper via WebFetch
   - PDF file path: Read directly via Read tool
   - Paper title: Search via WebSearch to locate the paper

2. **Check Existing**: Search memory for this paper
   ```
   sc_memory_search(query="<paper title or ID>", category="paper")
   ```
   - If found: Show existing entry, ask if user wants to update or view
   - If not found: Proceed with extraction

3. **Extract Structure**: Delegate to paper-reader agent (sonnet) to extract:
   - [PAPER] Title, authors, year, venue, DOI/URL
   - [ABSTRACT] Core claim in 2-3 sentences
   - [METHOD] Methodology details -- dataset, approach, baselines, evaluation metrics
   - [FINDING] Key findings with statistical evidence (exact numbers, p-values, CIs)
   - [LIMITATION] Stated and unstated limitations, threats to validity
   - [CONTRIBUTION] Novel contributions claimed by authors
   - [CITATION_KEY] Papers this work builds on (for graph linking)

4. **Store in Knowledge Graph**: Use memory-curator agent to persist
   - Create paper entity: `sc_memory_add_entity(name="<title>", type="paper", properties={...})`
   - Create method relation: `sc_memory_add_relation(from="<paper>", to="<method>", type="uses_method")`
   - Create finding relations: `sc_memory_add_relation(from="<paper>", to="<finding>", type="reports_finding")`
   - Store full extraction: `sc_memory_store(content="<full extraction>", category="paper", confidence=0.9)`

5. **Connect to Existing Papers**: Query graph for related work
   ```
   sc_memory_graph_query(query="papers about <topic>")
   ```
   - Add `cites`, `builds_on`, `contradicts`, `extends` relations where applicable
   - Add `same_topic` relations for topically related papers

6. **Report to User**: Format structured summary
   - One-paragraph overview
   - Key findings table with evidence quality ratings
   - Methodology summary
   - Limitations and caveats
   - Connections to previously reviewed papers
</Steps>

<Tool_Usage>
- `sc_memory_search` -- Check for existing paper entries before extraction
- `sc_memory_store` -- Store full structured extraction with category="paper"
- `sc_memory_add_entity` -- Create paper, method, and finding entities in the graph
- `sc_memory_add_relation` -- Link papers to methods, findings, and other papers
- `sc_memory_graph_query` -- Find related papers and build citation connections
- `WebFetch` -- Fetch arxiv abstracts, DOI-resolved pages, open-access PDFs
- `WebSearch` -- Locate papers by title when no direct URL is provided
- `Read` -- Read local PDF files or cached paper documents
- `Grep` -- Search within large paper texts for specific sections or claims
</Tool_Usage>

<Examples>
<Good>
User: "read this paper https://arxiv.org/abs/2301.12345"
Action:
1. Fetch arxiv abstract page via WebFetch
2. Search memory for existing entry -- not found
3. Extract structured sections: [PAPER] title/authors/year, [METHOD] transformer architecture with modified attention, [FINDING] 3.2% improvement on GLUE benchmark (p<0.01), [LIMITATION] only English data, small model sizes
4. Store paper entity with all properties in knowledge graph
5. Query graph -- find 2 related papers on attention mechanisms already in memory
6. Add `extends` relation to one, `same_topic` to the other
7. Present formatted summary with evidence quality ratings and connections
Why good: Full structured extraction, stored in graph, linked to existing knowledge, evidence quality assessed.
</Good>

<Good>
User: "review ~/papers/smith2024.pdf"
Action:
1. Read PDF file directly
2. Check memory -- no existing entry
3. Extract all structured sections from the full text
4. Store with high confidence since full text was available
5. Present summary highlighting methodology strengths and limitations
Why good: Handles local PDF files, extracts from full text for higher quality.
</Good>

<Bad>
User: "what papers exist about transformers?"
Action: Running paper-review skill.
Why bad: This is a literature search across multiple papers, not a single paper review. Use `lit-review` skill instead.
</Bad>

<Bad>
User: "read this paper https://arxiv.org/abs/2301.12345"
Action: Returning "This paper is about machine learning and proposes a new method."
Why bad: Shallow summary without structured extraction. No methodology details, no statistical evidence, no limitations, nothing stored in memory. The entire point of paper-review is structured, persistent extraction.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- If the paper is behind a paywall and cannot be accessed, report the limitation and offer to work from the abstract only (with reduced confidence score)
- If the paper is in a non-English language, note this and attempt extraction but flag reduced accuracy
- If the paper is extremely long (>50 pages, e.g., a survey), recommend using `lit-review` skill instead or ask user which sections to focus on
- If memory storage fails, report the extraction results directly to the user and retry storage
- If the paper source cannot be resolved (broken URL, missing PDF), ask the user for an alternative source
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Paper source identified and content accessed
- [ ] Memory checked for existing entry (no duplicates)
- [ ] All structured sections extracted: [PAPER], [METHOD], [FINDING], [LIMITATION], [CONTRIBUTION]
- [ ] Statistical claims include exact numbers and confidence measures
- [ ] Paper entity created in knowledge graph
- [ ] Method and finding relations added
- [ ] Connections to existing papers established where applicable
- [ ] Formatted summary presented to user
- [ ] Confidence score reflects extraction quality (full text > abstract only)
</Final_Checklist>

<Advanced>
## Supported Paper Sources

| Source | Method | Quality |
|--------|--------|---------|
| Arxiv URL | WebFetch abstract + PDF link | High (full text usually available) |
| DOI link | WebFetch resolved URL | Varies (may hit paywall) |
| Local PDF | Read tool | Highest (full text guaranteed) |
| Paper title | WebSearch to locate | Medium (depends on search results) |
| Semantic Scholar URL | WebFetch API | High (structured metadata) |

## Extraction Accuracy Tips

- Full text extraction is always preferred over abstract-only
- For papers with complex tables, explicitly extract table data into structured format
- Statistical claims should preserve exact notation: "F1=0.847, p<0.001, 95% CI [0.82, 0.87]"
- When authors state limitations, quote them directly rather than paraphrasing
- Cross-reference claimed contributions against actual evidence in results

## Figure and Table Extraction

When processing PDFs with the Read tool:
- Tables: Extract as markdown tables with headers preserved
- Figures: Note figure descriptions and captions (visual content requires vision agent)
- For figure analysis, delegate to vision agent with screenshot of the figure

## Dealing with Paywalled Papers

1. Try the DOI through Sci-Hub alternatives or institutional access
2. Check if a preprint exists on arxiv or author's website
3. Fall back to abstract-only extraction with `confidence: 0.5`
4. Note in the extraction that full text was not available

## Knowledge Graph Schema

```
Entity: Paper
  Properties: title, authors, year, venue, doi, url, abstract
  Relations:
    - uses_method -> Method
    - reports_finding -> Finding
    - has_limitation -> Limitation
    - cites -> Paper
    - builds_on -> Paper
    - contradicts -> Paper
    - extends -> Paper
    - same_topic -> Paper

Entity: Method
  Properties: name, description, category

Entity: Finding
  Properties: claim, evidence, p_value, confidence_interval, effect_size
```

## Troubleshooting

**Paper not found via WebSearch?**
- Try searching with exact title in quotes
- Try adding author names to the search
- Try searching on Google Scholar directly

**Extraction quality low?**
- Check if full text was accessed or just abstract
- For dense papers, run extraction twice with different focus areas
- Consider splitting long papers into sections for targeted extraction

**Memory storage failing?**
- Check `sc_memory_stats` for capacity
- Verify entity names do not conflict with existing entries
- Try storing with a shorter content field and linking to a file for full text
</Advanced>
