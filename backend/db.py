import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from config import DATABASE_URL

DB_PATH = Path(__file__).parent / "resilienturban.db"
if DATABASE_URL.startswith("sqlite:///"):
    path_part = DATABASE_URL.replace("sqlite:///", "")
    DB_PATH = Path(__file__).parent / path_part if not Path(path_part).is_absolute() else Path(path_part)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'CITIZEN',
    latitude REAL,
    longitude REAL,
    created_at TEXT NOT NULL
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
    timestamp TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    affected_zone TEXT,
    latitude REAL,
    longitude REAL,
    active INTEGER NOT NULL DEFAULT 1,
    source TEXT DEFAULT 'SYSTEM',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS help_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'MEDIUM',
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS volunteers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    skill TEXT NOT NULL,
    resources TEXT NOT NULL,
    phone TEXT,
    latitude REAL,
    longitude REAL,
    available INTEGER NOT NULL DEFAULT 1,
    responder_mode INTEGER NOT NULL DEFAULT 0,
    last_location_update TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    help_request_id INTEGER NOT NULL,
    volunteer_id INTEGER NOT NULL,
    distance_km REAL NOT NULL,
    eta_minutes INTEGER NOT NULL,
    match_score INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PROPOSED',
    created_at TEXT NOT NULL
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


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db(reset: bool = False) -> None:
    c = conn()
    if reset:
        for t in (
            "users",
            "incidents",
            "alerts",
            "help_requests",
            "volunteers",
            "matches",
            "risk_snapshots",
        ):
            c.execute(f"DROP TABLE IF EXISTS {t}")
    c.executescript(SCHEMA)
    c.commit()
    c.close()
