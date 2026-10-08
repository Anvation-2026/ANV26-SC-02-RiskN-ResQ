"""Tiny .env loader (no extra dependency). Real environment variables always win.
Keep secrets such as ADMIN_PASSWORD in backend/.env (git-ignored) or in the shell, never in code."""
import os
from pathlib import Path


def load_env(path: Path = Path(__file__).parent / ".env") -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()
