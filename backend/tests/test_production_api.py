import pytest
from fastapi.testclient import TestClient
import db
from main import app

import auth

ADMIN = {"email": "admin@test.local", "password": "Adm1n-test-pass"}
client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db(monkeypatch, tmp_path):
    # Isolation: this fixture resets the whole database, so it must never touch the real one (accounts live there).
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "production_api_test.db")
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN["email"])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN["password"])
    auth.reset_login_throttle()
    db.init_db(reset=True)
    auth.ensure_admin()
    r = client.post("/auth/login", json=ADMIN)
    if r.status_code == 200:
        client.headers["Authorization"] = f"Bearer {r.json()['token']}"
    yield
    client.headers.pop("Authorization", None)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_health_providers():
    res = client.get("/health/providers")
    assert res.status_code == 200
    data = res.json()
    assert data["database"] == "ok"
    assert "routing" in data


def test_real_weather_and_risk():
    # Test real risk endpoint with coordinates
    res = client.get("/risk?latitude=12.9716&longitude=77.5946")
    assert res.status_code == 200
    data = res.json()
    assert "risk_score" in data
    assert data["risk_level"] in ("LOW", "MODERATE", "HIGH", "CRITICAL")
    assert "weather_source" in data
    assert "rainfall_24h_mm" in data


def test_real_routing_compute():
    # Test route from Cubbon Park to MG Road
    payload = {
        "origin": {"latitude": 12.9716, "longitude": 77.5946},
        "destination": {"latitude": 12.9765, "longitude": 77.6050},
        "travelMode": "DRIVE",
    }
    res = client.post("/routes/compute", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert len(data["polyline"]) >= 2
    assert data["distanceMeters"] > 0
    assert data["etaMinutes"] >= 1
    assert data["validatedAgainstIncidents"] is True


def test_incident_reporting_and_trust():
    payload = {
        "type": "FLOODED_ROAD",
        "latitude": 12.9730,
        "longitude": 77.5980,
        "radiusMeters": 50,
        "description": "Severe waterlogging knee deep",
        "severity": 4,
        "reportedBy": "Local Resident",
    }
    res = client.post("/incidents", json=payload)
    assert res.status_code == 201
    created = res.json()
    assert created["id"] is not None
    assert created["confidence"] in ("LOW", "MEDIUM", "HIGH", "VERY HIGH")
    assert created["status"] == "REPORTED"

    # Verify listing
    list_res = client.get("/incidents?latitude=12.9730&longitude=77.5980&radius_km=5")
    assert list_res.status_code == 200
    items = list_res.json()
    assert len(items) >= 1
    assert items[0]["id"] == created["id"]


def test_incident_aware_rerouting():
    # Place a flood blockage on a coordinate
    inc_payload = {
        "type": "FLOODED_ROAD",
        "latitude": 12.9735,
        "longitude": 77.5980,
        "radiusMeters": 80,
        "description": "Road completely flooded",
        "severity": 5,
    }
    inc_res = client.post("/incidents", json=inc_payload)
    assert inc_res.status_code == 201
    inc_id = inc_res.json()["id"]

    # Verify incident
    verify_res = client.post(f"/incidents/{inc_id}/verify")
    assert verify_res.status_code == 200

    # Compute route across the area
    route_payload = {
        "origin": {"latitude": 12.9716, "longitude": 77.5946},
        "destination": {"latitude": 12.9765, "longitude": 77.6050},
        "travelMode": "DRIVE",
    }
    res = client.post("/routes/compute", json=route_payload)
    assert res.status_code == 200
    route_data = res.json()
    assert route_data["validatedAgainstIncidents"] is True


def test_volunteer_registration_and_matching():
    # 1. Register a real volunteer
    vol_payload = {
        "name": "Dr. Sarah",
        "skill": "MEDICINE",
        "resources": "Emergency Medical Kit, Oxygen, Insulin",
        "phone": "+91 98450 99999",
        "latitude": 12.9750,
        "longitude": 77.6010,
    }
    reg_res = client.post("/volunteers/register", json=vol_payload)
    assert reg_res.status_code == 201
    vol_id = reg_res.json()["id"]

    # 2. Update volunteer live location
    loc_res = client.post(
        f"/volunteers/{vol_id}/location",
        json={"latitude": 12.9752, "longitude": 77.6012},
    )
    assert loc_res.status_code == 200
    assert loc_res.json()["status"] == "updated"

    # 3. Request help for Medicine
    help_payload = {
        "userId": 1,
        "type": "Medicine",
        "priority": "HIGH",
        "latitude": 12.9716,
        "longitude": 77.5946,
    }
    help_res = client.post("/help-requests", json=help_payload)
    assert help_res.status_code == 201
    help_data = help_res.json()
    assert help_data["match"]["matched"] is True
    assert help_data["match"]["volunteer"]["name"] == "Dr. Sarah"
    assert help_data["match"]["volunteer"]["latitude"] == 12.9752
    assert help_data["match"]["volunteer"]["longitude"] == 77.6012
    assert help_data["match"]["distanceKm"] > 0


def test_sync_telemetry():
    res = client.get("/sync?latitude=12.9716&longitude=77.5946")
    assert res.status_code == 200
    data = res.json()
    assert "timestamp" in data
    assert "risk" in data
    assert "incidents" in data
    assert "volunteers" in data
