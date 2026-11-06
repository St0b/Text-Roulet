"""Download the locally served v86 runtime and Linux images (no npm required)."""
from __future__ import annotations

import concurrent.futures
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / "frontend" / "static"
SOURCES = {
    "vendor/v86/libv86.js": "https://copy.sh/v86/build/libv86.js",
    "vendor/v86/v86.wasm": "https://copy.sh/v86/build/v86.wasm",
    "vendor/v86/seabios.bin": "https://copy.sh/v86/bios/seabios.bin",
    "vendor/v86/vgabios.bin": "https://copy.sh/v86/bios/vgabios.bin",
    "vendor/v86/LICENSE": "https://raw.githubusercontent.com/copy/v86/master/LICENSE",
    "vendor/xterm/xterm.js": "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js",
    "vendor/xterm/xterm.css": "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css",
    "vendor/xterm/addon-fit.js": "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js",
    "vendor/xterm/LICENSE": "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/LICENSE",
    "images/buildroot-linux.bin": "https://i.copy.sh/buildroot-bzimage68.bin",
    "images/tinycore.iso": "https://i.copy.sh/TinyCore-11.0.iso",
}


def download(item: tuple[str, str]) -> tuple[str, dict, bytes]:
    name, url = item
    data = urllib.request.urlopen(url, timeout=90).read()
    print(f"{name}: {len(data):,} bytes", flush=True)
    return name, {"url": url, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}, data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Accept new upstream runtime hashes; old VM snapshots may become incompatible")
    args = parser.parse_args()
    lock_path = ROOT / "runtime-lock.json"
    expected = json.loads(lock_path.read_text(encoding="utf-8")) if lock_path.exists() else {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(download, SOURCES.items()))
    # Verify the whole runtime before replacing any files. A failed download or
    # changed upstream build must not leave a mixed JS/WASM runtime behind.
    if not args.refresh:
        for name, metadata, _ in results:
            if name in expected and metadata["sha256"] != expected[name]["sha256"]:
                raise SystemExit(f"Upstream changed {name}. Nothing replaced. Use --refresh for an intentional runtime upgrade.")
    for name, _, data in results:
        target = ROOT / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    lock_path.write_text(json.dumps({name:meta for name,meta,_ in results}, indent=2) + "\n", encoding="utf-8")
