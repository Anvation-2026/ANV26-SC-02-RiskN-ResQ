"""Clear leftover test data from the live database: resets incidents, alerts, help requests, matches and simulated rainfall
(users, sessions and volunteers are kept), and optionally deletes throw-away test accounts.

    python scripts/clean_test_data.py                       # reset only
    python scripts/clean_test_data.py --delete-test-users   # also delete accounts whose email ends in @test.local
    python scripts/clean_test_data.py --enable-volunteer someone@example.com
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--delete-test-users", action="store_true")
    ap.add_argument("--enable-volunteer", metavar="EMAIL")
    args = ap.parse_args()
    db.init_db(reset=False)
    db.reset_db()
    print("Reset incidents, alerts, help requests, matches, roads and rainfall to a clean state.")
    with db.session() as c:
        if args.delete_test_users:
            ids = [r["id"] for r in c.execute("SELECT id FROM users WHERE LOWER(email) LIKE '%@test.local'").fetchall()]
            for i in ids:
                c.execute("DELETE FROM sessions WHERE user_id=?", (i,))
                c.execute("DELETE FROM push_tokens WHERE user_id=?", (i,))
                c.execute("DELETE FROM auth_tokens WHERE user_id=?", (i,))
                c.execute("DELETE FROM users WHERE id=?", (i,))
            print(f"Deleted {len(ids)} test account(s).")
        if args.enable_volunteer:
            u = c.execute("SELECT id FROM users WHERE LOWER(email)=?", (args.enable_volunteer.lower(),)).fetchone()
            if not u:
                print("No such account.")
            else:
                c.execute("UPDATE users SET is_active=1 WHERE id=?", (u["id"],))
                c.execute("UPDATE volunteers SET status='ACTIVE' WHERE user_id=?", (u["id"],))
                print("Volunteer account enabled.")


if __name__ == "__main__":
    main()
