---
name: memory-mgr
description: Manage persistent cross-session memory with knowledge graph, search, and cross-session persistence
allowed-tools: Read, Write, Bash, Grep, Glob
---

<Purpose>
Store, search, and curate knowledge that persists across Claude Code sessions. Unlike temporary
notepad entries (7-day auto-prune) or project memory (single project scope), SuperClaw memory is permanent,
searchable via FTS5 full-text search, and organized into a knowledge graph with typed entities
and relations. This skill provides persistent storage across sessions so critical discoveries
are always available.
</Purpose>

<Use_When>
- User says "remember this", "save this for later", "store this knowledge"
- User says "what did we decide about X?", "recall", "search memory"
- User says "forget this", "delete memory", "clean up old entries"
- Starting a new session and need past context about a project or decision
- Building a knowledge graph of project architecture, people, or technology relationships
- User says "sync memory", "export memory"
- User asks "what do you know about X?" or "have we seen this before?"
</Use_When>

<Do_Not_Use_When>
- Temporary session-only information -- use sc_memory_store with appropriate category instead
- Information already in CLAUDE.md or project documentation -- no need to duplicate
- File content that can be re-read from disk -- don't store source code in memory
- Credentials, tokens, or secrets -- NEVER store sensitive data in memory
</Do_Not_Use_When>

<Why_This_Exists>
Claude Code sessions are ephemeral. When a session ends, all context is lost unless explicitly
persisted. Temporary notepad entries help but auto-prune after 7 days and lack structured search.
Project memory is per-project and unstructured. SuperClaw memory provides: (1) permanent storage
with SQLite, (2) full-text search via FTS5, (3) structured knowledge graph with entities and
relations, (4) confidence scoring and access tracking, (5) conversation logging for cross-session
continuity. This makes Claude Code's "long-term memory" reliable and queryable.
</Why_This_Exists>

<Execution_Policy>
- Store operations: execute immediately, confirm with stored ID
- Search operations: execute immediately, return ranked results
- Graph operations: validate entities exist before adding relations
- Sync operations: read from source, write to target, confirm both
- Max results per search: 10 (default), configurable up to 50
- Never delete without user confirmation
- Log conversation entries automatically when the user asks to "remember" context
</Execution_Policy>

<Steps>
1. **Phase 1 - Parse Intent**: Determine the memory operation requested
   - Store: user wants to save new knowledge
   - Search: user wants to find existing knowledge by query
   - Recall: user wants to retrieve by ID or browse by category
   - Graph: user wants to add/query entities and relationships
   - Sync: user wants to export memory entries
   - Stats: user wants to see memory usage and health

2. **Phase 2 - Execute Memory Operation**: Call the appropriate sc_memory tool
   - **Store**: `sc_memory_store` with params:
     - `category`: string -- "architecture", "preference", "error-fix", "decision", "debug", "pattern", "config", "person", "project"
     - `subject`: string -- brief title (e.g., "Auth uses JWT with RS256")
     - `content`: string -- detailed content to remember
     - `confidence`: number 0-1 -- how certain this knowledge is (default 0.5)
   - **Search**: `sc_memory_search` with params:
     - `query`: string -- FTS5 search query (supports AND, OR, NOT, prefix*, "exact phrase")
     - `limit`: number -- max results (default 10)
     - `category`: string -- optional category filter
   - **Recall**: `sc_memory_recall` with params:
     - `id`: number -- specific memory entry ID
     - `category`: string -- filter by category
     - `limit`: number -- max results (default 5)
   - **Graph Query**: `sc_memory_graph_query` with params:
     - `entity`: string -- entity name to look up
     - `type`: string -- entity type filter
     - `relation`: string -- relation type filter

3. **Phase 3 - Graph Management** (when building structured knowledge):
   - Add entity: `sc_memory_add_entity` with params:
     - `name`: string -- unique entity name (e.g., "SuperClaw", "React", "DaehanLim")
     - `type`: string -- entity type ("project", "person", "technology", "file", "service", "concept")
     - `properties`: string -- optional JSON of extra attributes
   - Add relation: `sc_memory_add_relation` with params:
     - `from`: string -- source entity name (must exist)
     - `to`: string -- target entity name (must exist)
     - `relationType`: string -- "uses", "depends-on", "created-by", "contains", "extends", "replaces", "related-to"
     - `properties`: string -- optional JSON of extra attributes
   - IMPORTANT: Both entities must exist before adding a relation. Create them first.

