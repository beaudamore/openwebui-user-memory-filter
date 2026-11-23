# User Memory Management action

`action/user_memory_management.py` is an Open WebUI action function: a button under each reply that lets a user see
the facts the User Memory filter has stored about them and delete one or all of them.

The same function is the server side of the [settings panel](memory-settings-panel.md): a request that carries a
`user_memory_request` (`{"op": "list"}` or `{"op": "delete", "facts": [...]}`) gets the user's facts back as JSON
and opens no dialog. Open WebUI gives a function no other way to answer a page, so both entry points live in this
one function.

## Install

1. **Required:** the installed `user_memory` filter is `filter/user_memory_filter.py` v8.1 or later. The action calls
   the filter's `list_facts`, `remove_facts` and `fact_line`; an older filter makes the action report
   "The installed 'user_memory' filter is older than this action".
2. **Required:** Admin Panel > Functions > new function, paste `action/user_memory_management.py`, save with the id
   `user_memory_management`.
3. **Required:** enable the function.
4. **Required:** make the button appear: either turn on the function's **Global** switch, or tick it under
   **Actions** on each workspace model that should show it.

The action has no valves. It uses the filter's saved valves for the database connection.

## What the user sees

1. Click the button under any reply.
2. A dialog titled "Your memories" shows how many facts are stored per type and a select list with one entry per
   fact, sorted by type and subject. Long facts are cut to 110 characters in the list.
3. Picking a fact and pressing Confirm opens a second dialog titled "Delete this memory?" with the whole fact
   (value, sentiment, confidence, first and last stated dates). There, Confirm deletes it and Cancel keeps it. Open
   WebUI fixes the button labels to Cancel / Confirm, so each dialog's text says what Confirm does.
4. The list opens again. It closes when the user cancels it, confirms with nothing picked, has no facts left, or
   leaves a dialog unanswered for 5 minutes.
5. The first entry of the list, "Delete ALL n memories", asks once and then deletes the n facts in the list. A fact
   the filter extracts between opening the list and confirming is kept.

A toast reports how many facts were deleted. Nothing is written to the chat. On a failure the toast says so and the
details are in the server log.

## How it works

- The action loads the installed filter (function id `user_memory`) through Open WebUI's function cache, gives it
  its saved valves, and calls the filter's `list_facts` and `remove_facts`. All SQL and the connection settings stay
  in the filter. It works whether or not the filter is switched on.
- Listing does not wait for a running extraction. Deletes use the same row-by-row delete as the extraction model's
  removals (`_delete_facts`), matched on type and subject exactly as stored, under the same per-user lock as recall
  and extraction, so a delete waits for an extraction that is still running.
- "Delete ALL" removes every listed fact without the extraction model. A "forget everything" message in chat goes
  through the extraction model, which can only remove the facts it was shown (the `always_inject_types` facts plus
  the `max_memories` nearest).
- The dialogs are Open WebUI's `input` (select) and `confirmation` events. The select dialog has no scroll area of
  its own, so the facts are listed in the select, not in the dialog text.

## Limits

- View and delete only; a fact cannot be edited here.
- The dialog does not scroll: a very long fact can push its buttons off a small screen (Enter confirms, Esc cancels).
- A deleted fact still reaches the model in chats that already recalled it, because saved recalls are replayed with
  the chat.
