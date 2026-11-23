"""
title: User Memory Management
author: beaudamore
date: 2026-11-23
version: 1.1
license: MIT
description: Lets a user see the facts the User Memory filter has stored about them and delete one or all of them. Two entry points: the button under a reply opens dialogs, and the Settings panel (frontend/user_memory_panel.js) gets the facts as JSON. Nothing is written to the chat. Reads and deletes through the installed user_memory filter, so it has no valves and no database settings of its own.
required_open_webui_version: >= 0.13.3
icon_url: data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxlbGxpcHNlIGN4PSIxMiIgY3k9IjYiIHJ4PSI4IiByeT0iMyIvPjxwYXRoIGQ9Ik00IDZ2NmMwIDEuNyAzLjYgMyA4IDNzOC0xLjMgOC0zVjYiLz48cGF0aCBkPSJNNCAxMnY2YzAgMS43IDMuNiAzIDggM3M4LTEuMyA4LTN2LTYiLz48L3N2Zz4=
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import Counter
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import Request

from open_webui.utils.filter import apply_filter_valves
from open_webui.utils.plugin import get_function_module_from_cache

logger = logging.getLogger("openwebui.actions.user_memory_management")

# The function id the User Memory filter is installed under. The filter owns the store.
FILTER_ID = "user_memory"
# Open WebUI's event dialogs always label their buttons Cancel / Confirm (Chat.svelte passes no
# labels for them), so each dialog's text says what Confirm does.

# Select value of the "delete everything" entry; fact entries carry a JSON [type, subject].
DELETE_ALL = "__all__"
# A native select shows one line per entry; longer facts are cut in the list and shown whole
# in the dialog that follows.
LABEL_MAX = 110
# Body key the settings panel (frontend/user_memory_panel.js) puts its request under.
PANEL_REQUEST_KEY = "user_memory_request"
FAILED = "Memory management failed. The server log has the details."
FILTER_TOO_OLD = f"The installed '{FILTER_ID}' filter is older than this action. Update the filter."
# Open WebUI sets no time limit on a dialog by default, and a dialog whose chat is no longer
# open is never answered; the action gives up after this many seconds.
DIALOG_TIMEOUT = 300


class Action:
    async def _memory_filter(self, request: Request) -> Any:
        """The installed User Memory filter with its saved valves, loaded by Open WebUI's own
        helper, the way it is before an inlet call. None when that filter has no list_facts /
        remove_facts (installed copy older than this action)."""
        memory_filter, _, _ = await get_function_module_from_cache(request, FILTER_ID)
        if not hasattr(memory_filter, "list_facts") or not hasattr(memory_filter, "remove_facts"):
            return None
        await apply_filter_valves(memory_filter, None, None, [FILTER_ID], FILTER_ID)
        return memory_filter

    @staticmethod
    def _type_name(fact_type: Any) -> str:
        return str(fact_type or "other").replace("_", " ")

    def _summary(self, facts: List[Dict[str, Any]]) -> str:
        counts = Counter(self._type_name(f.get("type")) for f in facts)
        per_type = ", ".join(f"{n} {t}" for t, n in sorted(counts.items()))
        return (
            f"{len(facts)} stored: {per_type}.\n\n"
            "Pick one and press **Confirm** to open it. Nothing is deleted at this step."
        )

    def _options(self, facts: List[Dict[str, Any]], memory_filter: Any) -> List[Dict[str, str]]:
        options = [{"label": f"Delete ALL {len(facts)} memories", "value": DELETE_ALL}]
        for f in sorted(facts, key=lambda f: (str(f.get("type")), str(f.get("subject")))):
            label = f"{self._type_name(f.get('type')).title()} {memory_filter.fact_line(f).strip()}"
            if len(label) > LABEL_MAX:
                label = label[: LABEL_MAX - 1] + "…"
            options.append({"label": label, "value": json.dumps([f.get("type"), f.get("subject")])})
        return options

    async def _panel_request(
        self, panel: Dict[str, Any], __user__: Dict[str, Any], request: Request
    ) -> Dict[str, Any]:
        """A call from the settings panel: no dialogs, the reply is the JSON the panel shows.
        panel: {"op": "list"} or {"op": "delete", "facts": [{"type", "subject"}, ...]}.
        Returns {"facts": [every fact still stored], "removed": n} or {"error": text}."""
        try:
            memory_filter = await self._memory_filter(request)
            if memory_filter is None:
                return {"error": FILTER_TOO_OLD}
            removed = 0
            if panel.get("op") == "delete":
                targets = [f for f in panel.get("facts") or [] if isinstance(f, dict)]
                removed = await memory_filter.remove_facts(__user__, targets, request)
            elif panel.get("op") != "list":
                return {"error": "Unknown request."}
            return {"facts": await memory_filter.list_facts(__user__, request), "removed": removed}
        except Exception:
            logger.exception("User Memory Management panel request failed")
            return {"error": FAILED}

    async def action(
        self,
        body: Dict[str, Any],
        __user__: Optional[Dict[str, Any]] = None,
        __event_emitter__: Optional[Callable[[Any], Awaitable[None]]] = None,
        __event_call__: Optional[Callable[[Any], Awaitable[Any]]] = None,
        __request__: Optional[Request] = None,
    ) -> Optional[Dict[str, Any]]:
        """Two entry points. The settings panel sends a request under PANEL_REQUEST_KEY and
        gets JSON back (_panel_request). The button under a reply opens dialogs: the user's
        facts in a list; a picked fact is shown in full with a delete question. That repeats
        until the list is cancelled, confirmed with nothing picked, empty, or a dialog goes
        unanswered for DIALOG_TIMEOUT seconds."""
        if not __user__ or not __user__.get("id"):
            return None
        if isinstance(body.get(PANEL_REQUEST_KEY), dict):
            return await self._panel_request(body[PANEL_REQUEST_KEY], __user__, __request__)
        if not __event_call__:
            return None

        async def notify(kind: str, text: str):
            if __event_emitter__:
                await __event_emitter__({"type": "notification", "data": {"type": kind, "content": text}})

        async def ask(kind: str, data: Dict[str, Any]) -> Any:
            return await asyncio.wait_for(__event_call__({"type": kind, "data": data}), DIALOG_TIMEOUT)

        try:
            memory_filter = await self._memory_filter(__request__)
            if memory_filter is None:
                await notify("error", FILTER_TOO_OLD)
                return
            while True:
                facts = await memory_filter.list_facts(__user__, __request__)
                if not facts:
                    await notify("info", "No memories are stored about you.")
                    return
                choice = await ask(
                    "input",
                    {
                        "title": "Your memories",
                        "message": self._summary(facts),
                        "placeholder": "Select a memory",
                        "input": {"type": "select", "options": self._options(facts, memory_filter)},
                    },
                )
                # Cancel returns False, a lost session returns an error dict, no selection ''.
                if not isinstance(choice, str) or not choice:
                    return

                if choice == DELETE_ALL:
                    targets = facts
                    title = "Delete all memories?"
                    question = (
                        f"**Confirm** deletes all {len(facts)} memories. **Cancel** keeps them.\n\n"
                        "This cannot be undone."
                    )
                else:
                    key = json.loads(choice)
                    targets = [f for f in facts if [f.get("type"), f.get("subject")] == key]
                    title = "Delete this memory?"
                    # Fenced, so markdown or an image link inside a fact is shown as stored.
                    question = (
                        f"**{self._type_name(targets[0].get('type')).title()}**\n\n"
                        f"~~~~\n{memory_filter.fact_line(targets[0]).strip()}\n~~~~\n\n"
                        "**Confirm** deletes it. **Cancel** keeps it. This cannot be undone."
                    )

                if await ask("confirmation", {"title": title, "message": question}) is True:
                    removed = await memory_filter.remove_facts(__user__, targets, __request__)
                    await notify("success", f"Deleted {removed} memor{'y' if removed == 1 else 'ies'}.")
        except asyncio.TimeoutError:
            logger.info("User Memory Management: dialog unanswered, closed")
        except Exception:
            # Details (database host, missing function) go to the server log, not to the user.
            logger.exception("User Memory Management failed")
            await notify("error", FAILED)