4. **Phase 4 - Conversation Logging** (for cross-session continuity):
   - Tool: `sc_memory_log_conversation` with params:
     - `sessionId`: string -- current session identifier
     - `role`: string -- "user", "assistant", or "system"
     - `content`: string -- message content to log
     - `project`: string -- optional project context
     - `tags`: string -- optional comma-separated tags

5. **Phase 5 - Cross-session Persistence**:
   - All memory entries persist automatically in ~/superclaw/data/memory.db
   - Critical knowledge is available across all sessions
   - Use appropriate categories to organize entries for easy retrieval

6. **Phase 6 - Statistics and Health**:
   - Tool: `sc_memory_stats` (no params)
   - Returns: knowledge entry count, conversation log count, entity count, relation count, category breakdown
   - Use to monitor memory growth and identify cleanup opportunities

7. **Phase 7 - Report Results**: Present findings to user
   - For search: show ranked results with category, subject, confidence, access count
   - For store: confirm with entry ID and category
   - For graph: show entity details and relationship map
   - For stats: show formatted summary table
</Steps>

<Tool_Usage>
**Core Memory (3 tools):**
- `sc_memory_store` -- Save knowledge; params: `category` (string), `subject` (string), `content` (string), `confidence` (optional number 0-1)
- `sc_memory_search` -- Full-text search via FTS5; params: `query` (string, supports FTS5 syntax), `limit` (optional number), `category` (optional string)
- `sc_memory_recall` -- Retrieve by ID or category; params: `id` (optional number), `category` (optional string), `limit` (optional number)

**Knowledge Graph (3 tools):**
- `sc_memory_graph_query` -- Query entities and relations; params: `entity` (optional string), `type` (optional string), `relation` (optional string)
- `sc_memory_add_entity` -- Create graph entity; params: `name` (string, unique), `type` (string), `properties` (optional JSON string)
- `sc_memory_add_relation` -- Link two entities; params: `from` (string), `to` (string), `relationType` (string), `properties` (optional JSON string)

**Logging (1 tool):**
- `sc_memory_log_conversation` -- Log conversation entry; params: `sessionId` (string), `role` (string), `content` (string), `project` (optional string), `tags` (optional string)

**Statistics (1 tool):**
- `sc_memory_stats` -- Get memory database statistics; no params
</Tool_Usage>

<Examples>
<Good>
User: "Remember that we chose PostgreSQL over MySQL because of JSON column support"
Action: sc_memory_store(category="decision", subject="Database choice: PostgreSQL over MySQL", content="Chose PostgreSQL over MySQL for the main database. Key reasons: native JSONB column support, better concurrent write performance, PostGIS for future geo features. Decision made during architecture review.", confidence=0.9)
Why good: Correct category, descriptive subject, detailed content with reasoning, high confidence for a firm decision
</Good>

<Good>
User: "What do we know about authentication?"
Action: sc_memory_search(query="authentication", limit=10) then display ranked results
Why good: Uses full-text search with a broad query, lets the ranking surface the most relevant entries
</Good>

<Good>
User: "Map the relationship between SuperClaw and Peekaboo"
Action: 1) sc_memory_add_entity(name="SuperClaw", type="project"), 2) sc_memory_add_entity(name="Peekaboo", type="technology"), 3) sc_memory_add_relation(from="SuperClaw", to="Peekaboo", relationType="uses", properties='{"purpose":"mac UI automation"}')
Why good: Creates both entities before the relation, includes properties for context
</Good>

<Good>
User: "Search for error fixes related to TypeScript"
Action: sc_memory_search(query="TypeScript error fix", category="error-fix", limit=10)
Why good: Combines FTS query with category filter for precise results
</Good>

<Bad>
User: "Remember my API key is sk-abc123..."
Action: sc_memory_store with the API key in content
Why bad: NEVER store credentials, tokens, or secrets in memory. Inform user and suggest using .env files or a secret manager
</Bad>

