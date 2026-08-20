"""Application entry point for Text Roulette."""

from __future__ import annotations

import webbrowser

from server import create_server


HOST = "127.0.0.1"
PORT = 8000


def run() -> None:
    server = create_server(HOST, PORT)
    url = f"http://{HOST}:{PORT}"
    print(f"Text Roulette запущен: {url}")
    print("Для остановки нажмите Ctrl+C")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
