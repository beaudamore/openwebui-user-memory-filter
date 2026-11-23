# Configuration

Everything is set in the filter's valves (Admin Panel > Functions > User Memory > valves). There are no environment variables of its own.

## Connection valves for the bundled database stack

Filter valves that match `docker/user-memory-pgvector.yml` (set all four; the filter's own defaults for database and user are the older
`langgraph_memory` / `langgraph` names):
- `postgres_url`: `http://user-memory-pgvector` (`scheme://host` or `scheme://host:port`, default port 5432)
- `postgres_database`: `user_memory`
- `postgres_user`: `user_memory`
- `postgres_password`: the `POSTGRES_PASSWORD` you set in the compose file

The connection valves are read when the filter first opens the store. After changing one, restart Open WebUI.

## Valves

The filter has these valves (table current as of v8.4). Everything else was removed as dead or harmful configuration;
see [how-it-works.md](how-it-works.md) for what is fixed behaviour.

| Valve | Default | Description |
|-------|---------|-------------|
| `priority` | `10` | Filter order in Open WebUI (lower runs first) |
| `postgres_url` / `postgres_database` / `postgres_user` / `postgres_password` | (required) / `langgraph_memory` / `langgraph` / ... | Where the fact store lives. `postgres_url` is `scheme://host` or `scheme://host:port` (default port 5432), e.g. `http://user-memory-pgvector` or `http://10.5.10.100:5432`. The filter does not care how the database is deployed. |
| `extraction_model_id` | `memory-manager` | Workspace model that returns fact changes (prompt: `prompt/MERGE_PROMPT_memory-manager.md`) |
| `extraction_task_name` | `memory_extraction` | Sent as `metadata.task` on the extraction call (v7.4). With a connection header `X-OpenWebUI-Task: {{TASK}}`, a prompt-cache shim such as llama.cpp-ssd-cache-shim treats the call as a side task instead of the chat itself. Without it the call inherits the chat's id, runs in the chat's slot and throws away the chat's cached prompt, so every next turn re-prefills the whole conversation (measured 2026-11-04: 25k tokens, 135 s before the first token). Empty = no marker |
| `query_window_messages` | `6` | How many of the most recent user/assistant messages are embedded as the search text. `1` = the latest user message only |
| `relevance_threshold` | `0.45` | Minimum cosine similarity for a fact to be a candidate; `0` = no cutoff. Scale depends on the embedding model: with bge-m3 on short facts, unrelated facts measure 0.40-0.50 and on-topic ones 0.50-0.65 (2026-10-24), so cosine alone separates weakly and the reranker does the real ordering |
| `max_memories` | `20` | Top N candidates injected (after reranking when Open WebUI has a reranker, by similarity otherwise), not counting `always_inject_types`; also how many nearest facts the extraction model sees. `0` = no cap |
| `always_inject_types` | `["identity"]` | Fact types that are always injected, regardless of similarity |
| `confidence_floor` | `0` | A fact the extraction model rates below this confidence is not stored. The reference prompt uses 1.0 for an explicit statement, 0.8 for a clear implication, 0.6 for an inference, so `0.7` drops inferences. `0` = store everything. Facts already stored are not affected, which also means a stored fact is not updated by a new version that falls below the floor |
| `fact_types` | the eight types with their headings | The fact types, one entry each, written `type` or `type: Heading` (default `identity: About You`, `status: Current Status`, `ownership: You Own`, `relationship: Relationships`, `preference: Preferences`, `skill: Skills/Interests`, `goal: Goals`, `event: Events/Dates`). This is the only list of types in the filter: a fact of any other type is not stored (checked in code), and recalled facts are grouped under the heading, in this order. A heading cannot contain a comma, because the valve form splits entries on commas. Empty list = any type is stored. The filter sends these names to the extraction model with every call (`ALLOWED TYPES`), so the prompt does not carry its own list; it only explains what the usual types mean. Facts already stored under a type that is no longer listed are still recalled and can be removed, but no longer updated. A request to forget a fact is never blocked by this list |
| `dedupe_threshold` | `0.9` | Similarity above which a new fact of the same type with a different subject wording updates the existing row instead of adding one (`job` vs `occupation` measured 0.951 with bge-m3). `1` = off |
| `show_status` | `true` | Status line in the chat while memories load |
| `pii_engine` | `"regex"` | `none` stores facts exactly as extracted (no scrub, no check); `regex` = built-in patterns; `pii_tracer` = Perplexity's PII-Tracer model on a local server. `none` added in v7.0 |
| `pii_scrub_input` | `true` | Scrub PII from messages before sending to extraction model (ignored with `none`) |
| `pii_patterns_enabled` | all 10 | Which PII types the regex patterns detect, in the message scrub and in the check of extracted facts (see [pii-protection.md](pii-protection.md)). Also used when `pii_tracer` falls back to regex. Remove a name to let that type through; an empty list switches every pattern off. The subject blocklist (`ssn`, `passport`, `password`, ...) is separate and always applies while `pii_engine` is not `none` |
| `pii_tracer_url` | (empty) | PII-Tracer server URL, e.g. `http://pii-tracer:8193`; required with `pii_engine = pii_tracer`, unused otherwise. An empty URL counts as "server down" and `pii_tracer_fallback` applies |
| `pii_tracer_timeout` | `15` | Seconds per server call |
| `pii_tracer_labels` | 6 of 9 | Model labels treated as PII on the memory path. Left out by default: `private_person` and `private_date`, so names and birthdays stay storable as identity facts, and `other_pii`, the model's catch-all, which redacts ordinary personal facts (it flagged "I am actually 187 lbs", so the weight was never extracted). On by default: `private_email`, `private_phone`, `private_address`, `private_url`, `account_number`, `secret` |
| `pii_tracer_fallback` | `"regex"` | Server down or timing out: `regex` uses the patterns for that update, `allow` treats the text as clean |
| `debug_mode` | `false` | Debug log lines |

Per-user valves (each user sets their own):

| Valve | Default | Purpose |
|-------|---------|---------|
| `enabled` | `true` | Off: no new memories are recalled and nothing is extracted for this user. Stored facts are kept, and recalls already saved in existing chats still replay |
| `show_status` | `true` | Off: no status line for this user. The global `show_status` must also be on for a status line to show |

Reply length of the helper model is set on its workspace preset (`max_tokens`), not by the filter.

## Embedding prefixes (admin)

**What a prefix is.** Some embedding models are trained to get a short instruction in front of every text, a
different one for a search than for stored content (for example `query: ` and `passage: ` for the e5 family, or
`search_query: ` and `search_document: ` for nomic-embed-text). Many models need none (bge-m3 is one).

**Where it is set: one place.** Admin Panel > Settings > Documents has a query prefix and a content prefix. The
filter reads those same two settings on every embedding call, the way Open WebUI's own document search does. There
is nothing to set in the filter, and no restart is needed. Use the prefixes the embedding model's documentation
gives, and leave both empty for a model that has none.

**How it can degrade memory.** Changing a prefix does not re-embed the facts already stored: the filter re-embeds
only when the embedding model or its dimension changes. After a prefix change, new searches are compared against
vectors made the old way, so similarity scores drop, fewer facts pass `relevance_threshold`, and near-duplicates
stop merging (`dedupe_threshold`). Nothing errors; recall just gets worse. The same happens with a wrong prefix or
the two swapped.

**After changing a prefix, rebuild:** run `UPDATE user_facts_meta SET embedding_model = '';` in the memory database
and restart Open WebUI. The filter then re-embeds every fact of every user on its first use; that first chat
message waits for it.
