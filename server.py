"""HTTP server and API routes for Text Roulette."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from matchmaking import Matchmaking
from page import PAGE
from supabase_matchmaking import SupabaseMatchmaking


class ChatHandler(BaseHTTPRequestHandler):
    matchmaking = SupabaseMatchmaking.create() or Matchmaking()

    def send_json(self, payload: dict[str, object], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/poll":
            client_id = parse_qs(parsed.query).get("id", [""])[0]
            payload = self.matchmaking.poll(client_id)
            if payload is None:
                self.send_json({"error": "unknown client"}, 404)
                return
            self.send_json(payload)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            data = self.read_json()
            if parsed.path == "/api/join":
                client_id, payload = self.matchmaking.join()
                payload["clientId"] = client_id
                self.send_json(payload)
                return
            client_id = str(data.get("id", ""))
            if parsed.path == "/api/next":
                self.send_json(self.matchmaking.next_chat(client_id))
                return
            if parsed.path == "/api/leave":
                self.matchmaking.leave(client_id)
                self.send_json({"ok": True})
                return
            if parsed.path == "/api/send":
                text = str(data.get("text", "")).strip()
                if not self.matchmaking.send(client_id, text):
                    self.send_json({"error": "not ready"}, 400)
                    return
                self.send_json({"ok": True})
                return
            self.send_error(404)
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "invalid request"}, 400)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[server] {format % args}")


def create_server(host: str, port: int) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), ChatHandler)
