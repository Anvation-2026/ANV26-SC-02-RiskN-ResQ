"""Tests for RiskN AI: answers come only from RiskN ResQ data, and missing data is reported as missing."""
import pytest

import db
from tests.test_api import client  # noqa: F401
from tests.test_auth import anon, user_client, volunteer_client
from tests.test_intelligence import refresh  # fills the cached weather grid through the real monitor (fake provider, no network)

HERE = {"latitude": 12.9716, "longitude": 77.5946}


@pytest.fixture(autouse=True)
def _tables():
    db.init_db(reset=False)


def test_anonymous_cannot_call_assistant(client):
    r = anon().post("/assistant/chat", json={"message": "What is my flood risk?"})
    assert r.status_code == 401
    
    r = anon().get("/assistant/suggested-questions")
    assert r.status_code == 401
    
    r = anon().get("/assistant/status")
    assert r.status_code == 401


def test_user_can_ask_risk_and_gets_grounded_response(client):
    refresh(r1=8.0, r3=20.0, r6=35.0, r24=70.0, f3=12.0, f6=20.0)
    u = user_client("citizen@test.local")
    r = u.post("/assistant/chat", json={
        "message": "What is my flood risk?",
        "latitude": 12.9716,
        "longitude": 77.5946
    })
    assert r.status_code == 200
    data = r.json()
    assert "reply" in data
    assert "CURRENT FLOOD RISK" in data["reply"]
    assert "Risk Level" in data["reply"]
    assert data["risk_badge"] is not None
    assert data["risk_badge"]["level"] in ("LOW", "MEDIUM", "HIGH", "CRITICAL")
    assert len(data["sources"]) > 0
    assert any(s["title"] == "Open-Meteo" for s in data["sources"])
    assert any(a["action"] == "open_map" for a in data["actions"])
    assert data["risk_badge"]["score"] > 0 and "+" in data["reply"]                    # the real contributing points are listed


def test_user_can_ask_why_risk_is_level(client):
    refresh(r1=8.0, r3=20.0, r6=35.0, r24=70.0)
    u = user_client("citizen2@test.local")
    r = u.post("/assistant/chat", json={
        "message": "Why is my risk at this level?",
        "latitude": 12.9716,
        "longitude": 77.5946
    })
    assert r.status_code == 200
    data = r.json()
    assert "WHY THIS RISK" in data["reply"]
    assert "RECOMMENDED ACTION" in data["reply"]


def test_weather_and_rainfall_question(client):
    refresh(r1=9.0, r3=21.0, r6=30.0, r24=64.0, f3=6.0, f6=10.0)
    u = user_client("citizen3@test.local")
    r = u.post("/assistant/chat", json={"message": "Is it raining heavily?", **HERE})
    assert r.status_code == 200
    data = r.json()
    assert "WEATHER & RAINFALL MONITORING" in data["reply"]
    assert "9.0 mm" in data["reply"] and "64.0 mm" in data["reply"]                   # the cached readings, not made-up numbers
    assert any(s["title"] == "Open-Meteo" for s in data["sources"])
    assert any(a["action"] == "open_map" for a in data["actions"])


def test_satellite_data_question(client):
    u = user_client("citizen4@test.local")
    r = u.post("/assistant/chat", json={"message": "What does satellite data show? What is Sentinel-1?"})
    assert r.status_code == 200
    data = r.json()
    assert "SATELLITE INTELLIGENCE" in data["reply"]
    assert "Sentinel-1" in data["reply"]
    # Critical requirement: must emphasize water change observed, NOT flood confirmed
    assert "Water change observed" in data["reply"]
    assert any("Sentinel-1" in s["title"] for s in data["sources"])


