"""Regression tests for both serving entry points and the retained chat API."""
from __future__ import annotations

import importlib.util
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from matchmaking import Matchmaking
from server import ChatHandler


class IsolatedHandler(ChatHandler):
    matchmaking = Matchmaking()

    def log_message(self, *_args: object) -> None:
        pass


class LocalServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), IsolatedHandler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join(timeout=5)

    def request(self, path: str, body: dict | None = None):
        req = urllib.request.Request(self.url + path, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        return urllib.request.urlopen(req, timeout=5)

    def test_shell_and_wasm_are_served(self) -> None:
        with self.request("/") as response:
            self.assertIn('lang="ru"', response.read().decode())
        with self.request("/assets/main.js") as response:
            self.assertIn("javascript", response.headers["Content-Type"])
        with self.request("/assets/vendor/v86/v86.wasm") as response:
            self.assertEqual(response.headers["Content-Type"], "application/wasm")
            self.assertEqual(response.read(4), b"\0asm")

    def test_assets_cannot_escape_static_root(self) -> None:
        for path in ["/assets/%2e%2e/desktop.py", "/assets/%2e%2e/%2e%2e/.env.example", "/assets/missing.js"]:
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError) as result:
                self.request(path)
            self.assertEqual(result.exception.code, 404)
            result.exception.close()

    def test_two_clients_can_exchange_and_leave(self) -> None:
        first = json.load(self.request("/api/join", {}))
        second = json.load(self.request("/api/join", {}))
        try:
            self.assertEqual(second["state"], "matched")
            self.request("/api/send", {"id": first["clientId"], "text": "GreenOS regression message"}).close()
            result = json.load(self.request("/api/poll?id=" + second["clientId"]))
            self.assertTrue(any(e.get("text") == "GreenOS regression message" for e in result["events"]))
            self.request("/api/leave", {"id": first["clientId"]}).close()
            result = json.load(self.request("/api/poll?id=" + second["clientId"]))
            self.assertEqual(result["state"], "waiting")
            self.assertTrue(any(e["type"] == "left" for e in result["events"]))
        finally:
            self.request("/api/leave", {"id": second["clientId"]}).close()


@unittest.skipUnless(importlib.util.find_spec("flask"), "Flask is optional for the local server")
class FlaskServerTests(unittest.TestCase):
    def test_vercel_serves_shell_assets_and_protects_paths(self) -> None:
        from api.index import app
        client = app.test_client()
        self.assertEqual(client.get("/").status_code, 200)
        with client.get("/assets/main.js") as response:
            self.assertEqual(response.status_code, 200)
        with client.get("/assets/vendor/v86/v86.wasm") as response:
            self.assertEqual(response.mimetype, "application/wasm")
        self.assertEqual(client.get("/assets/../../.env.example").status_code, 404)


if __name__ == "__main__":
    unittest.main()
