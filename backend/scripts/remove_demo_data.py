"""Remove sample (demo) data from the database so only real data remains. Safe to run more than once.

    cd backend && python scripts/remove_demo_data.py

Deletes: the sample volunteer roster (volunteers without a login account, and anything linked to them) and the sample
incident. Real accounts, volunteers created by an admin, reports and requests are never touched."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db  # noqa: E402

DEMO_INCIDENT_TEXTS = ("Water logging near market", "[DEMO] Water logging near market")


def main() -> None:
    with db.session() as c:
        demo_vols = [r["id"] for r in c.execute("SELECT id FROM volunteers WHERE user_id IS NULL").fetchall()]
        for vid in demo_vols:
            for m in c.execute("SELECT id, help_request_id FROM matches WHERE volunteer_id=?", (vid,)).fetchall():
                c.execute("UPDATE help_requests SET status='OPEN' WHERE id=? AND status='MATCHED'", (m["help_request_id"],))
                c.execute("DELETE FROM matches WHERE id=?", (m["id"],))
            c.execute("DELETE FROM volunteers WHERE id=?", (vid,))
        n_inc = 0
        for text in DEMO_INCIDENT_TEXTS:
            n_inc += c.execute("DELETE FROM incidents WHERE description=? AND user_id IS NULL", (text,)).rowcount
    print(f"Removed {len(demo_vols)} sample volunteer(s) and {n_inc} sample incident(s).")


if __name__ == "__main__":
    main()
