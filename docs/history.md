# History and measurements

Dated history of the filter. The current state is in the [README](../README.md) and the other docs.

The repo was renamed from `openwebui-langgraph-memory-filter` on 2026-10-27. LangGraph was removed on 2026-10-18, the relevance model on 2026-10-24 (v7.0); memories carry dates since 2026-10-27 (v7.2, v7.3 on 2026-10-28; v7.4 on 2026-11-04 adds `extraction_task_name` so the extraction call no longer evicts the chat from the prompt cache; v7.5 on 2026-11-05 shows every stored value of a fact in the injected block).

## Shapes the filter went through

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
| 2026-11-08 (v8.0) | recalled facts are a hidden tool result after the latest user message, saved with the reply and replayed on later turns | appended to the user message for one request only, the block vanished from history on the next turn and the server re-read everything after it | not recorded here |
| 2026-11-23 (v8.1-8.4) | each fact sent once per chat; per-user valves read; action and settings panel for users to see and delete their facts; reranker failure falls back to vector order; 30 s / 300 s limits on waiting for and running extraction; no fact values, model replies or matched PII in the log; per-item check with `confidence_floor` and `fact_types` (sent to the model as ALLOWED TYPES); redact mode removed; embedding prefixes read from Open WebUI's saved setting; `other_pii` no longer acted on by default | a full-repo review, and live tests in which PII-Tracer flagged "I am actually 187 lbs" as `other_pii` and the whole message was redacted before extraction | on the 27B chat server an extraction call that changes nothing read 4,620-5,571 prompt tokens at ~212 tok/s and generated 10 tokens (22-27 s) |

## Earlier measurements

Measured before 2026-10-18 (43 turns): the inlet blocked each reply for a median 36.5 s (extraction 27 s,
relevance 10 s). Since 2026-10-18 extraction is off the reply path; since 2026-10-24 the inlet makes no model call at
all (one embedding call, one SQL query, an optional reranker call).

Server side, `--checkpoint-min-step 512` (2048 until 2026-11-02) on the llama.cpp chat server bounds the redo when the prompt changes mid-way
(details in `~/Source/local-llm-config/README.md`, "Prompt cache, checkpoints and the memory filter").
The installed copy is the DB function `user_memory`, pasted from `filter/user_memory_filter.py`.

## Storage layout

History of the layout: until 2026-10-18 the data lived in LangGraph
checkpoint tables (279 rows for 15 facts, a full state copy per write); from 2026-10-18 to 2026-10-19 it was one
row per user with a `facts` JSONB list, which made single-fact edits positional and stamped every fact's
`last_updated` on every write; on 2026-10-19 the 27 facts were migrated to one row each.

## Dependencies

Filter 5.1 and earlier needed `psycopg-pool`; 5.2 opens one plain connection per query instead.

## Errors from old versions

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
