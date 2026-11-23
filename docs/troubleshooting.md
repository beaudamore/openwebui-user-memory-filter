# Troubleshooting

**`ImportError: no pq wrapper available`**
```bash
pip install "psycopg[binary]"
```

**A memory update is skipped after a very large paste**

The filter sends the raw text of the user's messages to the extraction model with no length cap. It never sees attached
files (Open WebUI runs file retrieval after the filter inlet), so the only oversized input is a raw paste. Keep
**Paste Large Text as File** enabled in Settings > Interface; a raw paste larger than the extraction model's context
makes that call fail, and the filter skips the memory update for that turn without writing anything.

**A fact stated in chat is not stored**

Check the log for `PII pre-scrub ... redacted PII in message` on that turn: the PII engine replaced part of the message
before the extraction model saw it. With `pii_tracer`, the labels acted on are the `pii_tracer_labels` valve
(see [pii-protection.md](pii-protection.md)). Also check `confidence_floor` and `fact_types`: the log line
`Skipped change item(s) from the model` says how many items were dropped and why.

**Existing facts disappear after a chat**
The extraction model is only asked for changes and the filter upserts its output onto the stored facts: same
type+subject updates the fact and keeps `first_mentioned`, new type+subject is appended, and facts the model did
not return are kept. A fact is dropped only when the model returns it with `"remove": true` (or `"status":
"removed"`). The memory-manager preset's system prompt must match this contract (it is tracked in
[prompt/MERGE_PROMPT_memory-manager.md](../prompt/MERGE_PROMPT_memory-manager.md) and installed in the `model` table).

**"Forget everything" leaves facts behind**

A forget request in chat goes through the extraction model, which returns each matching fact with `"remove": true`.
The model is only shown the `always_inject_types` facts plus the `max_memories` facts nearest to the message, so it can
only remove those. The log line `Applied changes for user ...: ... removed` shows how many rows went. To remove
everything, or one specific fact, use the settings panel or the action ([memory-settings-panel.md](memory-settings-panel.md),
[memory-management-action.md](memory-management-action.md)); they delete rows directly.

**A deleted or changed fact still shows up in an old chat**

Recalled facts are saved with the reply and replayed with that chat, so a chat that recalled a fact before it was deleted
or changed still carries the old line. New chats do not.
