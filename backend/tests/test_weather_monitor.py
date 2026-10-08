import asyncio

import pytest
from fastapi.testclient import TestClient

import config
import db
import main
import weather_monitor as wm
from providers.weather.base import WeatherObservation


class FakeProvider:
    """Stands in for the external weather API (tests must never call it)."""
    def __init__(self, rate=0.0, total=0.0, fail=False):
        self.rate, self.total, self.fail, self.calls = rate, total, fail, 0

    def get_source_name(self):
        return "Open-Meteo"

    async def get_weather_grid(self, points):
        self.calls += 1
        if self.fail:
            raise RuntimeError("down")
        return [WeatherObservation(source="Open-Meteo", station="t", latitude=la, longitude=lo,
                                   rainfall_24h_mm=self.total, rainfall_intensity_mm_per_hour=self.rate,
                                   observed_at="2026-10-08T12:00:00+00:00") for la, lo in points]


@pytest.fixture
def client():
    db.init_db(reset=False)
    return TestClient(main.app)


def test_grid_covers_configured_bounds():
    pts = wm.grid_points()
    assert len(pts) == 25
    south, west, north, east = config.MONITORING_BOUNDS
    assert all(south <= la <= north and west <= lo <= east for la, lo in pts)


@pytest.mark.parametrize("mm,level", [(0, "LOW"), (2.4, "LOW"), (2.5, "MODERATE"), (7.5, "HEAVY"), (15, "VERY_HEAVY")])
def test_rain_levels(mm, level):
    assert wm.rain_level(mm) == level


def test_refresh_stores_one_row_per_cell_and_never_bloats(client):
    p = FakeProvider(rate=9.0, total=40.0)
    asyncio.run(wm.refresh(p))
    asyncio.run(wm.refresh(p))
    with db.session() as c:
        assert c.execute("SELECT COUNT(*) FROM environment_data WHERE zone LIKE 'grid:%'").fetchone()[0] == 25
    assert p.calls == 2  # one batched call per refresh, not one per point


def test_endpoint_reports_heavy_rain_without_calling_it_a_flood(client):
    asyncio.run(wm.refresh(FakeProvider(rate=9.0, total=40.0)))
    body = client.get("/weather/monitoring").json()
    assert body["status"] == "ok" and body["source"] == "Open-Meteo"
    assert body["summary"] == {"monitored_locations": 25, "heavy_rain_locations": 25, "highest_rainfall_mm": 9.0}
    assert {l["rain_level"] for l in body["locations"]} == {"HEAVY"}
    assert "flood" not in str(body).lower()


def test_previous_reading_is_kept(client):
    asyncio.run(wm.refresh(FakeProvider(rate=1.0)))
    asyncio.run(wm.refresh(FakeProvider(rate=9.0)))
    loc = client.get("/weather/monitoring").json()["locations"][0]
    assert loc["previous_rainfall_mm"] == 1.0 and loc["rainfall_mm"] == 9.0


def test_heavy_rainfall_feeds_the_existing_risk_engine(client):
    asyncio.run(wm.refresh(FakeProvider(rate=20.0, total=110.0)))
    with db.session() as c:
        zone = main.compute_risk(c, "Zone A")
    assert zone["risk_level"] in ("HIGH", "CRITICAL") and zone["data_source"] == "Open-Meteo"
    assert any(a["affected_zone"] == "Zone A" for a in client.get("/alerts").json())


def test_light_rain_does_not_raise_risk(client):
    asyncio.run(wm.refresh(FakeProvider(rate=0.2, total=1.0)))
    with db.session() as c:
        assert main.compute_risk(c, "Zone A")["risk_level"] == "LOW"


def test_simulated_drill_is_not_overwritten(client):
    with db.session() as c:
        c.execute("UPDATE environment_data SET rainfall=90, data_source='SIMULATED' WHERE zone='Zone A'")
    asyncio.run(wm.refresh(FakeProvider(rate=0.0, total=0.0)))
    with db.session() as c:
        assert c.execute("SELECT rainfall FROM environment_data WHERE zone='Zone A'").fetchone()[0] == 90


def test_failure_keeps_last_data_labelled_and_invents_nothing(client, monkeypatch):
    asyncio.run(wm.refresh(FakeProvider(rate=9.0, total=40.0)))
    asyncio.run(wm.refresh(FakeProvider(fail=True)))
    body = client.get("/weather/monitoring").json()
    assert body["last_error"] and body["summary"]["highest_rainfall_mm"] == 9.0
    monkeypatch.setattr(config, "WEATHER_REFRESH_INTERVAL", 60)
    with db.session() as c:
        c.execute("UPDATE environment_data SET updated_at='2020-01-01T00:00:00+00:00' WHERE zone LIKE 'grid:%'")
    stale = client.get("/weather/monitoring").json()
    assert stale["status"] == "stale" and stale["stale"] and "Last updated" in stale["message"]


def test_unavailable_when_provider_never_worked(client, monkeypatch):
    monkeypatch.setattr(main, "weather_provider", FakeProvider(fail=True))
    body = client.get("/weather/monitoring").json()
    assert body["status"] == "unavailable" and body["locations"] == [] and body["message"] == "Weather data unavailable"
