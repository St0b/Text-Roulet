"""Vercel serverless entry point for Text Roulette."""

from __future__ import annotations

import sys
from pathlib import Path

from flask import Flask, Response, jsonify, request

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from matchmaking import Matchmaking  # noqa: E402
from page import PAGE  # noqa: E402


app = Flask(__name__)
matchmaking = Matchmaking()


@app.get("/")
def home() -> Response:
    return Response(PAGE, mimetype="text/html")


@app.post("/api/join")
def join() -> Response:
    client_id, payload = matchmaking.join()
    payload["clientId"] = client_id
    return jsonify(payload)


@app.get("/api/poll")
def poll() -> Response:
    client_id = request.args.get("id", "")
    payload = matchmaking.poll(client_id)
    if payload is None:
        return jsonify({"error": "unknown client"}), 404
    return jsonify(payload)


@app.post("/api/next")
def next_chat() -> Response:
    data = request.get_json(silent=True) or {}
    return jsonify(matchmaking.next_chat(str(data.get("id", ""))))


@app.post("/api/leave")
def leave() -> Response:
    data = request.get_json(silent=True) or {}
    matchmaking.leave(str(data.get("id", "")))
    return jsonify({"ok": True})


@app.post("/api/send")
def send() -> Response:
    data = request.get_json(silent=True) or {}
    client_id = str(data.get("id", ""))
    text = str(data.get("text", "")).strip()
    if not matchmaking.send(client_id, text):
        return jsonify({"error": "not ready"}), 400
    return jsonify({"ok": True})