<Bad>
User: "Remember the contents of src/index.ts"
Action: sc_memory_store with the entire file contents
Why bad: Don't store source code that can be re-read from disk. Store insights about the code instead
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- **Stop** if user asks to store credentials or secrets -- refuse and explain why
- **Stop** if memory database is corrupted (SQLite errors) -- inform user to check ~/superclaw/data/memory.db
- **Escalate** if search returns no results for a topic the user insists was stored -- may need to check FTS index integrity
- **Escalate** if entity relation creation fails repeatedly -- entities may have been deleted or renamed
- **Confirm with user** before deleting or purging memory entries
- **Warn** if memory database exceeds 100MB -- suggest archiving old entries
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Correct memory operation identified (store/search/recall/graph/sync/stats)
- [ ] Category is appropriate and consistent with existing categories
- [ ] Confidence level reflects actual certainty (not always 0.5)
- [ ] No sensitive data (credentials, tokens, PII) stored in memory
- [ ] Entities created before relations that reference them
- [ ] Search results presented with ID, category, subject, and confidence
- [ ] Appropriate category selected for cross-session persistence
- [ ] User informed of operation result with confirmation
</Final_Checklist>

<Advanced>
## Configuration

Memory database location: `~/superclaw/data/memory.db` (SQLite with WAL mode)

Override with environment variable:
```bash
export SC_MEMORY_DB="/custom/path/to/memory.db"
```

Database schema tables:
- `knowledge` -- Main knowledge store (category, subject, content, confidence, access_count)
- `knowledge_fts` -- FTS5 virtual table for full-text search
- `entities` -- Knowledge graph nodes (name, type, properties)
- `relations` -- Knowledge graph edges (from_entity, to_entity, relation_type)
- `conversations` -- Conversation log (session_id, role, content, project, tags)
- `skill_metrics` -- Skill usage tracking (invocation_count, success_count, avg_duration)

## FTS5 Search Query Syntax

SuperClaw memory search uses SQLite FTS5 full-text search:

| Query | Meaning |
|-------|---------|
| `authentication` | Match any entry containing "authentication" |
| `auth*` | Prefix match: "auth", "authentication", "authorize" |
| `"JWT tokens"` | Exact phrase match |
| `postgres AND jsonb` | Both terms must appear |
| `postgres OR mysql` | Either term matches |
| `postgres NOT mysql` | Postgres but not mysql |
| `NEAR(jwt authentication, 5)` | Terms within 5 words of each other |
| `category:decision` | Combined with category filter parameter |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "No results found" for known data | FTS index out of sync | Rebuild: `INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')` |
| Duplicate entities | Case-sensitive matching | Normalize entity names to lowercase before adding |
| Slow search on large DB | No FTS optimization | Run `INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')` |
| Database locked errors | Multiple concurrent writers | WAL mode should handle this; check for zombie processes |
| Memory DB missing | First run or wrong path | Check SC_MEMORY_DB env var or default ~/superclaw/data/memory.db |

## Common Patterns

**Decision Record:**
```
sc_memory_store(
  category="decision",
  subject="Chose X over Y for Z",
  content="Context: ... Options: ... Decision: ... Rationale: ...",
  confidence=0.9
)
```

**Error Fix Pattern:**
```
sc_memory_store(
  category="error-fix",
  subject="Fix: [error message summary]",
  content="Error: [full error]\nCause: [root cause]\nFix: [solution]\nPrevention: [how to avoid]",
  confidence=0.8
)
```

**Architecture Knowledge:**
```
sc_memory_add_entity(name="AuthService", type="service")
sc_memory_add_entity(name="PostgreSQL", type="technology")
sc_memory_add_relation(from="AuthService", to="PostgreSQL", relationType="uses")
sc_memory_store(category="architecture", subject="AuthService design", content="...", confidence=0.7)
```

**Cross-session Retrieval:**
```
1. sc_memory_search(query="critical decision") -- find important memories
2. Memories persist automatically across sessions in memory.db
3. Use categories to organize and filter results effectively
```
</Advanced>
