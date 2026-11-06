"""GreenOS local application entry point."""

from __future__ import annotations

import webbrowser
import argparse

from server import create_server


HOST = "127.0.0.1"
PORT = 8000


def run() -> None:
    parser = argparse.ArgumentParser(description="GreenOS browser Linux desktop")
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    server = create_server(args.host, args.port)
    url = f"http://{args.host}:{args.port}"
    print(f"GreenOS запущена: {url}", flush=True)
    print("Для остановки нажмите Ctrl+C")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
