"""Every test runs on its own empty database, so tests can never touch real data.

Default: a throw-away SQLite file.
PostgreSQL run:  RISKNRESQ_TEST_BACKEND=postgres DATABASE_URL=postgresql://user@localhost/risknresq_test pytest
(each test gets its own temporary schema, dropped afterwards)."""
import os
import uuid

import pytest

import db

USE_POSTGRES = os.environ.get("RISKNRESQ_TEST_BACKEND") == "postgres"


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch, tmp_path):
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
