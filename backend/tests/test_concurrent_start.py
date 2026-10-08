"""Several processes starting at once on an empty PostgreSQL database (a rolling deploy, several workers) must not crash on
CREATE SCHEMA / CREATE TABLE races. Skipped when the configured database is not PostgreSQL."""
import os
import subprocess
import sys
import uuid

import pytest

import config

pytestmark = pytest.mark.skipif(not config.DATABASE_URL.startswith("postgres"), reason="PostgreSQL only")


def test_six_simultaneous_first_starts_all_succeed():
    import db
    name = "race_" + uuid.uuid4().hex[:8]
    env = {**os.environ, "DB_SCHEMA": name}
    code = "import db; db.init_db(reset=False); print('ok')"
    try:
        procs = [subprocess.Popen([sys.executable, "-c", code], env=env, cwd=os.path.dirname(os.path.dirname(__file__)),
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(6)]
        results = [(p.wait(), p.stderr.read()[-300:]) for p in procs]
        assert [r[0] for r in results] == [0] * 6, results
    finally:
        db.drop_schema(name)