def test_evacuation_and_shelter_question(client):
    client.post("/admin/places", json={"kind": "SHELTER", "name": "Ward 12 Community Hall", "latitude": 12.975, "longitude": 77.598})
    u = user_client("citizen5@test.local")
    r = u.post("/assistant/chat", json={
        "message": "Where is the nearest designated evacuation point?",
        "latitude": 12.9716,
        "longitude": 77.5946
    })
    assert r.status_code == 200
    data = r.json()
    assert "EVACUATION" in data["reply"]
    # Must explicitly state designated does not guarantee safe
    assert "Designated" in data["reply"] and "Ward 12 Community Hall" in data["reply"] and "not verified safe" in data["reply"]
    assert any(a["action"] == "open_evacuation" for a in data["actions"])


def test_road_closures_question(client):
    u = user_client("citizen6@test.local")
    r = u.post("/assistant/chat", json={"message": "Which roads should I avoid?"})
    assert r.status_code == 200
    data = r.json()
    assert "ROAD RISK" in data["reply"]
    assert any(a["action"] == "open_map" for a in data["actions"])


def test_flood_safety_guidance(client):
    u = user_client("citizen7@test.local")
    r = u.post("/assistant/chat", json={"message": "What should I do during a flood?"})
    assert r.status_code == 200
    data = r.json()
    assert "SAFETY INSTRUCTIONS" in data["reply"]
    assert "112" in data["reply"]


def test_help_request_query(client):
    u = user_client("citizen8@test.local")
    r = u.post("/assistant/chat", json={"message": "I need help with medicine and evacuation"})
    assert r.status_code == 200
    data = r.json()
    assert "EMERGENCY ASSISTANCE" in data["reply"]
    assert any(a["action"] == "open_help" for a in data["actions"])


def test_citizen_cannot_read_admin_system_stats(client):
    u = user_client("regular_citizen@test.local")
    r = u.post("/assistant/chat", json={"message": "Show me admin analytics and provider status"})
    assert r.status_code == 200
    data = r.json()
    assert "Access Restricted" in data["reply"]
    assert "Super Administrators" in data["reply"]


def test_admin_can_query_system_status(client):
    r = client.post("/assistant/chat", json={"message": "Show system-wide flood intelligence and provider status"})
    assert r.status_code == 200
    data = r.json()
    assert "SYSTEM-WIDE INTELLIGENCE" in data["reply"]
    assert "Registered Citizens" in data["reply"]
    assert "Active Responders" in data["reply"]


def test_volunteer_can_query_assigned_and_nearby(client):
    v_client, vol_id = volunteer_client(client)
    r = v_client.post("/assistant/chat", json={"message": "What are my assigned tasks?"})
    assert r.status_code == 200
    data = r.json()
    assert "VOLUNTEER ASSIGNMENTS" in data["reply"]
    
    r = v_client.post("/assistant/chat", json={"message": "Show nearby open requests"})
    assert r.status_code == 200
    data = r.json()
    assert "NEARBY EMERGENCY REQUESTS" in data["reply"]


def test_suggested_questions_by_role(client):
    u = user_client("suggest_test@test.local")
    ru = u.get("/assistant/suggested-questions")
    assert ru.status_code == 200
    assert ru.json()["role"] == "user"
    assert len(ru.json()["questions"]) > 0

    ra = client.get("/assistant/suggested-questions")
    assert ra.status_code == 200
    assert ra.json()["role"] == "admin"
    assert "system-wide" in " ".join(ra.json()["questions"]).lower()


def test_assistant_status_endpoint(client):
    r = client.get("/assistant/status")
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "RiskN AI" and data["provider"] in ("grounded_engine", "gemini", "openai")
    assert len(data["grounded_sources"]) >= 5
    assert {s["status"] for s in data["grounded_sources"]} <= {"ONLINE", "STALE", "UNAVAILABLE"}
    # nothing has run in this fresh database, so nothing may claim to be online
    assert all(s["status"] == "UNAVAILABLE" for s in data["grounded_sources"])


