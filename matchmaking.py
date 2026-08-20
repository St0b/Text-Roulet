"""In-memory matchmaking for anonymous browser clients."""

from __future__ import annotations

import secrets
import threading
import time


CLIENT_TIMEOUT = 12.0


class Matchmaking:
    def __init__(self) -> None:
        self.clients: dict[str, dict[str, object]] = {}
        self.waiting: list[str] = []
        self.lock = threading.Lock()

    def _remove_client(self, client_id: str) -> None:
        client = self.clients.pop(client_id, None)
        if client is None:
            return
        if client_id in self.waiting:
            self.waiting.remove(client_id)
        partner_id = client["partner"]
        if partner_id and partner_id in self.clients:
            partner = self.clients[partner_id]
            partner["partner"] = None
            partner["events"].append({"type": "left"})

    def _remove_stale_clients(self) -> None:
        deadline = time.monotonic() - CLIENT_TIMEOUT
        stale_ids = [
            client_id
            for client_id, client in self.clients.items()
            if client["last_seen"] < deadline
        ]
        for client_id in stale_ids:
            self._remove_client(client_id)

    def _state(self, client_id: str) -> dict[str, object]:
        client = self.clients[client_id]
        partner_id = client["partner"]
        return {
            "state": "matched" if partner_id else "waiting",
            "partner": self.clients[partner_id]["name"] if partner_id else "",
            "events": client["events"],
        }

    def join(self) -> tuple[str, dict[str, object]]:
        client_id = secrets.token_hex(8)
        client = {"name": f"visitor-{secrets.token_hex(2)}", "partner": None, "events": [], "last_seen": time.monotonic()}
        with self.lock:
            self._remove_stale_clients()
            self.clients[client_id] = client
            self._match(client_id)
            payload = self._state(client_id)
            client["events"] = []
            return client_id, payload

    def _match(self, client_id: str) -> None:
        if client_id in self.waiting:
            self.waiting.remove(client_id)
        if self.clients[client_id]["partner"]:
            return
        self.waiting.append(client_id)
        if len(self.waiting) < 2:
            return
        first_id = self.waiting.pop(0)
        second_id = self.waiting.pop(0)
        first = self.clients[first_id]
        second = self.clients[second_id]
        first["partner"] = second_id
        second["partner"] = first_id
        first["events"].append({"type": "matched", "partner": second["name"]})
        second["events"].append({"type": "matched", "partner": first["name"]})

    def next_chat(self, client_id: str) -> dict[str, object]:
        with self.lock:
            self._remove_stale_clients()
            client = self.clients.get(client_id)
            if client is None:
                return {"state": "waiting", "partner": "", "events": []}
            client["last_seen"] = time.monotonic()
            partner_id = client["partner"]
            if partner_id:
                client["partner"] = None
                self.clients[partner_id]["partner"] = None
                self.clients[partner_id]["events"].append({"type": "left"})
            client["events"] = []
            self._match(client_id)
            payload = self._state(client_id)
            client["events"] = []
            return payload

    def poll(self, client_id: str) -> dict[str, object] | None:
        with self.lock:
            self._remove_stale_clients()
            if client_id not in self.clients:
                return None
            self.clients[client_id]["last_seen"] = time.monotonic()
            payload = self._state(client_id)
            self.clients[client_id]["events"] = []
            return payload

    def leave(self, client_id: str) -> None:
        with self.lock:
            self._remove_client(client_id)

    def send(self, client_id: str, text: str) -> bool:
        with self.lock:
            self._remove_stale_clients()
            client = self.clients.get(client_id)
            if not client or not text or not client["partner"]:
                return False
            client["last_seen"] = time.monotonic()
            partner = self.clients[client["partner"]]
            partner["events"].append({"type": "message", "from": client["name"], "text": text[:500]})
            return True
