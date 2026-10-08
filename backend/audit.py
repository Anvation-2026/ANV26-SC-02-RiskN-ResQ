"""Append-only record of admin actions (who did what, when)."""
import db


def record(c, actor: dict | None, action: str, target: str = "", detail: str = "") -> None:
    c.execute("INSERT INTO audit_log(at, actor_id, actor, action, target, detail) VALUES(?,?,?,?,?,?)",
              (db.now(), actor["id"] if actor else None, (actor or {}).get("email") or (actor or {}).get("name") or "system",
               action, str(target)[:120], str(detail)[:500]))
