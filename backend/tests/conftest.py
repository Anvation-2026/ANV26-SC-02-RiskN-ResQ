"""Every test runs on its own empty database, so tests can never touch real data.

Default: a throw-away SQLite file.
PostgreSQL run:  RISKNRESQ_TEST_BACKEND=postgres DATABASE_URL=postgresql://user@localhost/risknresq_test pytest
(each test gets its own temporary schema, dropped afterwards)."""
import os
import uuid

import pytest

os.environ.setdefault("RATE_LIMIT_ENABLED", "0")
os.environ.setdefault("INTEL_ENABLED", "0")
os.environ.setdefault("WEATHER_MONITOR_ENABLED", "0")  # no background polling of the real weather API in tests

import db
import notify

USE_POSTGRES = os.environ.get("RISKNRESQ_TEST_BACKEND") == "postgres"


class Outbox:
    """Captures every outgoing push / SMS / email so tests can assert on them without touching the network."""
    def __init__(self):
        self.posts, self.emails = [], []


@pytest.fixture(autouse=True)
def outbox(monkeypatch):
    box = Outbox()

    class Resp:
        def raise_for_status(self):
            pass

    def fake_post(url, **kw):
        box.posts.append({"url": url, **kw})
        return Resp()

    notify._last_sent.clear()
    monkeypatch.setattr(notify, "INLINE", True)
    monkeypatch.setattr(notify, "_post", fake_post)
    monkeypatch.setattr(notify, "_send_email", lambda to, subject, body: box.emails.append({"to": to, "subject": subject, "body": body}))
    return box


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "DEMO_DATA", True)  # most tests exercise the sample roster; real mode is tested explicitly
    if USE_POSTGRES:
        schema = "t_" + uuid.uuid4().hex[:12]
        db.create_schema(schema)
        monkeypatch.setattr(db, "BACKEND", "postgres")
        monkeypatch.setattr(db, "_PG_SCHEMA", schema)
        try:
            yield
        finally:
            db.drop_schema(schema)
    else:
        monkeypatch.setattr(db, "BACKEND", "sqlite")
        monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
        yield
