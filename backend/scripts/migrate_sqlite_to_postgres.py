"""One-time copy of an existing SQLite database into PostgreSQL.

    cd backend
    DATABASE_URL=postgresql://user@localhost:5432/risknresq python scripts/migrate_sqlite_to_postgres.py [path/to/resilienturban.db]

Creates the tables in PostgreSQL, EMPTIES them, copies every row (ids preserved), then fixes the id counters.
Run it once, against an empty or disposable PostgreSQL database."""
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db  # noqa: E402

TABLES = ["users", "sessions", "login_failures", "incidents", "roads", "alerts", "help_requests",
          "volunteers", "matches", "environment_data", "risk_snapshots"]


def main() -> None:
    if db.BACKEND != "postgres":
        sys.exit("DATABASE_URL must point at PostgreSQL (postgresql://user@host:5432/dbname).")
    src_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "resilienturban.db"
    if not src_path.is_file():
        sys.exit(f"SQLite file not found: {src_path}")

    src = sqlite3.connect(src_path)
    src.row_factory = sqlite3.Row
    db.init_db()  # create tables (and the demo seed, which is cleared below)
    with db.session() as dst:
        dst.execute("TRUNCATE " + ", ".join(TABLES) + " RESTART IDENTITY")
        for table in TABLES:
            exists = src.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
            if not exists:
                print(f"{table}: not in the SQLite file, skipped")
                continue
            rows = src.execute(f"SELECT * FROM {table}").fetchall()
            if rows:
                have = db._columns(dst, table)
                cols = [c for c in rows[0].keys() if c in have]
                sql = f"INSERT INTO {table}({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
                for r in rows:
                    dst.execute(sql.replace(" RETURNING id", ""), tuple(r[c] for c in cols))
            if "id" in db._columns(dst, table):
                dst.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE((SELECT MAX(id) FROM {table}), 1), (SELECT MAX(id) FROM {table}) IS NOT NULL)")
            print(f"{table}: {len(rows)} rows copied")
    print("Done. PostgreSQL is now the database in use when DATABASE_URL points at it.")


if __name__ == "__main__":
    main()
