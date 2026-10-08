"""Reports rows that point at something that no longer exists. PostgreSQL enforces most of these with foreign keys; this check also
covers SQLite (which has none) and anything that predates the constraints. Read-only unless you pass the flag below.
    python scripts/integrity_check.py
    python scripts/integrity_check.py --delete-orphan-credentials
        also deletes ONLY orphaned sessions, push tokens and one-time codes (disposable credentials of accounts that no longer exist)
Exit status 1 when anything is orphaned."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db  # noqa: E402

CHECKS = [
    ("sessions without a user", "SELECT COUNT(*) FROM sessions s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL"),
    ("one-time codes without a user", "SELECT COUNT(*) FROM auth_tokens a LEFT JOIN users u ON u.id=a.user_id WHERE u.id IS NULL"),
    ("push tokens without a user", "SELECT COUNT(*) FROM push_tokens p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL"),
    ("volunteers whose login user is missing", "SELECT COUNT(*) FROM volunteers v LEFT JOIN users u ON u.id=v.user_id WHERE v.user_id IS NOT NULL AND u.id IS NULL"),
    ("incidents whose reporter is missing", "SELECT COUNT(*) FROM incidents i LEFT JOIN users u ON u.id=i.user_id WHERE i.user_id IS NOT NULL AND u.id IS NULL"),
    ("duplicate reports pointing at a missing report", "SELECT COUNT(*) FROM incidents i LEFT JOIN incidents p ON p.id=i.duplicate_of WHERE i.duplicate_of IS NOT NULL AND p.id IS NULL"),
    ("help requests whose requester is missing", "SELECT COUNT(*) FROM help_requests h LEFT JOIN users u ON u.id=h.user_id WHERE h.user_id IS NOT NULL AND u.id IS NULL"),
    ("matches without a help request", "SELECT COUNT(*) FROM matches m LEFT JOIN help_requests h ON h.id=m.help_request_id WHERE h.id IS NULL"),
    ("matches without a volunteer", "SELECT COUNT(*) FROM matches m LEFT JOIN volunteers v ON v.id=m.volunteer_id WHERE v.id IS NULL"),
    ("timeline events without a help request", "SELECT COUNT(*) FROM match_events e LEFT JOIN help_requests h ON h.id=e.help_request_id WHERE h.id IS NULL"),
    ("more than one live match on a help request", "SELECT COUNT(*) FROM (SELECT help_request_id FROM matches WHERE status IN ('PROPOSED','MATCHED','ACCEPTED') GROUP BY help_request_id HAVING COUNT(*) > 1) x"),
    ("two accounts with the same email", "SELECT COUNT(*) FROM (SELECT LOWER(email) e FROM users WHERE email IS NOT NULL GROUP BY LOWER(email) HAVING COUNT(*) > 1) x"),
]


def run() -> list:
    bad = []
    with db.session() as c:
        for name, sql in CHECKS:
            n = c.execute(sql).fetchone()[0]
            print(("OK    " if n == 0 else "FOUND ") + f"{name}: {n}")
            if n:
                bad.append((name, n))
    return bad


def delete_orphan_credentials() -> int:
    n = 0
    with db.session() as c:
        for table in ("sessions", "push_tokens", "auth_tokens"):
            n += c.execute(f"DELETE FROM {table} WHERE user_id NOT IN (SELECT id FROM users)").rowcount or 0
    return n


if __name__ == "__main__":
    if "--delete-orphan-credentials" in sys.argv:
        print(f"Deleted {delete_orphan_credentials()} orphaned credential row(s) (sessions, push tokens, one-time codes).")
    sys.exit(1 if run() else 0)
