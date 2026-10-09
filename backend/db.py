import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from config import DATABASE_URL

try:  # PostgreSQL driver (psycopg 3). Only needed when DATABASE_URL points at PostgreSQL.
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None

# The database engine is chosen by DATABASE_URL: postgresql://... uses PostgreSQL, anything else uses a SQLite file.
BACKEND = "postgres" if DATABASE_URL.lower().startswith(("postgres://", "postgresql://")) else "sqlite"
_PG_SCHEMA = os.environ.get("DB_SCHEMA") or None  # run inside an isolated PostgreSQL schema (tests, staging, end-to-end runs)

# DEMO DATA is opt-in. By default the database holds only real data (accounts, reports, requests) plus the
# reference data the system needs (the road network and zone baselines). Set DEMO_DATA=true to also seed a sample
# volunteer roster and a sample incident for presentations; they are marked as demo entries.
DEMO_DATA = os.environ.get("DEMO_DATA", "").strip().lower() in ("1", "true", "yes", "on")

# Every database error type the API should answer with a clean JSON 500.
DB_ERRORS = (sqlite3.Error,) + ((psycopg.Error,) if psycopg else ())

# Path resolution: allow RISKNRESQ_DB override (for test suites), fallback to DATABASE_URL or default
DB_PATH = Path(os.environ.get("RISKNRESQ_DB", Path(__file__).parent / "resilienturban.db"))
if not os.environ.get("RISKNRESQ_DB") and DATABASE_URL.startswith("sqlite:///"):
    path_part = DATABASE_URL.replace("sqlite:///", "")
    DB_PATH = Path(__file__).parent / path_part if not Path(path_part).is_absolute() else Path(path_part)

# Cleared by reset_db(). Accounts (users, sessions) and the volunteer roster survive.
STATE_TABLES = ("incidents", "roads", "alerts", "help_requests", "matches", "match_events", "environment_data")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    latitude REAL,
    longitude REAL,
    email TEXT,
    password_hash TEXT,
    phone TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);

CREATE TABLE IF NOT EXISTS push_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    platform TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor_id INTEGER,
    actor TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT
);

CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    phone TEXT,
    address TEXT,
    source TEXT NOT NULL DEFAULT 'ADMIN',
    external_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    help_request_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    detail TEXT,
    at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weather_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    monitored INTEGER NOT NULL,
    heavy INTEGER NOT NULL,
    max_mm REAL NOT NULL,
    avg_mm REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_status (
    name TEXT PRIMARY KEY,
    last_attempt TEXT,
    last_success TEXT,
    last_error TEXT,
    detail TEXT
);

CREATE TABLE IF NOT EXISTS satellite_scenes (
    scene_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    collection TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    orbit_state TEXT,
    relative_orbit INTEGER,
    cloud_cover REAL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS water_extent_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id TEXT NOT NULL,
    cell TEXT NOT NULL,
    water_fraction REAL NOT NULL,
    water_area_km2 REAL NOT NULL,
    cell_area_km2 REAL NOT NULL,
    valid_pixels INTEGER,
    method TEXT NOT NULL,
    threshold TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_water_extent_scene ON water_extent_observations(scene_id, cell);

CREATE TABLE IF NOT EXISTS flood_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    engine TEXT,
    bbox TEXT NOT NULL,
    params TEXT,
    requested_by INTEGER,
    triggered_by TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    after_scene TEXT,
    acquired_at TEXT,
    baseline_dates TEXT,
    flooded_km2 REAL,
    analysed_km2 REAL,
    polygons TEXT,
    quality TEXT,
    warnings TEXT,
    method TEXT,
    source TEXT,
    tile_url TEXT,
    error TEXT
);
CREATE INDEX IF NOT EXISTS ix_flood_analyses_status ON flood_analyses(status, acquired_at);

