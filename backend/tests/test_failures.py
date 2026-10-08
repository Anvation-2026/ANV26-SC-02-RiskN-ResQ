"""Failure handling: every external dependency can fail and the app degrades honestly (an explicit 'unavailable', never an
invented value). Providers are replaced with failing fakes; nothing here touches the network."""
import asyncio
import sqlite3

import pytest

import db
import flood_intel as fi
import intel_jobs as jobs
import main
import notify
import weather_monitor as wm
from providers.climate.base import Climatology
from tests.test_api import client  # noqa: F401
from tests.test_auth import anon, register, user_client
from tests.test_intelligence import RainProvider, assess, refresh, sig


@pytest.fixture(autouse=True)
def _tables():
    db.init_db(reset=False)


class Boom:
    """Any provider whose every call raises."""
    def get_source_name(self):
        return "down"

    async def get_terrain(self, pts):
        raise RuntimeError("terrain service down")

    async def get_levels(self, pts):
        raise TimeoutError("river service timed out")

    async def get_climatology(self, pts):
        raise ConnectionError("archive down")

    async def get_weather_grid(self, pts):
        raise RuntimeError("weather down")


def status(name):
    return next(s for s in jobs.provider_statuses() if s["name"] == name)


def test_terrain_failure_is_reported_and_risk_continues(client):
    assert asyncio.run(jobs.refresh_terrain(Boom()))["ok"] is False
    assert status("terrain")["state"] == "UNAVAILABLE" and status("terrain")["detail"] == "Terrain data unavailable"
    refresh(r24=60.0)
    a = assess()
    assert a["risk_score"] > 0 and any(m["key"] == "terrain" for m in a["missing"])
    assert anon().get("/terrain").json()["message"] == "Terrain data unavailable"


def test_river_failure_is_reported_and_risk_continues(client):
    assert asyncio.run(jobs.refresh_water_levels([Boom()]))["ok"] is False
    assert status("water_level")["state"] == "UNAVAILABLE"
    refresh(r24=60.0)
    assert any(m["key"] == "river" for m in assess()["missing"])


def test_climatology_failure_is_reported(client):
    assert asyncio.run(jobs.refresh_climatology(Boom()))["ok"] is False
    assert status("climatology")["state"] == "UNAVAILABLE"
    refresh(r24=60.0)
    assert any(m["key"] == "history" for m in assess()["missing"])


def test_one_failing_provider_never_stops_the_others(client):
    class Ok:
        def get_source_name(self):
            return "ok"

        async def get_climatology(self, pts):
            return [Climatology(30.0, 60.0, 120.0, 10, "ok") for _ in pts]
    p = jobs.Providers(weather=RainProvider(), satellite=Boom(), terrain=Boom(), water=[Boom()], climate=Ok())
    out = asyncio.run(jobs.run_all(p, ("terrain", "climatology", "water")))
    assert out["terrain"]["ok"] is False and out["water"]["ok"] is False and out["climatology"]["ok"] is True
    assert status("climatology")["state"] == "OK"


def test_weather_failure_is_never_shown_as_zero_rain(client):
    asyncio.run(wm.refresh(Boom()))
    body = anon().get("/weather/monitoring").json()
    assert body["status"] == "unavailable" and body["locations"] == [] and body["message"] == "Weather data unavailable"
    z = anon().get("/flood-risk/Zone A").json()
    assert z["insufficient"] is True and z["reason"] == "Insufficient data to estimate current flood risk."


def test_database_outage_is_a_clean_json_error_without_internals(client, monkeypatch):
    def broken(*a, **k):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(db, "session", broken)
    from fastapi.testclient import TestClient
    r = TestClient(main.app, raise_server_exceptions=False).get("/roads")
    assert r.status_code == 500 and r.json()["error"] == "database" and "retry" in r.json()["detail"].lower()
    assert "Traceback" not in r.text and "sqlite3" not in r.text and "locked" not in r.text


def test_email_provider_failure_does_not_break_registration_or_recovery(client, monkeypatch):
    def down(to, subject, body):
        raise ConnectionRefusedError("smtp down")
    monkeypatch.setattr(notify, "_send_email", down)
    assert register(anon(), "mail@test.local").status_code == 201          # the account is created; the code can be resent
    assert anon().post("/auth/forgot-password", json={"email": "mail@test.local"}).status_code == 200


def test_push_and_sms_failures_never_break_a_help_request(client, monkeypatch):
    from tests.test_auth import volunteer_client
    v, _ = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    v.post("/me/push-token", json={"token": "ExponentPushToken[abcdefghijklmnop]"})
    monkeypatch.setattr(notify, "_post", lambda *a, **k: (_ for _ in ()).throw(TimeoutError("push down")))
    r = user_client().post("/help-requests", json={"type": "MEDICINE", "latitude": 12.9716, "longitude": 77.5946})
    assert r.status_code == 201 and r.json()["match"]["matched"] is True


def test_a_failing_recompute_does_not_lose_the_stored_provider_data(client, monkeypatch):
    monkeypatch.setattr(fi, "recompute_all", lambda c: (_ for _ in ()).throw(RuntimeError("scoring failed")))
    out = asyncio.run(jobs.refresh_terrain(type("T", (), {"get_source_name": lambda s: "dem", "get_terrain": lambda s, pts: _terrain(pts)})()))
    assert out["ok"] is True
    with db.session() as c:
        assert c.execute("SELECT COUNT(*) FROM terrain_data").fetchone()[0] == 25   # the data was stored even though scoring failed


async def _terrain(pts):
    from providers.terrain.base import TerrainPoint
    return [TerrainPoint(900.0 + i, 1.0, -1.0) for i in range(len(pts))]


def test_a_help_request_works_with_no_volunteer_and_says_so(client):
    with db.session() as c:
        c.execute("DELETE FROM volunteers")   # the test database carries a sample roster; this case needs none
    r = user_client().post("/help-requests", json={"type": "WATER", "latitude": 12.9716, "longitude": 77.5946})
    assert r.status_code == 201 and r.json()["match"]["matched"] is False and "No matching volunteer" in r.json()["match"]["message"]


def test_provider_errors_state_the_real_reason_without_leaking_urls(client):
    import httpx
    req = httpx.Request("GET", "https://archive-api.open-meteo.com/v1/archive?apikey=SECRETKEY")
    resp = httpx.Response(429, json={"error": True, "reason": "Daily API request limit exceeded. Please try again tomorrow."}, request=req)

    class Limited:
        def get_source_name(self):
            return "limited"

        async def get_climatology(self, pts):
            resp.raise_for_status()
    assert asyncio.run(jobs.refresh_climatology(Limited()))["ok"] is False
    err = status("climatology")["last_error"]
    assert err.startswith("HTTP 429: Daily API request limit exceeded") and "SECRETKEY" not in err and "http" not in err.lower().replace("http 429", "")
