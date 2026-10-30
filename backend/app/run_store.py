"""Finished runs kept per browser session, so visitors to a public deploy never see or change each other's plans.

Each browser sends a random session id with every call. A run (its state, review, evidence manifest and
site questions) is stored under (session, site). The store is bounded: the oldest runs are dropped first
and runs expire after a few hours, so a busy public demo cannot grow memory without limit.
"""

from __future__ import annotations

import re
import time
from collections import OrderedDict
from typing import Any

from fastapi import Request

# Requests without a session (tests, curl, the rack-card helper) share one key
SHARED_SESSION = "shared"
_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def session_of(request: Request) -> str:
    """The caller's session id from `?session=` or the `X-Conduit-Session` header; malformed ids are ignored."""
    raw = request.query_params.get("session") or request.headers.get("x-conduit-session") or ""
    return raw if _SESSION_RE.match(raw) else SHARED_SESSION


class RunStore:
    def __init__(self, *, max_runs: int = 256, ttl_seconds: float = 6 * 3600) -> None:
        self._runs: OrderedDict[tuple[str, str], tuple[float, dict[str, Any]]] = OrderedDict()
        self._max_runs = max_runs
        self._ttl = ttl_seconds

    def _expire(self) -> None:
        cutoff = time.monotonic() - self._ttl
        while self._runs and next(iter(self._runs.values()))[0] <= cutoff:
            self._runs.popitem(last=False)

    def get(self, session: str, scenario_id: str) -> dict[str, Any] | None:
        self._expire()
        key = (session, scenario_id)
        item = self._runs.get(key)
        if item is None:
            return None
        # Reading a run keeps it alive, like a cache hit
        self._runs[key] = (time.monotonic(), item[1])
        self._runs.move_to_end(key)
        return item[1]

    def put(self, session: str, scenario_id: str, run: dict[str, Any]) -> None:
        key = (session, scenario_id)
        self._runs.pop(key, None)
        self._runs[key] = (time.monotonic(), run)
        while len(self._runs) > self._max_runs:
            self._runs.popitem(last=False)
        self._expire()

    def __len__(self) -> int:
        return len(self._runs)
