import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "resilienturban.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'CITIZEN',
    latitude REAL, longitude REAL);
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
    description TEXT DEFAULT '', severity INTEGER NOT NULL DEFAULT 3, trust_score INTEGER NOT NULL DEFAULT 50,
    status TEXT NOT NULL DEFAULT 'REPORTED', zone TEXT, user_id INTEGER, timestamp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS roads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, coordinates TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE');
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, severity TEXT NOT NULL, message TEXT NOT NULL,
    affected_zone TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS help_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'MEDIUM',
    latitude REAL, longitude REAL, status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS volunteers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, skill TEXT NOT NULL,
    latitude REAL, longitude REAL, available INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT, help_request_id INTEGER NOT NULL, volunteer_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PROPOSED', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS environment_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT, zone TEXT NOT NULL UNIQUE, latitude REAL NOT NULL, longitude REAL NOT NULL,
    rainfall REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
"""

# Zone centres (Bengaluru-ish demo coordinates). Incidents are assigned to the nearest zone.
ZONES = {
    "Zone A": (12.9716, 77.5946),
    "Zone B": (12.9352, 77.6245),
    "Zone C": (13.0358, 77.5970),
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def nearest_zone(lat: float, lng: float) -> str:
    return min(ZONES, key=lambda z: (ZONES[z][0] - lat) ** 2 + (ZONES[z][1] - lng) ** 2)


def init_db(reset: bool = False) -> None:
    c = conn()
    if reset:
        for t in ("users", "incidents", "roads", "alerts", "help_requests", "volunteers", "matches", "environment_data"):
            c.execute(f"DROP TABLE IF EXISTS {t}")
    c.executescript(SCHEMA)
    if c.execute("SELECT COUNT(*) FROM environment_data").fetchone()[0] == 0:
        seed(c)
    c.commit()
    c.close()


def seed(c: sqlite3.Connection) -> None:
    t = now()
    for z, (la, lo) in ZONES.items():
        c.execute("INSERT INTO environment_data(zone,latitude,longitude,rainfall,updated_at) VALUES(?,?,?,?,?)",
                  (z, la, lo, 5, t))
    c.executemany("INSERT INTO users(name,role,latitude,longitude) VALUES(?,?,?,?)", [
        ("Demo Citizen", "CITIZEN", 12.9716, 77.5946),
        ("Demo Admin", "ADMIN", 12.9750, 77.6000),
    ])
    c.executemany("INSERT INTO roads(name,coordinates,status) VALUES(?,?,?)", [
        ("Road A", json.dumps([[12.9716, 77.5946], [12.9650, 77.6050], [12.9580, 77.6150]]), "AVAILABLE"),
        ("Road B", json.dumps([[12.9716, 77.5946], [12.9800, 77.6100], [12.9900, 77.6200]]), "BLOCKED"),
        ("Road C", json.dumps([[12.9352, 77.6245], [12.9500, 77.6100], [12.9716, 77.5946]]), "AVAILABLE"),
    ])
    c.executemany("INSERT INTO volunteers(name,skill,latitude,longitude,available) VALUES(?,?,?,?,1)", [
        ("Volunteer 1", "MEDICINE", 12.9700, 77.5900),
        ("Volunteer 2", "FOOD", 12.9400, 77.6200),
        ("Volunteer 3", "FIRST_AID", 13.0300, 77.5950),
    ])
    c.execute("INSERT INTO incidents(type,latitude,longitude,description,severity,trust_score,status,zone,user_id,timestamp)"
              " VALUES('FLOOD',12.9720,77.5950,'Water logging near market',3,50,'REPORTED','Zone A',1,?)", (t,))
