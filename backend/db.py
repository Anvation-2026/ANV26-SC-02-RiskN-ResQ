import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from config import DATABASE_URL

# Path resolution: allow RISKNRESQ_DB override (for test suites), fallback to DATABASE_URL or default
DB_PATH = Path(os.environ.get("RISKNRESQ_DB", Path(__file__).parent / "resilienturban.db"))
if not os.environ.get("RISKNRESQ_DB") and DATABASE_URL.startswith("sqlite:///"):
    path_part = DATABASE_URL.replace("sqlite:///", "")
    DB_PATH = Path(__file__).parent / path_part if not Path(path_part).is_absolute() else Path(path_part)

# Cleared by reset_db(). Accounts (users, sessions) and the volunteer roster survive.
STATE_TABLES = ("incidents", "roads", "alerts", "help_requests", "matches", "environment_data")

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
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL
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
"""

# Columns added after the first release: older database files are upgraded in place.
MIGRATIONS = {
    "users": [
        ("email", "TEXT"),
        ("password_hash", "TEXT"),
        ("phone", "TEXT"),
        ("created_at", "TEXT"),
        ("is_active", "INTEGER NOT NULL DEFAULT 1"),
    ],
    "volunteers": [
        ("user_id", "INTEGER"),
        ("status", "TEXT NOT NULL DEFAULT 'ACTIVE'"),
        ("resources", "TEXT DEFAULT '[]'"),
    ],
    "incidents": [
        ("photo_file", "TEXT"),
        ("user_id", "INTEGER"),
        ("zone", "TEXT"),
        ("radius_meters", "REAL NOT NULL DEFAULT 50.0"),
    ],
    "alerts": [
        ("reason", "TEXT"),
        ("affected_road", "TEXT"),
        ("risk_score", "INTEGER"),
        ("source", "TEXT NOT NULL DEFAULT 'ENGINE'"),
        ("updated_at", "TEXT"),
    ],
    "environment_data": [
        ("data_source", "TEXT NOT NULL DEFAULT 'DEMO_SEED'"),
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


def conn() -> sqlite3.Connection:
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


def _migrate(c: sqlite3.Connection) -> None:
    c.executescript(SCHEMA)
    for table, cols in MIGRATIONS.items():
        have = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
        for name, decl in cols:
            if name not in have:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")

    # Clean up legacy demo accounts without credentials and normalize roles
    c.execute("DELETE FROM users WHERE email IS NULL AND password_hash IS NULL AND name IN ('Demo Citizen','Demo Admin')")
    c.execute("UPDATE users SET role='user' WHERE role='CITIZEN' OR role='USER'")
    c.execute("UPDATE users SET role=LOWER(role)")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users(email)")


def init_db(reset: bool = False) -> None:
    with session() as c:
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
    Accounts, sessions and the volunteer roster survive; volunteers become available again."""
    with session() as c:
        _migrate(c)
        for t in STATE_TABLES:
            c.execute(f"DELETE FROM {t}")
        c.execute("DELETE FROM sqlite_sequence WHERE name IN (%s)" % ",".join("?" * len(STATE_TABLES)), STATE_TABLES)
        seed_state(c)
        seed_volunteers(c)
        c.execute("UPDATE volunteers SET available=1 WHERE status='ACTIVE'")


def seed_state(c: sqlite3.Connection) -> None:
    """Initial demo state: LOW rainfall, all roads AVAILABLE, no alerts. Synthetic data, not live readings."""
    t = now()
    for z, (la, lo) in ZONES.items():
        c.execute(
            "INSERT OR REPLACE INTO environment_data(zone,latitude,longitude,rainfall,updated_at,data_source) VALUES(?,?,?,?,?,'DEMO_SEED')",
            (z, la, lo, 5, t),
        )
    c.executemany(
        "INSERT INTO roads(name,coordinates,status) VALUES(?,?,'AVAILABLE')",
        [
            ("Road A", json.dumps([[12.9716, 77.5946], [12.9650, 77.6050], [12.9580, 77.6150]])),
            ("Road B", json.dumps([[12.9716, 77.5946], [12.9800, 77.6100], [12.9900, 77.6200]])),
            ("Road C", json.dumps([[12.9352, 77.6245], [12.9500, 77.6100], [12.9716, 77.5946]])),
        ],
    )
    c.execute(
        "INSERT INTO incidents(type,latitude,longitude,description,severity,trust_score,status,zone,user_id,timestamp,updated_at)"
        " VALUES('FLOOD',12.9720,77.5950,'Water logging near market',3,50,'REPORTED','Zone A',NULL,?,?)",
        (t, t),
    )


def seed_volunteers(c: sqlite3.Connection) -> None:
    """Demo roster (no login). Real volunteer accounts are created by a Super Admin or self-registration."""
    if c.execute("SELECT COUNT(*) FROM volunteers").fetchone()[0] == 0:
        c.executemany(
            "INSERT INTO volunteers(name,skill,latitude,longitude,available,resources) VALUES(?,?,?,?,1,'[]')",
            [
                ("Volunteer 1", "MEDICINE", 12.9700, 77.5900),
                ("Volunteer 2", "FOOD", 12.9400, 77.6200),
                ("Volunteer 3", "FIRST_AID", 13.0300, 77.5950),
                ("Volunteer 4", "WATER", 12.9750, 77.6000),
            ],
        )