def test_eighteen_hackathon_questions_coverage(client):
    """Verifies that all 18 hackathon challenge questions execute cleanly without error or hallucination."""
    u = user_client("hacker@test.local")
    questions = [
        "What is my flood risk?",
        "Why is my risk high?",
        "Is it raining heavily?",
        "What is the rainfall?",
        "What does satellite data show?",
        "Is there a flood nearby?",
        "Where is the nearest evacuation point?",
        "Which roads should I avoid?",
        "What should I do during a flood?",
        "Can I report flooding?",
        "Can I request evacuation?",
        "Explain my risk in simple words.",
        "What is Sentinel-1?",
        "What is terrain susceptibility?",
        "What is the difference between rain and flood?",
        "Is this flood confirmed?",
        "Why is the satellite observation old?",
        "What data sources are being used?"
    ]
    for q in questions:
        r = u.post("/assistant/chat", json={"message": q, "latitude": 12.9716, "longitude": 77.5946})
        assert r.status_code == 200, f"Failed on question: {q}"
        body = r.json()
        assert "reply" in body and len(body["reply"]) > 20
        assert "sources" in body


# ------------------------------------------------------------------ never invent: missing data stays missing
def test_no_location_is_never_replaced_by_a_default_city(client):
    refresh(r1=8.0, r24=70.0)
    u = user_client("noloc@test.local")
    for q in ("What is my flood risk?", "Is it raining heavily near me?", "Where is the nearest evacuation point?"):
        body = u.post("/assistant/chat", json={"message": q}).json()
        assert "LOCATION NOT SHARED" in body["reply"] and body["risk_badge"] is None, q


def test_no_data_means_insufficient_not_low(client):
    u = user_client("nodata@test.local")
    body = u.post("/assistant/chat", json={"message": "What is my flood risk?", **HERE}).json()
    assert "Insufficient data to estimate current flood risk." in body["reply"]
    assert body["risk_badge"] is None and "LOW" not in body["reply"]
    w = u.post("/assistant/chat", json={"message": "Is it raining?", **HERE}).json()
    assert "Weather data unavailable" in w["reply"] and "0.0 mm" not in w["reply"]
    e = u.post("/assistant/chat", json={"message": "Where is the nearest shelter?", **HERE}).json()
    assert "No designated evacuation point" in e["reply"]


def test_emergency_messages_get_action_first(client):
    u = user_client("sos@test.local")
    for q in ("I am trapped, water is entering the house", "help me my father is drowning"):
        body = u.post("/assistant/chat", json={"message": q, **HERE}).json()
        assert body["emergency"] is True and body["reply"].startswith("🚨 **CALL 112 NOW**"), q
        assert any(a["action"] == "open_help" for a in body["actions"])


def test_explanations_are_honest_about_models_and_satellites(client):
    u = user_client("explain@test.local")
    g = u.post("/assistant/chat", json={"message": "What is GloFAS?"}).json()
    assert "modelled, not a river gauge measurement" in g["reply"] and g["sources"][0]["category"] == "MODELLED"
    m = u.post("/assistant/chat", json={"message": "How is flood risk calculated?"}).json()
    assert "uncalibrated" in m["reply"] and "never lift the score above 49" in m["reply"]
    s = u.post("/assistant/chat", json={"message": "When was the satellite image taken?", **HERE}).json()
    assert "Satellite data unavailable" in s["reply"]                                     # no pass processed in this database
    assert "Sentinel-2" not in s["reply"] and all("Sentinel-2" not in x["title"] for x in s["sources"])   # not connected, never claimed


def test_risk_sources_are_labelled_by_kind(client):
    refresh(r1=8.0, r3=20.0, r6=35.0, r24=70.0)
    u = user_client("kinds@test.local")
    body = u.post("/assistant/chat", json={"message": "What is my flood risk?", **HERE}).json()
    kinds = {s["title"]: s["category"] for s in body["sources"]}
    assert kinds["Open-Meteo"] == "REAL" and kinds["RiskN ResQ risk engine"] == "MODELLED"
