# Compared with Open WebUI's built-in Memories

Open WebUI has its own Memories feature. This comparison is against its code in v0.13.4
(`backend/open_webui/utils/memory.py`, `routers/memories.py`, `tools/builtin.py`). It compares what each one does;
the two have not been benchmarked against each other on recall quality.

The built-in feature is a store of free-text notes that the chat model manages itself. This filter is a store of
structured facts that a dedicated model keeps up to date after every turn. The differences follow from that.

| | This filter | Built-in Memories (v0.13.4) |
|---|---|---|
| **When memories are written** | After every reply, automatically, in the background | When the chat model decides to call `add_memory` during a reply. Automatic "background review" exists but is off by default (`ENABLE_MEMORY_BACKGROUND_REVIEW`), has no admin switch, and runs every 10 user turns |
| **Which model extracts** | A dedicated model (`extraction_model_id`). With `extraction_task_name` and the task header, or with that model on another server, the chat's slot and prompt cache are untouched | The chat model itself |
| **Extraction prompt** | Yours: the system prompt of the `memory-manager` model, editable | Fixed in the source code |
| **What a memory is** | A fact with type, subject, value, sentiment, confidence and first/last stated dates | One line of text with a type (`user` or `context`) and an optional path |
| **Dates** | Every fact shows when it was first and last stated, and the block carries today's date | None in the recalled block |
| **Updating a fact** | Same type + subject overwrites the row; "I moved to Y" replaces the old location | The model has to find the old note and call a replace or delete tool |
| **Duplicates** | A new fact that is ≥ `dedupe_threshold` similar to an existing one of the same type updates that row (`job` vs `occupation`) | Exact text match only, and only on batch adds |
| **Short-lived states** | The prompt keeps them out and removes a stored one when the model is shown it | The review prompt asks the model not to save them; no rule removes one that got in |
| **Retrieval** | Vector search with a similarity cutoff, then Open WebUI's reranker, top `max_memories` (20) | Vector search, top 8, no reranker; cutoff only if the RAG relevance threshold is above 0 |
| **Always sent** | Facts of `always_inject_types` (identity) | Every `user`-type memory, whatever the topic |
| **PII** | Scrubbed before extraction and each extracted fact checked after it (regex or a local PII-Tracer server) | No filter; the review prompt asks the model not to save secrets |
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
  [settings panel](memory-settings-panel.md) and the [action](memory-management-action.md) here list and
  delete facts but do not edit.
- **Tools the model can call on demand** to search, list and manage memories. Here the model only receives what
  the inlet recalled.
- **Organising notes by path**, and pulling in notes whose path name appears in the conversation.

Both inject the same way in v0.13.4 when the model uses native tool calling: a hidden tool result after the latest
user message, with each memory sent once per chat. Both can be enabled at once, in which case both inject.
