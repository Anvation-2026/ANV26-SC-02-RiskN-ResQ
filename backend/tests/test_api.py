"""Backend API tests. Each test runs against a throw-away SQLite file, never the demo database."""
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth  # noqa: E402
import db  # noqa: E402
import main  # noqa: E402

A = {"latitude": 12.9720, "longitude": 77.5950}
ADMIN = {"email": "admin@test.local", "password": "Adm1n-test-pass"}


def login_as(c, creds):
    r = c.post("/auth/login", json=creds)
    assert r.status_code == 200, r.text
    c.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return r.json()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """A TestClient signed in as the Super Admin (so the disaster-response tests can use every endpoint)."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(main, "PHOTO_DIR", tmp_path / "uploads")  # never write test photos into the real uploads folder
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN["email"])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN["password"])
    auth.reset_login_throttle()
    with TestClient(main.app) as c:
        login_as(c, ADMIN)
        yield c


def level(client, zone="Zone A"):
    return client.get("/risk", params={"zone": zone}).json()["risk_level"]


def simulate(client, rainfall, **extra):
    r = client.post("/simulate-hazard", json={"hazard": "FLOOD", "rainfall": rainfall, **extra})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- health, initial state, reset ----------

def test_health(client):
    assert client.get("/health").json() == {"status": "ok", "database": "ok"}


def test_initial_state_is_low_open_and_quiet(client):
    assert level(client) == "LOW"
    assert all(r["status"] == "AVAILABLE" for r in client.get("/roads").json())
    assert client.get("/alerts", params={"active_only": True}).json() == []


def test_reset_restores_demo_state_repeatedly(client):
    simulate(client, 120)
    client.post("/roads/1/block")
    client.post("/incidents", json={"type": "FLOOD", **A})
    client.post("/help-request", json={"type": "MEDICINE", "priority": "HIGH"})
    for _ in range(2):  # repeated resets must stay consistent
        out = client.post("/reset").json()
        assert out == {"status": "reset", "risk_level": "LOW", "active_alerts": 0, "blocked_roads": 0}
    assert len(client.get("/incidents").json()) == 1  # only the seeded demo incident
    assert client.get("/help-requests").json() == []
    assert client.get("/alerts").json() == []
    assert client.get("/health").status_code == 200


# ---------- risk engine ----------

@pytest.mark.parametrize("rain,expected", [(5, "LOW"), (40, "MEDIUM"), (80, "HIGH"), (120, "CRITICAL")])
def test_rainfall_bands(client, rain, expected):
    simulate(client, rain)
    assert level(client) == expected


def test_risk_payload_is_labelled_as_simulated(client):
    simulate(client, 80)
    body = client.get("/risk", params={"zone": "Zone A"}).json()
    assert body["data_source"] == "SIMULATED" and "not a real-time" in body["notice"].lower()


def test_verified_reports_raise_risk(client):
    simulate(client, 40)
    before = client.get("/risk", params={"zone": "Zone A"}).json()["risk_score"]
    inc = client.post("/incidents", json={"type": "FLOOD", **A}).json()
    client.post(f"/incidents/{inc['id']}/verify")
    after = client.get("/risk", params={"zone": "Zone A"}).json()["risk_score"]
    assert after > before


def test_unknown_zone_is_404(client):
    assert client.get("/risk", params={"zone": "Zone Z"}).status_code == 404


# ---------- simulation and alerts ----------

def test_low_high_low_cycle_with_single_alert_per_zone(client):
    assert level(client) == "LOW"
    for _ in range(3):  # repeated heavy-rain simulations must not duplicate alerts
        simulate(client, 80)
    active = client.get("/alerts", params={"active_only": True}).json()
    assert len(active) == 3 and {a["affected_zone"] for a in active} == {"Zone A", "Zone B", "Zone C"}
    assert all(a["severity"] == "HIGH" for a in active)
    simulate(client, 120)  # upgrade, not duplicate
    active = client.get("/alerts", params={"active_only": True}).json()
    assert len(active) == 3 and all(a["severity"] == "CRITICAL" for a in active)
    simulate(client, 5)
    assert client.get("/alerts", params={"active_only": True}).json() == []
    assert len(client.get("/alerts").json()) == 3  # history kept, all inactive


def test_alert_content_and_affected_road(client):
    simulate(client, 80, zone="Zone A")
    client.post("/roads/1/block")  # Road A starts in Zone A
    alert = client.get("/alerts", params={"active_only": True}).json()[0]
    assert alert["affected_zone"] == "Zone A" and alert["severity"] == "HIGH"
    assert alert["affected_road"] == "Road A" and "Road A" in alert["message"]
    assert alert["reason"] and alert["created_at"] and alert["updated_at"] and alert["risk_score"] >= 50
    client.post("/roads/1/unblock")
    assert client.get("/alerts", params={"active_only": True}).json()[0]["affected_road"] is None


def test_manual_alert_is_not_cleared_by_engine(client):
    r = client.post("/alerts", json={"severity": "HIGH", "message": "Drill", "affected_zone": "Zone C"})
    assert r.status_code == 201 and r.json()["source"] == "MANUAL"
    simulate(client, 5)
    assert any(a["message"] == "Drill" for a in client.get("/alerts", params={"active_only": True}).json())
    assert client.post("/alerts", json={"severity": "HIGH", "message": "x", "affected_zone": "Nowhere"}).status_code == 404


def test_simulate_validation(client):
    assert client.post("/simulate-hazard", json={"rainfall": -1}).status_code == 422
    assert client.post("/simulate-hazard", json={"rainfall": 9999}).status_code == 422
    assert client.post("/simulate-hazard", json={"hazard": "FIRE", "rainfall": 10}).status_code == 422
    assert client.post("/simulate-hazard", json={"rainfall": 10, "zone": "Nope"}).status_code == 404


# ---------- incidents ----------

def test_incident_is_stored_and_listed(client):
    r = client.post("/incidents", json={"type": "Blocked Road", "description": "  tree down ", "severity": 4, "user_id": 1, **A})
    assert r.status_code == 201
    body = r.json()
    assert body["type"] == "BLOCKED_ROAD" and body["status"] == "REPORTED" and body["description"] == "tree down"
    assert body["trust_score"] == 50 and body["zone"] == "Zone A"  # no similar BLOCKED_ROAD report yet
    got = client.get(f"/incidents/{body['id']}").json()
    assert got["id"] == body["id"]
    assert body["id"] in [i["id"] for i in client.get("/incidents").json()]
    # really persisted in SQLite
    with sqlite3.connect(db.DB_PATH) as raw:
        assert raw.execute("SELECT COUNT(*) FROM incidents WHERE id=?", (body["id"],)).fetchone()[0] == 1


def test_trust_score_rises_with_similar_reports_and_verification(client):
    first = client.post("/incidents", json={"type": "FLOOD", **A}).json()  # seeded flood report is nearby
    assert first["trust_score"] == 65
    assert client.post(f"/incidents/{first['id']}/verify").json()["trust_score"] == 90
    assert client.post(f"/incidents/{first['id']}/reject").json()["trust_score"] == 0


@pytest.mark.parametrize("payload", [
    {"type": "TORNADO", **A},
    {"type": "FLOOD", "latitude": 99, "longitude": 77.5},
    {"type": "FLOOD", "latitude": 12.9},
    {"type": "FLOOD", "severity": 9, **A},
    {"type": "FLOOD", "description": "x" * 501, **A},
    {},
])
def test_bad_incident_requests_are_422(client, payload):
    r = client.post("/incidents", json=payload)
    assert r.status_code == 422 and "Invalid request" in r.json()["detail"]
    assert len(client.get("/incidents").json()) == 1  # nothing extra saved


def test_incident_lookups(client):
    assert client.get("/incidents/9999").status_code == 404
    assert client.get("/incidents/abc").status_code == 422
    spoof = client.post("/incidents", json={"type": "FLOOD", "user_id": 999, **A}).json()  # client-supplied owner is ignored
    assert spoof["user_id"] != 999
    assert client.post("/incidents/9999/verify").status_code == 404
    assert client.get("/incidents", params={"status": "BOGUS"}).status_code == 422
    assert client.get("/incidents", params={"limit": 0}).status_code == 422


# ---------- roads ----------

def test_road_block_unblock_is_dynamic_and_idempotent(client):
    assert client.get("/roads/1").json()["status"] == "AVAILABLE"
    for _ in range(2):
        assert client.post("/roads/1/block").json()["status"] == "BLOCKED"
    assert [r["id"] for r in client.get("/roads", params={"status": "BLOCKED"}).json()] == [1]
    for _ in range(2):
        assert client.post("/roads/1/unblock").json()["status"] == "AVAILABLE"
    assert client.get("/roads", params={"status": "BLOCKED"}).json() == []


def test_road_errors(client):
    assert client.get("/roads/99").status_code == 404
    assert client.post("/roads/99/block").status_code == 404
    assert client.post("/roads/x/block").status_code == 422
    assert client.get("/roads", params={"status": "CLOSED"}).status_code == 422


# ---------- help requests, volunteers, matches ----------

@pytest.mark.parametrize("raw,stored", [("MEDICINE", "MEDICINE"), ("Food", "FOOD"), ("water", "WATER"),
                                        ("First Aid", "FIRST_AID"), ("Evacuation Assistance", "EVACUATION")])
@pytest.mark.parametrize("priority", ["Low", "MEDIUM", "high", "CRITICAL"])
def test_help_request_types_and_priorities(client, raw, stored, priority):
    r = client.post("/help-request", json={"user_id": 1, "type": raw, "priority": priority, **A})
    assert r.status_code == 201
    body = r.json()
    assert body["type"] == stored and body["priority"] == priority.upper() and body["status"] == "OPEN"
    assert client.get(f"/help-requests/{body['request_id']}").json()["type"] == stored


def test_help_request_validation(client):
    assert client.post("/help-request", json={"type": "PIZZA"}).status_code == 422
    assert client.post("/help-request", json={"type": "FOOD", "priority": "URGENT"}).status_code == 422
    assert client.post("/help-request", json={"type": "FOOD", "latitude": 12.9}).status_code == 422
    assert client.get("/help-requests").json() == []
    assert client.get("/help-requests/5").status_code == 404


def test_volunteers_and_matches(client):
    vols = client.get("/volunteers").json()
    assert {v["skill"] for v in vols} == {"MEDICINE", "FOOD", "FIRST_AID", "WATER"}
    assert all(isinstance(v["available"], bool) for v in vols)
    assert [v["name"] for v in client.get("/volunteers", params={"skill": "medicine"}).json()] == ["Volunteer 1"]
    assert client.get("/volunteers", params={"skill": "EVACUATION"}).json() == []  # nothing fabricated

    req = client.post("/help-request", json={"type": "MEDICINE", "priority": "HIGH"}).json()["request_id"]
    assert client.post("/matches", json={"help_request_id": req, "volunteer_id": 1}).status_code == 201
    assert client.get(f"/help-requests/{req}").json()["status"] == "MATCHED"
    assert client.post("/matches", json={"help_request_id": req, "volunteer_id": 2}).status_code == 409
    assert client.post("/matches", json={"help_request_id": 999, "volunteer_id": 1}).status_code == 404
    assert client.post("/matches", json={"help_request_id": req, "volunteer_id": 999}).status_code == 404
    assert len(client.get("/matches", params={"help_request_id": req}).json()) == 1


# ---------- reliability ----------

def test_cors_headers(client):
    r = client.get("/health", headers={"Origin": "http://localhost:8081"})
    assert r.headers["access-control-allow-origin"] == "*"


def test_database_failure_returns_json_500_and_server_survives(client, monkeypatch):
    real = db.conn

    def broken():
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(db, "conn", broken)
    safe = TestClient(main.app, raise_server_exceptions=False, headers=dict(client.headers))
    r = safe.post("/incidents", json={"type": "FLOOD", **A})
    assert r.status_code == 500 and r.json()["error"] == "database"
    assert safe.get("/health").status_code == 503
    monkeypatch.setattr(db, "conn", real)
    assert safe.get("/health").status_code == 200
    assert len(client.get("/incidents").json()) == 1  # the failed save left no trace


def test_old_database_files_are_upgraded(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as raw:  # schema from the first release
        raw.execute("CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, severity TEXT NOT NULL, message TEXT NOT NULL,"
                    " affected_zone TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)")
        raw.execute("CREATE TABLE environment_data (id INTEGER PRIMARY KEY AUTOINCREMENT, zone TEXT NOT NULL UNIQUE,"
                    " latitude REAL NOT NULL, longitude REAL NOT NULL, rainfall REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)")
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN["email"])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN["password"])
    with TestClient(main.app) as c:
        login_as(c, ADMIN)
        assert level(c) == "LOW"
        simulate(c, 80)
        assert c.get("/alerts").json()[0]["reason"]
