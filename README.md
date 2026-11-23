# User Memory Filter for Open WebUI

![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python&logoColor=white)
![OpenWebUI](https://img.shields.io/badge/Open_WebUI-Filter-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Backend-blue?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow)

A persistent per-user memory for [Open WebUI](https://github.com/open-webui/open-webui): facts about the user are
extracted by a small local model after each reply, stored in one PostgreSQL table with a pgvector embedding per
fact, and the nearest ones are injected into the next request by vector search (reranked when Open WebUI has a
reranker configured). Embeddings come from Open WebUI's own configured embedding model. The installed
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

## 📁 Project Structure

```
openwebui-user-memory-filter/
├── README.md                    # This file: current state and index
├── filter/
│   └── user_memory_filter.py    # The filter (installed copy = function user_memory)
├── action/
│   └── user_memory_management.py  # Action button and the settings panel's server side
├── frontend/
│   ├── user_memory_panel.js     # Settings > Personalization section with a table of the user's facts
│   └── loader_snippet.js        # Block for the site's loader.js that loads the panel script
├── prompt/
│   ├── MERGE_PROMPT_memory-manager.md  # System prompt of the memory-manager model (extraction)
│   └── INSTRUCTIONS.md                 # Model setup walkthrough
├── docker/
│   └── user-memory-pgvector.yml   # The database stack: PostgreSQL 16 + pgvector, and optional pgAdmin
├── tests/
│   └── test_pii_engine.py       # Offline test of the PII engines and one background update
└── docs/                        # One file per subject, see Documentation below
```

## 🚀 Quick Start

### 1. Start PostgreSQL with pgvector

Edit `docker/user-memory-pgvector.yml` first: set `POSTGRES_PASSWORD` and the database's host path. pgAdmin is
optional: either set its login and host path too, or delete the `user-memory-pgadmin` service block.
Then:

```bash
docker network create webui-network   # once, if it does not exist; Open WebUI must be on it too
cd docker
docker compose -f user-memory-pgvector.yml up -d
```

The server must have the `vector` extension available (image `pgvector/pgvector:pg16`); the filter runs
`CREATE EXTENSION IF NOT EXISTS vector` itself. Details: [docs/storage.md](docs/storage.md).

### 2. Install the filter

Nothing to pip-install: the filter uses `psycopg` and `aiohttp`, which ship with Open WebUI.

1. Go to Open WebUI **Admin Panel** → **Functions** and create a new function with the id `user_memory`
2. Paste the contents of `filter/user_memory_filter.py`
3. Save, enable the filter, and attach it to the models that should remember (model → Filters)
4. Set the four connection valves: `postgres_url`, `postgres_database`, `postgres_user`, `postgres_password`
   ([docs/configuration.md](docs/configuration.md))

### 3. Configure the extraction model and the embedder

Walkthrough: [prompt/INSTRUCTIONS.md](prompt/INSTRUCTIONS.md). In short:

1. Create a workspace model `memory-manager` with the system prompt from `prompt/MERGE_PROMPT_memory-manager.md`;
   the filter's `extraction_model_id` valve defaults to that id.
2. Embeddings and reranking are not configured in the filter. It uses what Open WebUI has under
   **Admin Panel > Settings > Documents**: the embedding model (required) and the reranking model (optional; when set,
   it orders the retrieved facts). **Admin note, reindex on change:** after changing the embedding model, restart Open
   WebUI. The filter checks the model once per start and then re-embeds every fact; until the restart, memory search
   fails or ranks wrongly.

### 4. Optional: let users see and delete their memories

Install the action and the settings panel: [docs/memory-management-action.md](docs/memory-management-action.md),
[docs/memory-settings-panel.md](docs/memory-settings-panel.md).

## 📖 Documentation

| Document | Subject |
|----------|---------|
| [docs/how-it-works.md](docs/how-it-works.md) | What the inlet and outlet do, where memories are injected and why, one turn step by step |
| [docs/configuration.md](docs/configuration.md) | Every valve, the per-user valves, embedding prefixes |
| [docs/pii-protection.md](docs/pii-protection.md) | The PII engines, what is scrubbed and what is dropped |
| [docs/storage.md](docs/storage.md) | The tables and the database stack |
| [docs/memory-settings-panel.md](docs/memory-settings-panel.md) | The User Memory section in Settings > Personalization: install, volume mounts, limits |
| [docs/memory-management-action.md](docs/memory-management-action.md) | The action button under replies and the panel's server side |
| [docs/comparison-with-built-in-memories.md](docs/comparison-with-built-in-memories.md) | This filter next to Open WebUI's built-in Memories |
| [docs/testing.md](docs/testing.md) | Database checks, the offline PII test, watching the log |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common problems and what the log shows |
| [docs/history.md](docs/history.md) | Dated history and measurements |
| [prompt/INSTRUCTIONS.md](prompt/INSTRUCTIONS.md) | Extraction model setup walkthrough |

Outdated, kept for reference only, do not follow them: [EXTRACTION_MODEL_SETUP.md](docs/EXTRACTION_MODEL_SETUP.md)
(its prompt and valves do not match the filter), [security.md](docs/security.md), [IMPROVEMENTS.md](docs/IMPROVEMENTS.md),
and the LangGraph-era [LANGGRAPH_SETUP.md](docs/LANGGRAPH_SETUP.md), [MEMORY_GRAPH_V4.md](docs/MEMORY_GRAPH_V4.md),
[AI_DEVELOPMENT_GUIDE.md](docs/AI_DEVELOPMENT_GUIDE.md), [MEMORY_FILTER_V2_PLAN.md](docs/MEMORY_FILTER_V2_PLAN.md).

## 🔧 Requirements

- **Open WebUI**: >= 0.13.3
- **PostgreSQL**: 16+ with the pgvector extension (provided by `docker/user-memory-pgvector.yml`)
- **Python packages**: `psycopg[binary]` and `aiohttp`, both bundled with Open WebUI
- **An embedding model** configured in Open WebUI; a reranking model is optional

## 🤖 For AI Assistants

The whole filter is one file, `filter/user_memory_filter.py`. Rules that matter when changing it:
- Anything that reads user intent (forget, update, what is a fact) goes through the extraction model and its
  prompt, never through regex or keyword matching in code.
- Prompt changes go into the prompt file **and** the matching `model` table row.
- No valves for hypothetical setups: one working path. The installed copy is the DB function `user_memory`;
  keep it byte-identical to the repo file.
- The README holds the current state and the index only. Each subject has its own file under `docs/`; dated history goes in `docs/history.md`.
- The prompt, the filter and the action are installed in Open WebUI's database; after a change, the installed copies must match the repo files.

## 📝 License

MIT License

## 🙏 Acknowledgments

- [Open WebUI](https://github.com/open-webui/open-webui) - The amazing AI chat interface
- [psycopg](https://www.psycopg.org/) - PostgreSQL driver
