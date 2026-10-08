"""PostgreSQL referential integrity. Skipped on SQLite (it cannot add constraints to existing tables)."""
import pytest

import db
from tests.test_api import client  # noqa: F401
from tests.test_auth import user_client, volunteer_client

pytestmark = pytest.mark.usefixtures("client")


@pytest.fixture(autouse=True)
def _pg_only():
    if db.BACKEND != "postgres":
        pytest.skip("PostgreSQL only")


def test_every_foreign_key_is_in_place():
    with db.session() as c:
        have = {r[0] for r in c.execute("SELECT conname FROM pg_constraint WHERE contype='f' AND connamespace = current_schema()::regnamespace").fetchall()}
    assert {f"fk_{t}_{col}" for t, col, _, _ in db.FOREIGN_KEYS} <= have


def test_a_row_pointing_at_nothing_is_refused():
    import psycopg
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with db.session() as c:
            c.execute("INSERT INTO matches(help_request_id, volunteer_id, status, created_at) VALUES(999999, 999999, 'MATCHED', ?)", (db.now(),))


def test_deleting_a_help_request_removes_its_matches_and_timeline_but_never_a_volunteer():
    v, vol = volunteer_client(_admin(), latitude=12.9716, longitude=77.5946)
    u = user_client()
    rid = u.post("/help-requests", json={"type": "MEDICINE", "latitude": 12.9716, "longitude": 77.5946}).json()["requestId"]
    with db.session() as c:
        assert c.execute("SELECT COUNT(*) FROM matches WHERE help_request_id=?", (rid,)).fetchone()[0] == 1
        c.execute("DELETE FROM help_requests WHERE id=?", (rid,))
        assert c.execute("SELECT COUNT(*) FROM matches WHERE help_request_id=?", (rid,)).fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM match_events WHERE help_request_id=?", (rid,)).fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM volunteers WHERE id=?", (vol["id"],)).fetchone()[0] == 1


def test_a_volunteer_with_matches_cannot_be_deleted_by_accident():
    import psycopg
    admin = _admin()
    v, vol = volunteer_client(admin, latitude=12.9716, longitude=77.5946)
    user_client().post("/help-requests", json={"type": "MEDICINE", "latitude": 12.9716, "longitude": 77.5946})
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with db.session() as c:
            c.execute("DELETE FROM volunteers WHERE id=?", (vol["id"],))


def test_deleting_a_user_signs_them_out_and_keeps_their_reports():
    u = user_client("gone@test.local")
    inc = u.post("/incidents", json={"type": "FLOOD", "latitude": 12.95, "longitude": 77.55}).json()["id"]
    with db.session() as c:
        uid = c.execute("SELECT id FROM users WHERE email='gone@test.local'").fetchone()[0]
        c.execute("DELETE FROM users WHERE id=?", (uid,))
        assert c.execute("SELECT COUNT(*) FROM sessions WHERE user_id=?", (uid,)).fetchone()[0] == 0     # cascade
        row = c.execute("SELECT user_id FROM incidents WHERE id=?", (inc,)).fetchone()
        assert row is not None and row[0] is None                                                          # the report stays, anonymised


def test_existing_orphans_are_reported_not_deleted(monkeypatch):
    """If bad rows already exist the constraint is skipped (with a warning) and the rows are untouched."""
    with db.session() as c:
        c.execute("ALTER TABLE sessions DROP CONSTRAINT fk_sessions_user_id")
        c.execute("INSERT INTO sessions(user_id, token_hash, created_at, expires_at) VALUES(888888, 'orphan-hash', ?, ?)", (db.now(), db.now()))
    with db.session() as c:
        db._add_foreign_keys(c)
        assert c.execute("SELECT COUNT(*) FROM sessions WHERE user_id=888888").fetchone()[0] == 1
        assert c.execute("SELECT 1 FROM pg_constraint WHERE conname='fk_sessions_user_id' AND connamespace = current_schema()::regnamespace").fetchone() is None
        c.execute("DELETE FROM sessions WHERE user_id=888888")
        db._add_foreign_keys(c)
        assert c.execute("SELECT 1 FROM pg_constraint WHERE conname='fk_sessions_user_id' AND connamespace = current_schema()::regnamespace").fetchone() is not None


def _admin():
    from fastapi.testclient import TestClient
    import main
    from tests.test_api import login_as, ADMIN
    c = TestClient(main.app)
    login_as(c, ADMIN)
    return c
