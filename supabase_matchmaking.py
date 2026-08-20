"""Supabase-backed matchmaking adapter."""

from __future__ import annotations

import secrets
from typing import Any

from supabase_client import get_supabase_client


class SupabaseMatchmaking:
    def __init__(self, client: Any) -> None:
        self.client = client

    @classmethod
    def create(cls) -> "SupabaseMatchmaking | None":
        client = get_supabase_client()
        return cls(client) if client is not None else None

    def _rpc(self, name: str, params: dict[str, object]) -> dict[str, object]:
        result = self.client.rpc(name, params).execute()
        data = result.data
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    def join(self) -> tuple[str, dict[str, object]]:
        client_id = secrets.token_hex(8)
        display_name = f"visitor-{secrets.token_hex(2)}"
        payload = self._rpc("join_chat", {"p_client_id": client_id, "p_display_name": display_name})
        payload["clientId"] = client_id
        return client_id, payload

    def poll(self, client_id: str) -> dict[str, object] | None:
        payload = self._rpc("poll_chat", {"p_client_id": client_id})
        return payload or None

    def next_chat(self, client_id: str) -> dict[str, object]:
        return self._rpc("next_chat", {"p_client_id": client_id})

    def leave(self, client_id: str) -> None:
        self._rpc("leave_chat", {"p_client_id": client_id})

    def send(self, client_id: str, text: str) -> bool:
        payload = self._rpc("send_chat_message", {"p_client_id": client_id, "p_text": text[:500]})
        return bool(payload.get("ok"))
