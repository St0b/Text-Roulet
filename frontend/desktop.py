"""GreenOS shell. Browser code lives in independently served modules."""
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent
STATIC = FRONTEND / "static"
PAGE = (FRONTEND / "index.html").read_text(encoding="utf-8")
