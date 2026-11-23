# Storage

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
one transaction; there is no history.

A second table, `user_facts_meta`, holds one row with the embedding model and dimension the stored vectors were made with. The `embedding` column is `vector(N)`, N being whatever Open WebUI's embedding model returns, with an HNSW cosine index when N ≤ 2000.

## Database stack

One compose file, `docker/user-memory-pgvector.yml`, with two services:

- `user-memory-pgvector`: the database (`pgvector/pgvector:pg16`), data on a bind mount, no published port. Open
  WebUI reaches it by container name over `webui-network`.
- `user-memory-pgadmin`: **optional.** pgAdmin, a web UI for looking at the database, on port 5050. The filter
  never uses it; delete the service block to run the database alone.

```bash
cd docker
docker compose -f user-memory-pgvector.yml up -d
```

The stack joins the external Docker network `webui-network`, which the Open WebUI container must be on too. Create it first if it does not exist: `docker network create webui-network`.

The valves that match this file are in [configuration.md](configuration.md).
