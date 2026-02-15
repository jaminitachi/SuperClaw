---
name: sc-memory
description: Quick memory search command
allowed-tools: Read, Bash, Grep
---

# /sc-memory - Quick Memory Search

Search SuperClaw's persistent memory and display the top results.

## Activation

Triggered by: `/sc-memory <query>`, "search memory for", "what do we know about", "recall"

## Arguments

- `<query>`: The search query string (required)
- `--category <cat>`: Filter by category (optional). Categories: decision, error, preference, architecture, system, skill_metrics, pipeline_output
- `--limit N`: Number of results to show (default: 5, max: 20)

## Steps

1. **Parse arguments**: Extract the search query from the command arguments. If no query is provided, show usage help:
   ```
   Usage: /sc-memory <search query>
   Examples:
     /sc-memory database migration
     /sc-memory --category decision auth
     /sc-memory --limit 10 react patterns
   ```

2. **Search memory**: Call `sc_memory_search` with the query:
   ```
   sc_memory_search({ query: "search terms", limit: 5 })
   ```
   If a category filter was specified, include it in the search parameters.

3. **Format results**: Display the top matches in a clean format:
   ```
   Memory Search: "database migration" (3 results)

   1. [decision] (confidence: 0.95, 2 days ago)
      Use PostgreSQL for the main database with Prisma ORM.
      Related: architecture, tech-stack

   2. [architecture] (confidence: 0.85, 5 days ago)
      Migration strategy: incremental with rollback support.
      Related: database, deployment

   3. [error] (confidence: 0.80, 1 week ago)
      Fixed: migration timeout by increasing lock_timeout to 30s.
      Related: database, production
   ```

4. **Show stats**: After results, show a brief memory summary:
   ```
   Memory: 142 entries | 48 KB | Last updated: 2 hours ago
   ```

## Error Handling

- If no results found, suggest broader search terms or list available categories
- If memory database is not initialized, suggest running `/sc-setup`
- If sc_memory_search returns an error, display the error and suggest checking memory.db
- Empty query shows usage help instead of searching for empty string

## Notes

- This is a read-only command. To store new memories, use the memory-mgr skill.
- Results are ranked by relevance to the search query.
- For graph queries (entity relationships), use the memory-mgr skill directly.
