# User Memory Filter for Open WebUI

![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python&logoColor=white)
![OpenWebUI](https://img.shields.io/badge/Open_WebUI-Filter-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Backend-blue?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow)

A persistent per-user memory for [Open WebUI](https://github.com/open-webui/open-webui): facts about the user are
extracted by a small local model after each reply, stored in one PostgreSQL table with a pgvector embedding per
fact, and the nearest ones are injected into the next request by vector search (reranked when Open WebUI has a
reranker configured). Embeddings come from Open WebUI's own configured embedding model. LangGraph was removed on
2026-10-18, the relevance model on 2026-10-24 (v7.0); memories carry dates since 2026-10-27 (v7.2, v7.3 on 2026-10-28; v7.4 on 2026-11-04 adds `extraction_task_name` so the extraction call no longer evicts the chat from the prompt cache; v7.5 on 2026-11-05 shows every stored value of a fact in the injected block); the installed
function id is `user_memory`.

## Author

**Beau D'Amore**  
[www.damore.ai](https://www.damore.ai)

## ✨ Features

- **Persistent Memory**: remembers identity, status, preferences, ownership, relationships, goals, skills and events
- **Vector retrieval, no relevance model**: the recent chat is embedded and the nearest facts are injected, ordered by Open WebUI's reranker when one is configured; the inlet makes no model call
- **De-duplication**: a new fact that is near-identical to an existing one of the same type (e.g. `job` vs `occupation`) updates that row instead of adding a second
- **Embeddings follow Open WebUI**: the filter uses whatever embedding model Open WebUI has configured. After an admin changes that model, restart Open WebUI: the filter checks the model once per start and then re-embeds every fact (reindex on change)
- **Reply never waits for extraction**: extraction runs after the reply as a background task
- **PII Protection, optional**: `pii_engine` = `none` (store exactly what was extracted), `regex` (built-in patterns) or `pii_tracer` (local PII-Tracer server)
- **One table**: `user_facts`, one row per fact keyed on user + type + subject plus its embedding, no framework, no checkpoint history
- **Users manage their own memories**: a section in Settings > Personalization ([docs/memory-settings-panel.md](docs/memory-settings-panel.md)) and an action button under replies ([docs/memory-management-action.md](docs/memory-management-action.md)) list a user's stored facts and delete one or all of them

## 🆚 Compared with Open WebUI's built-in Memories

Open WebUI has its own Memories feature. This comparison is against its code in v0.13.4
(`backend/open_webui/utils/memory.py`, `routers/memories.py`, `tools/builtin.py`). It compares what each one does;
the two have not been benchmarked against each other on recall quality.

The built-in feature is a store of free-text notes that the chat model manages itself. This filter is a store of
structured facts that a dedicated model keeps up to date after every turn. The differences follow from that.

| | This filter | Built-in Memories (v0.13.4) |
|---|---|---|
| **When memories are written** | After every reply, automatically, in the background | When the chat model decides to call `add_memory` during a reply. Automatic "background review" exists but is off by default (`ENABLE_MEMORY_BACKGROUND_REVIEW`), has no admin switch, and runs every 10 user turns |
| **Which model extracts** | A small dedicated model (`extraction_model_id`), so the chat model's slot and prompt cache are untouched | The chat model itself |
| **Extraction prompt** | Yours: the system prompt of the `memory-manager` model, editable | Fixed in the source code |
| **What a memory is** | A fact with type, subject, value, sentiment, confidence and first/last stated dates | One line of text with a type (`user` or `context`) and an optional path |
| **Dates** | Every fact shows when it was first and last stated, and the block carries today's date | None in the recalled block |
| **Updating a fact** | Same type + subject overwrites the row; "I moved to Y" replaces the old location | The model has to find the old note and call a replace or delete tool |
| **Duplicates** | A new fact that is ≥ `dedupe_threshold` similar to an existing one of the same type updates that row (`job` vs `occupation`) | Exact text match only, and only on batch adds |
| **Short-lived states** | The prompt keeps them out and removes a stored one on sight | The review prompt asks the model not to save them; no rule removes one that got in |
| **Retrieval** | Vector search with a similarity cutoff, then Open WebUI's reranker, top `max_memories` (20) | Vector search, top 8, no reranker; cutoff only if the RAG relevance threshold is above 0 |
| **Always sent** | Facts of `always_inject_types` (identity) | Every `user`-type memory, whatever the topic |
| **PII** | Scrubbed before extraction and checked after it (regex or a local PII-Tracer server) | No filter; the review prompt asks the model not to save secrets |
| **Tuning** | Threshold, window, cap, dedupe and always-inject types are valves | Two character limits and the review interval, set by environment variable |

Why this matters in practice:

- **Memories exist without the chat model's cooperation.** With the built-in defaults, nothing is remembered unless
  the chat model chooses to call a tool mid-reply, so it depends on the model. Here extraction is a separate step
  that always runs.
- **The chat model's speed is not spent on memory.** Extraction runs on its own model after the reply. The built-in
  review runs on the chat model, and its tool calls happen inside the reply.
- **Facts stay current instead of piling up.** A keyed row per fact, similarity de-duplication and removal of
  passing states mean a correction replaces the old fact. Free-text notes accumulate until the model tidies them.
- **The model can judge a fact's age and certainty**, because each one carries its dates, sentiment and confidence.
- **Retrieval is ordered by a reranker.** Cosine similarity alone separates on-topic from off-topic facts weakly
  (measured here with bge-m3: unrelated facts 0.40-0.50, on-topic 0.50-0.65), and the built-in feature ranks by it
  alone.

What the built-in feature has that this filter does not:

- **Nothing to install or maintain.** It ships with Open WebUI and follows its updates; this filter needs a
  PostgreSQL + pgvector database, an extraction model and upkeep across Open WebUI versions.
- **Editing a memory in the UI.** Settings > Personalization lets a user add and edit notes. The
  [settings panel](docs/memory-settings-panel.md) and the [action](docs/memory-management-action.md) here list and
  delete facts but do not edit.
- **Tools the model can call on demand** to search, list and manage memories. Here the model only receives what
  the inlet recalled.
- **Organising notes by path**, and pulling in notes whose path name appears in the conversation.

Both inject the same way in v0.13.4 when the model uses native tool calling: a hidden tool result after the latest
user message, with each memory sent once per chat. Both can be enabled at once, in which case both inject.

## 📁 Project Structure

```
openwebui-user-memory-filter/           # renamed from openwebui-langgraph-memory-filter on 2026-10-27
├── README.md                    # This file
├── filter/
│   └── user_memory_filter.py    # The filter (installed copy = DB function user_memory)
├── action/
│   └── user_memory_management.py  # Action button: a user sees and deletes their own stored facts
├── frontend/
│   ├── user_memory_panel.js     # Settings > Personalization section with a table of the user's facts
│   └── loader_snippet.js        # Block for the site's loader.js that loads the panel script
├── docker/
│   └── user-memory-pgvector.yml   # The database stack: PostgreSQL 16 + pgvector (user-memory-pgvector, db user_memory) and optional pgAdmin
├── docs/
│   ├── memory-management-action.md   # The action: install, what the user sees, limits
│   ├── memory-settings-panel.md      # The settings panel: install, what the user sees, limits
│   ├── EXTRACTION_MODEL_SETUP.md     # Extraction model configuration
│   └── ...                           # Older design docs, each headed by a dated "superseded" note
└── prompt/
    ├── MERGE_PROMPT_memory-manager.md  # System prompt of the memory-manager model (extraction)
    └── INSTRUCTIONS.md                 # Model setup walkthrough
```

## 🚀 Quick Start

### 1. Start PostgreSQL with pgvector

Edit `docker/user-memory-pgvector.yml` first: set `POSTGRES_PASSWORD` and the database's host path. pgAdmin is
optional: either set its login and host path too, or delete the `user-memory-pgadmin` service block.
Then:

```bash
cd docker
docker compose -f user-memory-pgvector.yml up -d
```

The server must have the `vector` extension available (image `pgvector/pgvector:pg16`); the filter runs
`CREATE EXTENSION IF NOT EXISTS vector` itself. The stack joins the external network `webui-network`, which the
Open WebUI container must be on too.

### 2. Install Dependencies

Nothing to install. The filter uses `psycopg` only, which Open WebUI ships with
(pinned in its own requirements). Default Open WebUI installs do not pip-install
frontmatter `requirements:` (`ENABLE_PIP_INSTALL_FRONTMATTER_REQUIREMENTS` is off),
so the filter deliberately needs no extra package. Filter 5.1 and earlier needed
`psycopg-pool`; 5.2 opens one plain connection per query instead.

### 3. Install the Filter

1. Go to Open WebUI **Admin Panel** → **Functions**
2. Click **"+ Add Function"**, id `user_memory`
3. Paste the contents of `filter/user_memory_filter.py`
4. Save, enable the filter, and attach it to the models that should remember (model → Filters)

### 4. Configure the helper model and the embedder

See [docs/EXTRACTION_MODEL_SETUP.md](docs/EXTRACTION_MODEL_SETUP.md) and [prompt/INSTRUCTIONS.md](prompt/INSTRUCTIONS.md).

Quick version:
1. Create a workspace model `memory-manager` with the system prompt from `prompt/MERGE_PROMPT_memory-manager.md`;
   the filter's `extraction_model_id` valve defaults to that id.
2. Embeddings and reranking are not configured in the filter. It uses what Open WebUI has under
   **Admin Panel > Settings > Documents**: the embedding model (required) and the reranking model (optional; when set,
   it orders the retrieved facts). **Admin note, reindex on change:** after changing the embedding model, restart Open WebUI. The filter
   checks the model once per start and then re-embeds every fact; until the restart, memory search fails or ranks
   wrongly.
3. Set the `postgres_url` valve (see below). Nothing else is required.

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [EXTRACTION_MODEL_SETUP.md](docs/EXTRACTION_MODEL_SETUP.md) | Extraction model configuration |
| [prompt/INSTRUCTIONS.md](prompt/INSTRUCTIONS.md) | Model setup, flow and troubleshooting |
| [memory-management-action.md](docs/memory-management-action.md) | The User Memory Management action: install, what the user sees, limits |
| [memory-settings-panel.md](docs/memory-settings-panel.md) | The User Memory section in Settings > Personalization: install, what the user sees, limits |
| [LANGGRAPH_SETUP.md](docs/LANGGRAPH_SETUP.md), [MEMORY_GRAPH_V4.md](docs/MEMORY_GRAPH_V4.md), [AI_DEVELOPMENT_GUIDE.md](docs/AI_DEVELOPMENT_GUIDE.md), [MEMORY_FILTER_V2_PLAN.md](docs/MEMORY_FILTER_V2_PLAN.md) | Historical (LangGraph era); each starts with a dated note on what no longer applies |

## 🔧 Requirements

- **Open WebUI**: >= 0.13.3
- **Python**: 3.10+
- **PostgreSQL**: 16+ (provided via Docker)
- **Dependencies**: `psycopg[binary]` (bundled with Open WebUI, no install step)

## 🐳 Docker Setup

### PostgreSQL Container

One compose file, `docker/user-memory-pgvector.yml`, with two services:

- `user-memory-pgvector`: the database (`pgvector/pgvector:pg16`), data on a bind mount, no published port. Open
  WebUI reaches it by container name over `webui-network`.
- `user-memory-pgadmin`: **optional.** pgAdmin, a web UI for looking at the database, on port 5050. The filter
  never uses it; delete the service block to run the database alone.

```bash
cd docker
docker compose -f user-memory-pgvector.yml up -d
```

**Filter valves that match this file** (set all four; the filter's own defaults for database and user are the older
`langgraph_memory` / `langgraph` names):
- `postgres_url`: `http://user-memory-pgvector` (`scheme://host` or `scheme://host:port`, default port 5432)
- `postgres_database`: `user_memory`
- `postgres_user`: `user_memory`
- `postgres_password`: the `POSTGRES_PASSWORD` you set in the compose file

## ⚙️ Configuration

The filter has these valves (table current as of v8.4). Everything else was removed as dead or harmful configuration;
see "How it works" below for what is fixed behaviour.

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
| `pii_patterns_enabled` | all 10 | Which PII types the regex patterns detect, in the message scrub and in the check of extracted facts (see PII Protection section). Also used when `pii_tracer` falls back to regex. Remove a name to let that type through; an empty list switches every pattern off. The subject blocklist (`ssn`, `passport`, `password`, ...) is separate and always applies while `pii_engine` is not `none` |
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

### Embedding prefixes (admin)

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

## ⚙️ How it works (current as of v8.4)

**Inlet** (before the chat model sees the request; no model call):
1. First use only: open the store, create the extension/tables, and check the stored embedding model and
   dimension against Open WebUI's current one; on any difference, rebuild the `embedding` column and re-embed every row.
2. Embed the last `query_window_messages` user/assistant messages as one search text (waits for a still-running
   extraction from the previous turn).
3. `SELECT` the user's `always_inject_types` facts, plus the nearest other facts by cosine distance
   (`embedding <=> query`) with similarity ≥ `relevance_threshold`. When Open WebUI has a reranker configured
   (`request.app.state.RERANKING_FUNCTION`), the candidates are rescored by it; if the reranker fails or returns no
   scores, the vector order is kept. The top `max_memories` are kept.
4. Leave out the facts already recalled earlier in this chat, render the rest grouped by type, and add them as a
   hidden tool result right after the latest user message (see next section).

**Outlet** (after the reply is streamed): save the hidden tool result with the reply, schedule a background task,
return immediately. The task embeds the
(scrubbed) latest user message and sends `memory-manager` the allowed fact types (the `fact_types` valve), today's date, the `always_inject_types` facts plus the
`max_memories` nearest existing facts (each with its `last_updated` date), the previous 3 user messages as context and
the latest user message, and asks only for what changes: new facts, updated facts (same type+subject), and
`"remove": true` entries. The prompt tells the model not to store passing states (sleep, mood, energy, "today" /
"last night"), to return a stored passing-state `status` fact as a removal whenever it sees one (v7.3; v7.2 waited
14 days), and never to overwrite an ongoing status with a one-day report; long-running situations are never expired. Nothing changes
on most turns and the reply is `{"facts": []}`. Each change is embedded (`subject: value`) and applied to its own row:
removal is a `DELETE`; a new `(type, subject)` whose embedding is ≥ `dedupe_threshold` similar to an existing fact of
the same type is applied to that row instead (logged as *merged*); otherwise `INSERT ... ON CONFLICT` writes value,
sentiment, confidence and embedding only when something differs. Empty or unparseable replies write nothing.
A per-user lock serialises the task with the next inlet: the inlet waits up to 30 s for a running extraction, then
recalls without that turn's new facts. The extraction model call is given 300 s; after that the turn's update is
skipped. The filter's own log lines never contain the extraction model's reply or the text a PII check matched (Open WebUI
itself logs request bodies when its log level is DEBUG). Only user messages are sent; system prompts carry persona
text that would be misread as facts.

**Storage**: table `user_facts` (`user_id, type, subject, value, sentiment, confidence, first_mentioned,
last_updated, embedding vector(N)`, primary key user + type + subject, HNSW cosine index when N ≤ 2000) and
`user_facts_meta` (one row: `embedding_model`, `embedding_dim`). N is whatever Open WebUI's embedding model returns.

Measured before 2026-10-18 (43 turns): the inlet blocked each reply for a median 36.5 s (extraction 27 s,
relevance 10 s). Since 2026-10-18 extraction is off the reply path; since 2026-10-24 the inlet makes no model call at
all (one embedding call, one SQL query, an optional reranker call).

## 📍 Where the memories are injected

The recalled memories reach the model as the result of a hidden tool call named `recall_user_memories`, placed right
after the latest user message, under a `[Relevant memories about the user]` header. It is not a tool the model can
call, and nothing shows in the chat bubble. The outlet saves the same entry with the reply, so Open WebUI replays it
unchanged on every later turn: the persona system prompt, tool specs and chat history stay byte-identical from turn
to turn and the server reuses its prompt cache up to the new message (llama.cpp reuses the longest identical token
prefix). The entry is added on a new turn only; a continued reply already has it in its history.

A fact is sent once per chat. Before rendering, the inlet collects every line of the earlier recalls still in the
chat's history and leaves out the facts whose line is already there. A fact is sent again when anything on its line
changes, or when the earlier recall is no longer in the history the model gets: Open WebUI's context compaction has
summarized it away, or it sits on another branch or on a reply being regenerated. A block that leaves facts out says
in its header that a changed fact replaces its earlier version and the other facts recalled earlier still apply. When no fact is left, no entry is added for that turn, so
that turn carries no fresh `today is` date. The status line shows how many relevant facts are new and how many were
recalled earlier.

The block header carries today's date and says that relative words inside a fact refer to the fact's last stated
date, not to today. Every fact line shows all of its stored values:
`- Subject: value (sentiment negative, confidence 0.8, first stated YYYY-MM-DD, last stated YYYY-MM-DD)`, with dates
in the server's local zone. Preferences are rendered the same way as every other type. Confidence is displayed only;
it does not affect which facts are selected.

There is no placement valve. The alternatives were measured and rejected: appending the block to the latest user
message for that request only makes the server re-read everything after that message on the next turn; a separate
system message after the user turn is merged by Open WebUI into the first system message before sending; and
prepending to the system prompt re-prefills the whole conversation whenever the recalled set changes (65 s at 12.5k
tokens).

Server side, `--checkpoint-min-step 512` (2048 until 2026-11-02) on the llama.cpp chat server bounds the redo when the prompt changes mid-way
(details in `~/Source/local-llm-config/README.md`, "Prompt cache, checkpoints and the memory filter").
The installed copy is the DB function `user_memory`, pasted from `filter/user_memory_filter.py`.

## 📜 History, measurements and why (updated 2026-11-05)

The filter went through four shapes. Each step was driven by a measurement on Beau's M1 Ultra (Qwen3.8-27B on llama.cpp
behind the SSD prompt-cache shim, bge-m3 and bge-reranker-v2-m3 on llama.cpp, Postgres + pgvector):

| Date / version | Shape | Why it changed | Measured |
|---|---|---|---|
| to 2026-10-18 (LangGraph, v4) | one JSON blob of facts per user in LangGraph checkpoints; extraction and a relevance LLM ran **inside the inlet** | the reply waited for two model calls every turn; one bad fact copied into every later checkpoint | inlet blocked each reply by a median **36.5 s** (extraction 27 s + relevance 10 s, 43 turns) |
| 2026-10-18/19 (v6.0) | LangGraph removed; `user_facts` table, **one row per fact** (PK user + type + subject); extraction moved to a background task after the reply | removal and updates per row instead of rewriting a blob; the inlet no longer calls the extraction model | inlet = relevance model only |
| 2026-10-24 (v7.0/7.1) | relevance LLM replaced by **pgvector cosine search + Open WebUI's reranker**; embeddings from Open WebUI's own embedding function with auto re-embed on model change | the relevance model was the last model call on the reply path and separated weakly | inlet = 1 embedding call + 1 SQL query + 1 rerank call; cosine alone: unrelated facts 0.40-0.50, on-topic 0.50-0.65 with bge-m3 |
| 2026-10-27/28 (v7.2/7.3) | dates on every fact and in the injected block (v7.2); passing states removed instead of expired after 14 days (v7.3) | the chat model confused last night's remark with a year-old fact | — |
| 2026-11-04 morning | reranker server moved from half to full GPU offload (`-ngl 12` -> `-ngl 99`), embedder too | retrieval took 11-43 s per turn: the reranker scored 17-23 candidates against the whole 6-message window (~3.5k tokens each, ~60-80k tokens per turn) on a half-CPU model | retrieval **42.9 s -> 10.8 s** with the reranker on the GPU (rerank 40.0 s -> 8.0 s, embed 2.9 s -> 2.7 s, SQL ~0.1 s); the embedder followed to the GPU the same day, after which an embed call is ~1 s |
| 2026-11-04 (v7.4) | `extraction_task_name` valve: the extraction call carries `metadata.task` | Open WebUI merges the chat's metadata into server-side calls, so the extraction request reached the SSD shim under the **chat's own id**, ran in the chat's slot and threw the chat's cached prompt away **every turn** | next-turn prefill **25,027 tokens / 135 s** and 29,338 / 162 s before; **683 tokens / 4.2 s** and 1,232 / 7.6 s after (cache restored from SSD in 0.3-0.8 s) |
| 2026-11-04 evening | extraction model (`memory-manager`) back on Gemma 4 12B, now on llama.cpp (port 8186), away from the chat server | task calls on the 27B borrowed a chat slot (save + restore each turn) and ran 2x slower | extraction: 4,079-token prompt in 12.5 s at 326 tok/s, 175 tokens out; a "no changes" turn: 2,705 tokens in 8.5 s, 6 tokens out; chat slot untouched |
| 2026-11-05 (v7.5) | every stored value of a fact is shown in the injected block: subject, value, sentiment, confidence, first and last stated dates; the `Likes:` / `Dislikes:` lines are gone | sentiment reached the chat model only on positive/negative preferences (8 of 65 facts), confidence and `first_mentioned` never | not measured (each fact line is longer) |

Why the pieces are where they are:

- **Retrieval has no model call** because the only thing that must be fast is the wait before the first token. Embedding + SQL + rerank is a few seconds, dominated by the rerank (~0.5 s per candidate pair of ~3.5k tokens on the GPU); a relevance LLM was 10 s and separated no better than cosine + reranker.
- **Memories are a hidden tool result after the latest user message, saved with the reply**, so the persona prompt, tool specs and history are byte-identical across turns and llama.cpp reuses the cached prefix up to the new message. Measured alternatives: appending the block to the latest user message for that request only makes it disappear from history on the next turn, so the server re-prefills from that point; a separate system message is merged by Open WebUI into the first one (cache miss from the top); prepending to the system prompt re-prefilled the whole chat whenever the set changed (65 s at 12.5k tokens).
- **A fact is sent once per chat** because every saved recall is replayed on every later turn; sending the full block each turn would add one copy per turn to the history.
- **Extraction is a task, not the chat.** Any server-side call made with the chat's `request` inherits the chat's metadata (`chat_id`, user, session). A prompt-cache proxy keyed on the chat id (the SSD shim via `X-OpenWebUI-Chat-Id: {{CHAT_ID}}`) therefore mistakes the extraction prompt for a turn of the chat. `metadata.task` survives the merge because the chat's metadata has no `task` key; the connection header `X-OpenWebUI-Task: {{TASK}}` renders it, and the shim gives the call a task slot. The same mechanism Open WebUI uses for title/tags/queries and for its own Context Compaction (`task: context_compaction`).
- **The extraction model is small and separate** (Gemma 4 12B on its own port) because the call happens after every reply and must never compete with the chat server for a slot. Its own 2 slots absorb the post-reply burst (title, tags, follow-ups, extraction) that arrives at once.
- **One row per fact** because updates and removals then touch one row, dedup can be done by embedding similarity (`dedupe_threshold`, "job" vs "occupation" measured 0.951), and a wrong fact cannot be copied forward.

One chat turn, as it runs today:

```mermaid
sequenceDiagram
    autonumber
    participant U as User (Open WebUI)
    participant F as user_memory filter
    participant E as bge-m3 (8181)
    participant P as Postgres + pgvector
    participant R as bge-reranker (8182)
    participant S as SSD cache shim (8180)
    participant C as Qwen3.8-27B chat (8190)
    participant G as Gemma 4 12B tasks (8186)

    U->>F: inlet(body)
    F->>F: wait for the previous turn's extraction (per-user lock)
    F->>P: always-inject facts
    F->>E: embed last 6 messages (~3.5k tokens, ~1 s on the GPU)
    F->>P: nearest 3 x max_memories facts by cosine
    F->>F: keep those >= relevance_threshold (17-23 in practice)
    F->>R: rerank them against the window (~1 s on the GPU)
    F->>F: drop facts already recalled earlier in this chat
    F->>U: hidden recall_user_memories tool result after the latest user message
    U->>S: chat request, header X-OpenWebUI-Chat-Id, empty X-OpenWebUI-Task
    S->>C: pinned slot for this chat (restore from SSD if evicted, ~0.3-1 s)
    C-->>S: reply stream
    S-->>U: reply (prefill only the changed tail; 14-17 tok/s decode at 25k ctx)
    U->>F: outlet(body) saves the hidden tool result with the reply, returns at once, schedules extraction
    F->>F: take the per-user lock (the next inlet waits on it)
    F->>E: embed the new user message
    F->>P: nearest existing facts (threshold 0)
    F->>R: rerank candidates
    F->>G: memory-manager prompt, metadata.task = memory_extraction (~4k tokens, ~12 s)
    note over G: header X-OpenWebUI-Task renders the task,<br/>so a shim in front keys it as a task, never as the chat
    G-->>F: {"facts": [changes]} (often empty)
    F->>E: embed each changed fact (subject: value)
    F->>P: dedupe SELECT, then INSERT ... ON CONFLICT / UPDATE / DELETE per fact
```

Numbers worth keeping in mind when tuning: the rerank cost is `candidates x window tokens` (up to 3 x `max_memories` candidates after `relevance_threshold`, 17-23 in
practice; 6 messages of window by default); the extraction prompt is ~4k tokens regardless of chat length; the history before the new
message is identical from turn to turn, and each fact is in it once.

## 🧪 Testing

### Test Database Connection

```bash
docker exec -it user-memory-pgvector psql -U user_memory -d user_memory -c "SELECT 1;"
```

### View Stored Memories

```bash
docker exec -it user-memory-pgvector psql -U user_memory -d user_memory -c \
  "SELECT user_id, count(*) AS facts, max(last_updated) FROM user_facts GROUP BY user_id;"
docker exec -it user-memory-pgvector psql -U user_memory -d user_memory -c \
  "SELECT type, subject, value, sentiment, confidence, first_mentioned, last_updated
   FROM user_facts WHERE user_id = '<user id>' ORDER BY first_mentioned;"
# fix one fact by hand
docker exec -it user-memory-pgvector psql -U user_memory -d user_memory -c \
  "UPDATE user_facts SET value = 'in 50s', last_updated = now()
   WHERE user_id = '<user id>' AND type = 'identity' AND subject = 'age';"
```

### PII engine offline test (v7.0)
`tests/test_pii_engine.py` fakes the PII-Tracer server, the extraction model and the database and checks both engines, the
label defaults (names kept), dropping a flagged fact, both fallbacks, and one whole background update. Run it inside the Open WebUI
container (it has psycopg, aiohttp and open_webui):

```
docker cp filter/user_memory_filter.py open-webui:/tmp/ && docker cp tests/test_pii_engine.py open-webui:/tmp/
docker exec -e PYTHONPATH=/app/backend open-webui python /tmp/test_pii_engine.py /tmp/user_memory_filter.py   # ends with ALL PII ENGINE TESTS PASSED
# (importing the filter imports open_webui, whose startup logging appears first; the read-only static-file errors are harmless)
```

### Watch it work

```bash
docker logs -f open-webui 2>&1 | grep "User Memory"
```

## � PII Protection

The filter includes a **3-layer defense-in-depth** system to prevent storage of personally identifiable information:

### Layer 1: Prompt Guardrails
The extraction model's system prompt explicitly instructs it to never extract PII. Examples are provided showing how to extract non-PII meaning from PII-containing messages (e.g., "I bought a house at 123 Oak Lane" → store `ownership: house, recently purchased a house`).

### Layer 2: Pre-Scrub
Before messages reach the extraction model, all PII is replaced with `[REDACTED]`. The LLM never sees raw PII data.
What counts as PII is decided by the engine chosen with `pii_engine` (below).

### Layer 3: Post-Extraction Validation
Every extracted fact is scanned for PII in both `subject` and `value` fields, plus a subject blocklist. A fact with PII is dropped whole; the other facts from the same message are kept. A request to forget a fact is not checked, so a fact with a blocked subject can still be removed. Same engine as layer 2.

### The three settings (`pii_engine`; `regex`/`pii_tracer` since v6.1, `none` since v7.0)

- **`none`**: no pre-scrub and no post-check; facts are stored exactly as the extraction model returns them. For
  setups that do not want any PII handling in the memory path.
- **`regex`** (default): the ten built-in patterns in the table below, selectable with `pii_patterns_enabled`. No network, no model, no names: a pattern cannot tell a person's name from any other words, so names were never matched and identity facts survive.
- **`pii_tracer`**: [PII-Tracer](https://huggingface.co/perplexity-ai/PII-Tracer), Perplexity's 0.6B PII detector, running as a local server (set its URL in `pii_tracer_url`; the companion `openwebui-pii-tracer-filter` can use the same server for the chat path, but the two filters are independent of each other). It reads context, so it also finds account numbers, secrets, addresses and other values that have no fixed shape. Each pre-scrubbed message and each extracted fact's subject and value is one call to `POST /v1/pii/detect`; findings whose label is in `pii_tracer_labels` are redacted. By default `private_person` and `private_date` are **not** in that list, so "name = Beau" or a birthday is still stored, as with the regex engine; add them for a memory that keeps no names at all. `other_pii`, the model's catch-all label, is not in the list either, because it flags ordinary personal facts such as a body weight; add it for the strictest setting. With either engine the log names the kind of PII in a blocked fact, never the matched text. If the server cannot be reached, `pii_tracer_fallback` decides: `regex` (default) runs the patterns for that update and logs the failure once, `allow` treats the text as clean.

Switching engines does not touch stored facts; it only changes what the next updates scrub and block.

### Detected PII Types (regex engine)

| Pattern | Example |
|---------|---------|
| Social Security Number | `123-45-6789` |
| Credit Card | `4111-1111-1111-1111` |
| Phone Number | `(555) 123-4567` |
| Email Address | `user@example.com` |
| Street Address | `123 Main Street Apt 4B` |
| Passport Number | `Passport: A12345678` |
| Driver's License | `Driver's license: D1234567` |
| Bank Account | `Account #: 123456789` |
| Date of Birth | `DOB: 01/15/1990` |
| IP Address | `192.168.1.1` |

### What IS Stored
- Personality traits, preferences, opinions
- Ownership types ("owns a Tesla" — not the VIN)
- Relationships ("married to Sarah" — not her phone number)
- Goals, skills, interests, hobbies
- Professional info ("engineer at Acme" — not employee ID)

## 📊 Storage

One row per fact in table `user_facts` of database `user_memory`:

| Column | Type | Meaning |
|---|---|---|
| `user_id` | text | Open WebUI user id |
| `type` | text | fact type, stored lower-cased |
| `subject` | text | fact subject, stored lower-cased |
| `value` | text | the fact |
| `sentiment` | text, nullable | `positive`, `negative`, `neutral` |
| `confidence` | real, default 0.8 | model's confidence |
| `first_mentioned` | timestamptz | row insert time |
| `last_updated` | timestamptz | last time value, sentiment or confidence changed |

Primary key `(user_id, type, subject)`, so the prompt tells the model to give each item of the same kind its own
subject (`pet_pepper`, `pet_bunny_boy`). The filter creates the table on first use. Each change from the
extraction model is one `INSERT ... ON CONFLICT DO UPDATE` (only when something differs) or one `DELETE`, all in
one transaction; there is no history. History of the layout: until 2026-10-18 the data lived in LangGraph
checkpoint tables (279 rows for 15 facts, a full state copy per write); from 2026-10-18 to 2026-10-19 it was one
row per user with a `facts` JSONB list, which made single-fact edits positional and stamped every fact's
`last_updated` on every write; on 2026-10-19 the 27 facts were migrated to one row each.

## 🤖 For AI Assistants

The whole filter is one file, `filter/user_memory_filter.py`. Rules that matter when changing it:
- Anything that reads user intent (forget, update, what is a fact) goes through the extraction model and its
  prompt, never through regex or keyword matching in code.
- Prompt changes go into the prompt file **and** the matching `model` table row.
- No valves for hypothetical setups: one working path. The installed copy is the DB function `user_memory`;
  keep it byte-identical to the repo file.
- [docs/AI_DEVELOPMENT_GUIDE.md](docs/AI_DEVELOPMENT_GUIDE.md) is historical (schema versions, LangGraph).

## 🐛 Troubleshooting

### Common Errors

**`ImportError: no pq wrapper available`**
```bash
pip install "psycopg[binary]"
```

**`Error loading module: user_memory: No module named 'psycopg_pool'`** on create

You are installing filter 5.1 or older. Use 5.2+, which has no `psycopg-pool`
dependency. (Workaround for the old version: `pip install psycopg-pool` inside the
container; it is lost when the container is recreated.)

**`TypeError: expected string or bytes-like object, got 'list'`** in `_update_user_memory_state`, or
**`request (N tokens) exceeds the available context size`** from the relevance model
Happened when a chat message had an image attached: Open WebUI then sends `content` as a list of
parts (text + base64 `image_url`) instead of a string, which broke the PII regex scrub and pushed the
whole image into the relevance prompt. Fixed in the filter (2026-10-14): `content_to_text()` keeps only
the text parts and drops image data. There is no per-message length cap (removed 2026-10-18): the
filter never sees attached files (Open WebUI runs file retrieval after the filter inlet), so the only
oversized input is a raw paste. Keep **Paste Large Text as File** enabled in Settings > Interface; a raw
paste larger than the helper model's context makes that helper call fail and the filter skips the
memory update for that turn without writing anything.

**Existing facts disappear after a chat**
The extraction model is only asked for changes and the filter upserts its output onto the stored facts: same
type+subject updates the fact and keeps `first_mentioned`, new type+subject is appended, and facts the model did
not return are kept. A fact is dropped only when the model returns it with `"remove": true` (or `"status":
"removed"`). The memory-manager preset's system prompt must match this contract (it is tracked in
[prompt/MERGE_PROMPT_memory-manager.md](prompt/MERGE_PROMPT_memory-manager.md) and installed in the `model` table).

**Forget commands.** Both "forget everything you know about me" and targeted forgets such as
"forget my cars" go through the extraction model, which must return each matching fact (or every fact)
with `"remove": true`. The log line `Merge upsert: ... removed` shows what it did. Memory extraction for that message
was skipped, so re-send the fact in a new message.

## 📝 License

MIT License

## 🙏 Acknowledgments

- [Open WebUI](https://github.com/open-webui/open-webui) - The amazing AI chat interface
- [psycopg](https://www.psycopg.org/) - PostgreSQL driver
