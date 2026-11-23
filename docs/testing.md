# Testing

## Test Database Connection

```bash
docker exec -it user-memory-pgvector psql -U user_memory -d user_memory -c "SELECT 1;"
```

## View Stored Memories

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

## PII engine offline test
`tests/test_pii_engine.py` fakes the PII-Tracer server, the extraction model and the database and checks both engines, the
label defaults (names kept), dropping a flagged fact, both fallbacks, and one whole background update. Run it inside the Open WebUI
container (it has psycopg, aiohttp and open_webui):

```
docker cp filter/user_memory_filter.py open-webui:/tmp/ && docker cp tests/test_pii_engine.py open-webui:/tmp/
docker exec -e PYTHONPATH=/app/backend open-webui python /tmp/test_pii_engine.py /tmp/user_memory_filter.py   # ends with ALL PII ENGINE TESTS PASSED
# (importing the filter imports open_webui, whose startup logging appears first; the read-only static-file errors are harmless)
```

## Watch it work

```bash
docker logs -f open-webui 2>&1 | grep "User Memory"
```
