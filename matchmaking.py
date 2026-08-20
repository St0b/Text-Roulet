"""In-memory matchmaking for anonymous browser clients."""

from __future__ import annotations

import secrets
import threading


class Matchmaking:
    def __init__(self) -> None:
        self.clients: dict[str, dict[str, object]] = {}
        self.waiting: list[str] = []
        self.lock = threading.Lock()

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
        client = {"name": f"visitor-{secrets.token_hex(2)}", "partner": None, "events": []}
        with self.lock:
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
            client = self.clients.get(client_id)
            if client is None:
                return {"state": "waiting", "partner": "", "events": []}
            partner_id = client["partner"]
            if partner_id:
                client["partner"] = None
                self.clients[partner_id]["partner"] = None
                self.clients[partner_id]["events"].append({"type": "left"})
            self._match(client_id)
            payload = self._state(client_id)
            client["events"] = []
            return payload

    def poll(self, client_id: str) -> dict[str, object] | None:
        with self.lock:
            if client_id not in self.clients:
                return None
            payload = self._state(client_id)
            self.clients[client_id]["events"] = []
            return payload

    def send(self, client_id: str, text: str) -> bool:
        with self.lock:
            client = self.clients.get(client_id)
            if not client or not text or not client["partner"]:
                return False
            partner = self.clients[client["partner"]]
            partner["events"].append({"type": "message", "from": client["name"], "text": text[:500]})
            return True
