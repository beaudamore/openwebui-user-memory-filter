# User Memory settings panel

`frontend/user_memory_panel.js` adds a **User Memory** section to Settings > Personalization, below Open WebUI's own
Memory setting. Its **Manage** button opens a table of the facts stored about the signed-in user, with search,
delete per fact and delete all. It needs no chat and no reply.

Open WebUI shows the Personalization tab only while its own Memories feature is enabled and allowed for the user.
When that tab is not there, the section is added to Settings > General.

Open WebUI is not forked. Every page loads `/static/loader.js`; the site's loader loads this script, and the script
adds the section to the page.

Everything the panel needs is in this repo:

| File | Role |
|------|------|
| `frontend/user_memory_panel.js` | The panel script, deployed as `/static/user-memory-panel.js` |
| `frontend/loader_snippet.js` | The block that makes the site's `loader.js` load the panel script |
| `action/user_memory_management.py` | The action function the panel talks to |
| `filter/user_memory_filter.py` | The filter that owns the facts |

## Install

1. **Required:** the `user_memory` filter (v8.1 or later) and the `user_memory_management` action are installed and
   enabled ([memory-management-action.md](memory-management-action.md)).
2. **Required:** the two host files exist and are bind-mounted into the Open WebUI container (see
   [Volume mounts](#volume-mounts) below).
3. **Required:** the container is redeployed after the mounts are added.
4. **Required for non-admin users:** the action is surfaced on at least one model they can use: its **Global**
   switch is on, or it is ticked under **Actions** on such a model. An admin needs neither.

## Volume mounts

Open WebUI serves everything in the container folder `/app/backend/open_webui/static` under the URL `/static/`.
Its page loads exactly one custom script from there, `/static/loader.js`, which ships empty. The panel needs two
files in that folder: a `loader.js` that contains the load block, and the panel script itself. Both come in as
single-file bind mounts, so the rest of the folder stays as the image ships it.

**Host files.** Keep them together in one host folder, for example `~/docker-data/openwebui/frontend/`:

| Host file | Comes from | Container path |
|-----------|-----------|----------------|
| `loader.js` | The site's own loader with the block from `frontend/loader_snippet.js` pasted at its end. A site with no loader yet uses a copy of `frontend/loader_snippet.js` as its `loader.js` | `/app/backend/open_webui/static/loader.js` |
| `user-memory-panel.js` | A copy of `frontend/user_memory_panel.js` (note the hyphens in the deployed name) | `/app/backend/open_webui/static/user-memory-panel.js` |

**Compose.** Under the Open WebUI service, with the host folder written as an absolute path:

```yaml
services:
  open-webui:
    volumes:
      - /absolute/path/to/frontend/loader.js:/app/backend/open_webui/static/loader.js:ro
      - /absolute/path/to/frontend/user-memory-panel.js:/app/backend/open_webui/static/user-memory-panel.js:ro
```

Rules that matter:

- **Create both host files before the container starts.** When the host path of a bind mount does not exist,
  Docker creates a folder with that name, and the container then has a folder where the script should be. If that
  happened: stop the container, delete the folder on the host, put the file there, start again.
- **Absolute host paths.** A relative path is resolved against the folder the compose file is deployed from. For a
  Portainer stack that is Portainer's own data folder, not this repo.
- **`:ro`.** The container only reads these files.
- **Bind mounts only, one file each.** Mounting a host folder over `/app/backend/open_webui/static` would hide the
  icons, splash images and Swagger files the image ships there.
- **A site that already mounts `loader.js`** needs only the second line, plus the pasted block in its loader.

**Check that it is served.** After the redeploy, both of these return the file, not a 404:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<open-webui-host>/static/loader.js
curl -s http://<open-webui-host>/static/user-memory-panel.js | head -3
```

Then hard-refresh the browser so it fetches the new `loader.js`.

**Updating the script later.** Copy the new `frontend/user_memory_panel.js` over the host file. A single-file bind
mount follows the file it was started with, so overwrite the file in place (`cp new old`) and do not delete and
re-create it. If the container still serves the old content (compare `curl` output with the host file), restart
the container. Browsers need a hard refresh afterwards.

## What the user sees

1. Settings > Personalization (or General, see above) shows a "User Memory" section with a **Manage** button.
2. Manage opens "Your memories": one row per fact with type, subject, memory, sentiment, confidence, and the dates
   it was first and last stated. The table scrolls; the search box filters it as you type.
3. **Delete** on a row asks once, then deletes that fact. **Delete all** asks once, then deletes every fact in the
   list, including rows the search has hidden.
4. Close, Esc or a click outside the table returns to Settings.

## How it works

- The script has no data access of its own. It posts to Open WebUI's action route
  (`/api/chat/actions/user_memory_management`) with the user's own session token and a `user_memory_request`
  (`{"op": "list"}` or `{"op": "delete", "facts": [...]}`). The action answers with the user's facts as JSON instead
  of opening its dialogs, and reads and deletes through the filter. The user is always the signed-in one.
- The action route requires a model id. The script takes the first model that lists the action, else the first
  model the user has.
- The section is added by a one-second check for the Personalization form (`#tab-personalization`, else
  `#tab-general`), because Open WebUI rebuilds a settings tab each time it is opened.
- A refusal from the server is shown with the server's own reason (for example "Action not available").

## Limits

- It depends on Open WebUI's page markup: the ids `tab-personalization` and `tab-general` and the class names
  copied from its settings rows. If an update renames them, the section stops appearing (or loses its styling) until the script is
  adjusted. Nothing else breaks.
- View and delete only; a fact cannot be edited here.
- A deleted fact still reaches the model in chats that already recalled it, because saved recalls are replayed with
  the chat.