CREATE TABLE IF NOT EXISTS satellite_observations (
    cell TEXT PRIMARY KEY,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    scene_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    method TEXT NOT NULL,
    water_area_km2 REAL NOT NULL,
    baseline_water_area_km2 REAL,
    expansion_area_km2 REAL,
    expansion_percentage REAL,
    abnormal INTEGER NOT NULL DEFAULT 0,
    confidence TEXT,
    baseline_scenes INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terrain_data (
    cell TEXT PRIMARY KEY,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    elevation_m REAL,
    slope_deg REAL,
    relative_elevation_pct REAL,
    concavity_m REAL,
    susceptibility REAL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS water_level_observations (
    cell TEXT PRIMARY KEY,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    kind TEXT NOT NULL,
    current_value REAL,
    normal_value REAL,
    max_value REAL,
    ratio REAL,
    unit TEXT,
    status TEXT,
    observed_on TEXT,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS climatology (
    cell TEXT PRIMARY KEY,
    p95_mm REAL,
    p99_mm REAL,
    max_mm REAL,
    years INTEGER,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS historical_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    event_date TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'FLOOD',
    rainfall_mm REAL,
    water_extent_km2 REAL,
    severity INTEGER,
    source TEXT NOT NULL,
    notes TEXT,
    external_id TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_historical_events_date ON historical_events(event_date);

CREATE TABLE IF NOT EXISTS flood_risk_predictions (
    cell TEXT PRIMARY KEY,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    zone TEXT,
    risk_score INTEGER,
    risk_level TEXT,
    probability REAL,
    probability_basis TEXT,
    insufficient INTEGER NOT NULL DEFAULT 0,
    signals TEXT,
    missing TEXT,
    features TEXT,
    model TEXT,
    computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flood_hotspots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cell TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    radius_km REAL NOT NULL,
    zone TEXT,
    risk_score INTEGER NOT NULL,
    risk_level TEXT NOT NULL,
    signals TEXT,
    sources TEXT,
    confidence TEXT,
    status TEXT NOT NULL DEFAULT 'POTENTIAL',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_flood_hotspots_active ON flood_hotspots(active, cell);

CREATE TABLE IF NOT EXISTS risk_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    zone TEXT NOT NULL,
    rainfall_24h REAL,
    risk_score INTEGER,
    risk_level TEXT,
    probability REAL,
    satellite_expansion_pct REAL,
    active_alerts INTEGER NOT NULL DEFAULT 0,
    features TEXT,
    source TEXT
);
CREATE INDEX IF NOT EXISTS ix_risk_history_zone_at ON risk_history(zone, at);

CREATE TABLE IF NOT EXISTS login_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_login_failures_email ON login_failures(email);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    radius_meters REAL NOT NULL DEFAULT 50.0,
    description TEXT DEFAULT '',
    severity INTEGER NOT NULL DEFAULT 3,
    trust_score INTEGER NOT NULL DEFAULT 50,
    status TEXT NOT NULL DEFAULT 'REPORTED',
    reported_by TEXT,
    photo_url TEXT,
    photo_file TEXT,
    zone TEXT,
    user_id INTEGER,
    timestamp TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    coordinates TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE'
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    affected_zone TEXT DEFAULT '',
    latitude REAL,
    longitude REAL,
    active INTEGER NOT NULL DEFAULT 1,
    source TEXT DEFAULT 'ENGINE',
    created_at TEXT NOT NULL,
    reason TEXT,
    affected_road TEXT,
    risk_score INTEGER,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS help_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'MEDIUM',
    latitude REAL,
    longitude REAL,
    destination_lat REAL,
    destination_lng REAL,
    phone TEXT,
    notes TEXT,
    description TEXT,
    photo_url TEXT,
    assigned_volunteer_id INTEGER,
    cancellation_reason TEXT,
    is_manual_location INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS volunteers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    skill TEXT NOT NULL,
    resources TEXT DEFAULT '[]',
    phone TEXT,
    latitude REAL,
    longitude REAL,
    available INTEGER NOT NULL DEFAULT 1,
    responder_mode INTEGER NOT NULL DEFAULT 0,
    last_location_update TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    verified INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    help_request_id INTEGER NOT NULL,
    volunteer_id INTEGER NOT NULL,
    distance_km REAL DEFAULT 0.0,
    eta_minutes INTEGER DEFAULT 0,
    match_score INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PROPOSED',
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS environment_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone TEXT NOT NULL UNIQUE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    rainfall REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    data_source TEXT NOT NULL DEFAULT 'DEMO_SEED'
);

CREATE TABLE IF NOT EXISTS risk_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    risk_score INTEGER NOT NULL,
    risk_level TEXT NOT NULL,
    weather_source TEXT NOT NULL,
    rainfall_24h_mm REAL NOT NULL,
    rainfall_intensity_mm_per_hour REAL NOT NULL,
    warning_level TEXT NOT NULL,
    reason TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    computed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_help_requests_status ON help_requests(status);
CREATE INDEX IF NOT EXISTS ix_help_requests_user_id ON help_requests(user_id);
CREATE INDEX IF NOT EXISTS ix_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS ix_volunteers_available ON volunteers(available);
CREATE INDEX IF NOT EXISTS ix_matches_help_request_id ON matches(help_request_id);
CREATE INDEX IF NOT EXISTS ix_matches_volunteer_id ON matches(volunteer_id);
"""

# Indexes for the columns the API filters and joins on. Created after the column migrations (some columns are added there), and at
# every start, so existing databases get them too.
INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_incidents_status_ts ON incidents(status, timestamp)",
    "CREATE INDEX IF NOT EXISTS ix_incidents_zone ON incidents(zone)",
    "CREATE INDEX IF NOT EXISTS ix_incidents_user ON incidents(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_incidents_dup ON incidents(duplicate_of)",
    "CREATE INDEX IF NOT EXISTS ix_help_requests_user ON help_requests(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_help_requests_status ON help_requests(status)",
    "CREATE INDEX IF NOT EXISTS ix_matches_request ON matches(help_request_id)",
    "CREATE INDEX IF NOT EXISTS ix_matches_volunteer ON matches(volunteer_id, status)",
    "CREATE INDEX IF NOT EXISTS ix_match_events_request ON match_events(help_request_id)",
    "CREATE INDEX IF NOT EXISTS ix_alerts_active_zone ON alerts(active, affected_zone)",
    "CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_volunteers_user ON volunteers(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_audit_log_at ON audit_log(at)",
    "CREATE INDEX IF NOT EXISTS ix_places_kind ON places(kind)",
    "CREATE INDEX IF NOT EXISTS ix_hotspots_zone ON flood_hotspots(zone)",
]

# Columns added after the first release: older database files are upgraded in place.
MIGRATIONS = {
    "users": [
        ("email", "TEXT"),
        ("password_hash", "TEXT"),
        ("phone", "TEXT"),
        ("created_at", "TEXT"),
        ("is_active", "INTEGER NOT NULL DEFAULT 1"),
        ("email_verified", "INTEGER NOT NULL DEFAULT 0"),
        ("notify_sms", "INTEGER NOT NULL DEFAULT 0"),
        ("language", "TEXT"),
        ("last_seen", "TEXT"),
    ],
    "volunteers": [
        ("quantities", "TEXT"),
        ("user_id", "INTEGER"),
        ("status", "TEXT NOT NULL DEFAULT 'ACTIVE'"),
        ("resources", "TEXT DEFAULT '[]'"),
    ],
    "incidents": [
        ("photo_file", "TEXT"),
        ("user_id", "INTEGER"),
        ("zone", "TEXT"),
        ("radius_meters", "REAL NOT NULL DEFAULT 50.0"),
        ("confirmations", "INTEGER NOT NULL DEFAULT 0"),
        ("duplicate_of", "INTEGER"),
    ],
    "alerts": [
        ("sources", "TEXT"),
        ("action", "TEXT"),
        ("probability", "REAL"),
        ("reason", "TEXT"),
        ("affected_road", "TEXT"),
        ("risk_score", "INTEGER"),
        ("source", "TEXT NOT NULL DEFAULT 'ENGINE'"),
        ("updated_at", "TEXT"),
    ],
    "environment_data": [
        ("data_source", "TEXT NOT NULL DEFAULT 'DEMO_SEED'"),
        # weather monitoring grid cells share this table (zone = 'grid:<lat>,<lng>'): one row per cell, updated in place
        ("rain_level", "TEXT"),
        ("rainfall_24h", "REAL"),
        ("prev_rainfall", "REAL"),
        ("prev_at", "TEXT"),
        ("observed_at", "TEXT"),
        ("weather_code", "INTEGER"),
        ("elevation", "REAL"),
        ("forecast_peak_mm", "REAL"),
        ("forecast_peak_in_h", "INTEGER"),
        ("terrain_bonus", "REAL NOT NULL DEFAULT 0"),
        ("rain_1h", "REAL"),
        ("rain_3h", "REAL"),
        ("rain_6h", "REAL"),
        ("forecast_3h_mm", "REAL"),
        ("forecast_6h_mm", "REAL"),
    ],
    "roads": [
        ("source", "TEXT NOT NULL DEFAULT 'SEED'"),
        ("elevation", "REAL"),
        ("low_lying", "INTEGER NOT NULL DEFAULT 0"),
    ],
    "help_requests": [
        ("quantity", "INTEGER NOT NULL DEFAULT 1"),
        ("destination_lat", "REAL"),
        ("destination_lng", "REAL"),
        ("phone", "TEXT"),
        ("notes", "TEXT"),
        ("description", "TEXT"),
        ("photo_url", "TEXT"),
        ("assigned_volunteer_id", "INTEGER"),
        ("cancellation_reason", "TEXT"),
        ("is_manual_location", "INTEGER NOT NULL DEFAULT 0"),
        ("updated_at", "TEXT"),
    ],
    "matches": [
        ("notes", "TEXT"),
    ],
}

# Zone centres (Bengaluru demo coordinates). Incidents are assigned to the nearest zone.
ZONES = {
    "Zone A": (12.9716, 77.5946),
    "Zone B": (12.9352, 77.6245),
    "Zone C": (13.0358, 77.5970),
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def now_iso() -> str:
    return now()


# ---------------------------------------------------------------------------------------------
# PostgreSQL support. The application's SQL is written once (SQLite style, "?" placeholders); this thin layer
# presents a PostgreSQL connection with the same small surface (execute, executemany, commit, rollback, close,
# rows readable by name or by position, cursor.lastrowid) and translates the few dialect differences.
# ---------------------------------------------------------------------------------------------

class PgRow(dict):
    """A row readable by column name (row["id"]) or by position (row[0]), like sqlite3.Row."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return dict.__getitem__(self, key)


def _pg_row_factory(cursor):
    names = [d.name for d in cursor.description] if cursor.description else []
    return lambda values: PgRow(zip(names, values))


def _pg_sql(sql: str, with_params: bool) -> str:
    return sql.replace("%", "%%").replace("?", "%s") if with_params else sql


def _pg_ddl(sql: str) -> str:
    """Translate the SQLite schema text to PostgreSQL."""
    sql = sql.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
    sql = re.sub(r"\bREAL\b", "DOUBLE PRECISION", sql)
    sql = sql.replace("(datetime('now'))", "(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))")
    return sql


class PgCursor:
    def __init__(self, cur, lastrowid=None):
        self._cur = cur
        self.lastrowid = lastrowid

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def __iter__(self):
        return iter(self._cur)

    @property
    def rowcount(self):
        return self._cur.rowcount


# Tables keyed by a name/text instead of an integer id: there is no id to return.
NO_ID_TABLES = {"provider_status", "satellite_scenes", "satellite_observations", "terrain_data", "water_level_observations",
                "climatology", "flood_risk_predictions"}


class PgConn:
    def __init__(self, raw):
        self._raw = raw

    def execute(self, sql, params=()):
        sql = sql.strip()
        m = re.match(r"INSERT\s+INTO\s+(\w+)", sql, re.I)
        returning = bool(m) and m.group(1).lower() not in NO_ID_TABLES and "RETURNING" not in sql.upper()
        if returning:  # gives cursor.lastrowid like SQLite (every table with an id column)
            sql += " RETURNING id"
        cur = self._raw.cursor()
        cur.execute(_pg_sql(sql, bool(params)), tuple(params) if params else None)
        lastrowid = None
        if returning:
            row = cur.fetchone()
            lastrowid = row["id"] if row else None
        return PgCursor(cur, lastrowid)

    def executemany(self, sql, seq):
        cur = self._raw.cursor()
        cur.executemany(_pg_sql(sql.strip(), True), [tuple(p) for p in seq])
        return PgCursor(cur)

    def executescript(self, script):
        for stmt in script.split(";"):
            if stmt.strip():
                self._raw.execute(stmt)

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        self._raw.close()


def _pg_connect() -> PgConn:
    if psycopg is None:
        raise RuntimeError("DATABASE_URL points at PostgreSQL but the 'psycopg' package is not installed "
                           "(pip install -r requirements.txt).")
    raw = psycopg.connect(DATABASE_URL, row_factory=_pg_row_factory, connect_timeout=10)
    if _PG_SCHEMA:
        raw.execute(f'SET search_path TO "{_PG_SCHEMA}"')
    return PgConn(raw)


def create_schema(name: str) -> None:
    """Tests: make an empty, isolated PostgreSQL schema."""
    with psycopg.connect(DATABASE_URL, autocommit=True) as raw:
        raw.execute(f'CREATE SCHEMA "{name}"')


def drop_schema(name: str) -> None:
    with psycopg.connect(DATABASE_URL, autocommit=True) as raw:
        raw.execute(f'DROP SCHEMA IF EXISTS "{name}" CASCADE')


def table_exists(c, name: str) -> bool:
    if BACKEND == "postgres":
        return bool(c.execute("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?", (name,)).fetchone())
    return bool(c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def conn():
    if BACKEND == "postgres":
        return _pg_connect()
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    return c


@contextmanager
def session():
    """One request / operation = one transaction: commits on success, rolls back on error, always closes."""
    c = conn()
    try:
        yield c
        c.commit()
    except BaseException:
        c.rollback()
        raise
    finally:
        c.close()


def nearest_zone(lat: float, lng: float) -> str:
    return min(ZONES, key=lambda z: (ZONES[z][0] - lat) ** 2 + (ZONES[z][1] - lng) ** 2)


def _columns(c, table: str) -> set:
    if BACKEND == "postgres":
        rows = c.execute("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", (table,)).fetchall()
    else:
        rows = c.execute(f"PRAGMA table_info({table})").fetchall()
    return {r["name"] for r in rows}


# Referential integrity, PostgreSQL only (SQLite cannot add constraints to existing tables). A constraint is added only when the data
# already satisfies it; if orphaned rows exist it is skipped with a warning and NOTHING is deleted or changed.
# (table, column, parent table, on delete)
FOREIGN_KEYS = [
    ("sessions", "user_id", "users", "CASCADE"),
    ("push_tokens", "user_id", "users", "CASCADE"),
    ("auth_tokens", "user_id", "users", "CASCADE"),
    ("matches", "help_request_id", "help_requests", "CASCADE"),
    ("matches", "volunteer_id", "volunteers", "RESTRICT"),
    ("match_events", "help_request_id", "help_requests", "CASCADE"),
    ("volunteers", "user_id", "users", "SET NULL"),
    ("help_requests", "user_id", "users", "SET NULL"),
    ("incidents", "user_id", "users", "SET NULL"),
    ("incidents", "duplicate_of", "incidents", "SET NULL"),
]


def _add_foreign_keys(c) -> None:
    import logging
    log = logging.getLogger(__name__)
    for table, col, parent, on_delete in FOREIGN_KEYS:
        name = f"fk_{table}_{col}"
        if c.execute(f"SELECT 1 FROM pg_constraint WHERE conname='{name}' AND connamespace = current_schema()::regnamespace").fetchone():
            continue
        orphans = c.execute(f"SELECT COUNT(*) FROM {table} t LEFT JOIN {parent} p ON p.id = t.{col} WHERE t.{col} IS NOT NULL AND p.id IS NULL").fetchone()[0]
        if orphans:
            log.warning("Foreign key %s skipped: %d row(s) in %s.%s point at a missing %s. Clean them up (scripts/integrity_check.py) and restart.", name, orphans, table, col, parent)
            continue
        c.execute(f"ALTER TABLE {table} ADD CONSTRAINT {name} FOREIGN KEY ({col}) REFERENCES {parent}(id) ON DELETE {on_delete}")


def _migrate(c) -> None:
    c.executescript(_pg_ddl(SCHEMA) if BACKEND == "postgres" else SCHEMA)
    for table, cols in MIGRATIONS.items():
        have = _columns(c, table)
        for name, decl in cols:
            if name not in have:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {name} {_pg_ddl(decl) if BACKEND == 'postgres' else decl}")
    for stmt in INDEXES:
        c.execute(stmt)
    if BACKEND == "postgres":
        _add_foreign_keys(c)

    # accounts created by an admin (and the admin itself) are trusted; self-registered users verify their own email
    c.execute("UPDATE users SET email_verified=1 WHERE role IN ('admin','volunteer') AND email_verified=0")

    # Clean up legacy demo accounts without credentials and normalize roles
    c.execute("DELETE FROM users WHERE email IS NULL AND password_hash IS NULL AND name IN ('Demo Citizen','Demo Admin')")
    c.execute("UPDATE users SET role='user' WHERE role='CITIZEN' OR role='USER'")
    c.execute("UPDATE users SET role=LOWER(role)")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users(email)")


def init_db(reset: bool = False) -> None:
    if BACKEND == "postgres" and _PG_SCHEMA:  # an isolated schema is created on first use
        with psycopg.connect(DATABASE_URL, autocommit=True) as raw:
            raw.execute("SELECT pg_advisory_lock(727274)")  # same lock as below: concurrent first starts must not race on CREATE SCHEMA
            try:
                raw.execute(f'CREATE SCHEMA IF NOT EXISTS "{_PG_SCHEMA}"')
            finally:
                raw.execute("SELECT pg_advisory_unlock(727274)")
    with session() as c:
        if BACKEND == "postgres":
            # Two processes starting together on an empty database would race on CREATE TABLE and one would crash. This
            # transaction-scoped advisory lock makes the second one wait until the first has finished creating the schema.
            c.execute("SELECT pg_advisory_xact_lock(727274)")
        if reset:
            for t in (
                "sessions",
                "users",
                "incidents",
                "roads",
                "alerts",
                "help_requests",
                "volunteers",
                "matches",
                "environment_data",
                "risk_snapshots",
            ):
                c.execute(f"DROP TABLE IF EXISTS {t}")
        _migrate(c)
        if not reset:
            if c.execute("SELECT COUNT(*) FROM environment_data").fetchone()[0] == 0:
                seed_state(c)
            seed_volunteers(c)


def reset_db() -> None:
    """Restore the deterministic demo state in ONE transaction (all-or-nothing).
    Accounts, sessions and the volunteer roster survive; volunteers become available again.
    REAL data survives too: the monitored weather grid ('grid:' rows of environment_data) and roads imported from OpenStreetMap are
    observations / reference data, not demo state. Imported roads are only re-opened; the demo roads and zone baselines are re-seeded."""
    with session() as c:
        _migrate(c)
        for t in STATE_TABLES:
            if t == "environment_data":
                c.execute("DELETE FROM environment_data WHERE zone NOT LIKE 'grid:%'")
            elif t == "roads":
                c.execute("DELETE FROM roads WHERE source IS NULL OR source='SEED'")
                c.execute("UPDATE roads SET status='AVAILABLE'")
            else:
                c.execute(f"DELETE FROM {t}")
        emptied = [t for t in STATE_TABLES if c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] == 0]  # only these restart their ids
        if BACKEND == "postgres":
            for t in emptied:
                c.execute(f"ALTER SEQUENCE {t}_id_seq RESTART WITH 1")
        elif emptied:
            c.execute("DELETE FROM sqlite_sequence WHERE name IN (%s)" % ",".join("?" * len(emptied)), emptied)
        seed_state(c)
        seed_volunteers(c)
        c.execute("UPDATE volunteers SET available=1 WHERE status='ACTIVE'")


def road_scope(c) -> str:
    """SQL condition selecting the roads the app should use. The three SEED roads are synthetic reference geometry for an
    empty install (and the tests); once real roads have been imported from OpenStreetMap they are hidden everywhere."""
    if c.execute("SELECT 1 FROM roads WHERE COALESCE(source, 'SEED') <> 'SEED' LIMIT 1").fetchone():
        return "COALESCE(source, 'SEED') <> 'SEED'"
    return "1=1"


def seed_state(c) -> None:
    """Initial demo state: LOW rainfall, all roads AVAILABLE, no alerts. Synthetic data, not live readings."""
    t = now()
    for z, (la, lo) in ZONES.items():
        upsert = (
            "INSERT INTO environment_data(zone,latitude,longitude,rainfall,updated_at,data_source) VALUES(?,?,?,?,?,'DEMO_SEED') "
            "ON CONFLICT (zone) DO UPDATE SET latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, "
            "rainfall=EXCLUDED.rainfall, updated_at=EXCLUDED.updated_at, data_source=EXCLUDED.data_source"
            if BACKEND == "postgres"
            else "INSERT OR REPLACE INTO environment_data(zone,latitude,longitude,rainfall,updated_at,data_source) VALUES(?,?,?,?,?,'DEMO_SEED')"
        )
        c.execute(upsert, (z, la, lo, 5, t))
    c.executemany(
        "INSERT INTO roads(name,coordinates,status) VALUES(?,?,'AVAILABLE')",
        [
            ("Road A", json.dumps([[12.9716, 77.5946], [12.9650, 77.6050], [12.9580, 77.6150]])),
            ("Road B", json.dumps([[12.9716, 77.5946], [12.9800, 77.6100], [12.9900, 77.6200]])),
            ("Road C", json.dumps([[12.9352, 77.6245], [12.9500, 77.6100], [12.9716, 77.5946]])),
        ],
    )
    if DEMO_DATA:  # sample incident for presentations only
        c.execute(
            "INSERT INTO incidents(type,latitude,longitude,description,severity,trust_score,status,zone,user_id,timestamp,updated_at)"
            " VALUES('FLOOD',12.9720,77.5950,'Water logging near market',3,50,'REPORTED','Zone A',NULL,?,?)",
            (t, t),
        )


def seed_volunteers(c) -> None:
    """Sample roster (no login) for presentations. Only with DEMO_DATA=true; real volunteers are created by a Super Admin."""
    if DEMO_DATA and c.execute("SELECT COUNT(*) FROM volunteers").fetchone()[0] == 0:
        c.executemany(
            "INSERT INTO volunteers(name,skill,latitude,longitude,available,resources) VALUES(?,?,?,?,1,'[]')",
            [
                ("Volunteer 1", "MEDICINE", 12.9700, 77.5900),
                ("Volunteer 2", "FOOD", 12.9400, 77.6200),
                ("Volunteer 3", "FIRST_AID", 13.0300, 77.5950),
                ("Volunteer 4", "WATER", 12.9750, 77.6000),
            ],
        )
