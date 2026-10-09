"""Flood intelligence: weather accumulation, satellite water change, terrain, river level, history, scoring, hotspots,
road risk, risk-aware routing, automatic alerts, honesty about missing data. Providers are fakes: the network is never used."""
import asyncio
import json

import pytest

import config
import db
import flood_intel as fi
import intel_jobs as jobs
import ml_model
import road_risk
import routes_intel
import weather_monitor as wm
from providers.climate.base import Climatology
from providers.satellite.base import SatelliteProvider, SatelliteScene, SatelliteUnavailable, WaterStat
from providers.terrain.base import TerrainPoint
from providers.waterlevel.base import GaugeWaterLevelProvider, WaterReading
from providers.weather.base import WeatherObservation
from providers.weather.open_meteo import accumulations
from providers.routing.base import RouteCandidate, RoutePoint
from tests.test_api import client, login_as  # noqa: F401  (client = signed-in admin)
from tests.test_auth import anon, make_volunteer, user_client
from tests.test_weather_monitor import FakeProvider

KEYS = [wm._key(*p) for p in wm.grid_points()]
CELL_A = wm._key(12.99, 77.62)   # the cell Zone A (12.9716, 77.5946) falls in


@pytest.fixture(autouse=True)
def _tables():
    db.init_db(reset=False)


class RainProvider:
    """A weather provider whose grid values the test chooses (per-cell overrides allowed)."""
    def __init__(self, r1=0.0, r3=0.0, r6=0.0, r24=0.0, f3=0.0, f6=0.0, over=None):
        self.v, self.over = dict(r1=r1, r3=r3, r6=r6, r24=r24, f3=f3, f6=f6), over or {}

    def get_source_name(self):
        return "Open-Meteo"

    async def get_weather_grid(self, points):
        out = []
        for la, lo in points:
            v = {**self.v, **self.over.get(wm._key(la, lo), {})}
            out.append(WeatherObservation(source="Open-Meteo", station="t", latitude=la, longitude=lo, rainfall_24h_mm=v["r24"], rainfall_intensity_mm_per_hour=v["r1"],
                                          observed_at="2026-10-08T12:00:00+00:00", rain_1h_mm=v["r1"], rain_3h_mm=v["r3"], rain_6h_mm=v["r6"],
                                          forecast_3h_mm=v["f3"], forecast_6h_mm=v["f6"]))
        return out


def refresh(**kw):
    asyncio.run(wm.refresh(RainProvider(**kw)))


def put(table, key, **cols):
    """Insert or replace a cache row for a cell (stands in for what a provider job would have stored)."""
    with db.session() as c:
        c.execute(f"DELETE FROM {table} WHERE cell=?", (key,))
        names = ", ".join(["cell", *cols])
        c.execute(f"INSERT INTO {table}({names}) VALUES({', '.join('?' * (len(cols) + 1))})", [key, *cols.values()])


def days_ago(n):
    return fi._iso(fi._now() - fi.timedelta(days=n))


def sat_row(key=CELL_A, abnormal=1, pct=120.0, km2=3.0, conf="MEDIUM", observed=None, baseline_scenes=3):
    observed = observed or days_ago(1)
    la, lo = next((a, b) for a, b in wm.grid_points() if wm._key(a, b) == key)
    put("satellite_observations", key, latitude=la, longitude=lo, scene_id="S1X", observed_at=observed, method="Sentinel-1 VV backscatter threshold",
        water_area_km2=5.0, baseline_water_area_km2=2.0, expansion_area_km2=km2, expansion_percentage=pct, abnormal=abnormal, confidence=conf,
        baseline_scenes=baseline_scenes, source="Sentinel (test)", computed_at=observed)


def terrain_row(key=CELL_A, susc=80.0):
    la, lo = next((a, b) for a, b in wm.grid_points() if wm._key(a, b) == key)
    put("terrain_data", key, latitude=la, longitude=lo, elevation_m=880.0, slope_deg=0.8, relative_elevation_pct=10.0, concavity_m=-2.0,
        susceptibility=susc, source="DEM (test)", fetched_at=db.now())


def assess(key=CELL_A):
    with db.session() as c:
        return fi.assess_cell(c, key, zone="Zone A")


def sig(a, key):
    return next((s for s in a["signals"] if s["key"] == key), None)


# ===================================================================== weather accumulation
def test_rain_accumulations_from_the_hourly_series():
    hourly = [1.0] * 18 + [2.0, 2.0, 2.0, 3.0, 3.0, 4.0] + [9.9] + [5.0, 5.0, 6.0, 1.0, 1.0, 1.0]  # 24 past, current hour, 6 ahead
    a = accumulations(hourly)
    assert a["rain_1h_mm"] == 4.0 and a["rain_3h_mm"] == 10.0 and a["rain_6h_mm"] == 16.0 and a["rain_24h_mm"] == 34.0
    assert a["forecast_3h_mm"] == 16.0 and a["forecast_6h_mm"] == 19.0  # the current-hour value (9.9) is excluded from both


def test_accumulations_survive_missing_values():
    a = accumulations([None] * 24 + [None, 2.0])
    assert a["rain_24h_mm"] == 0.0 and a["rain_6h_mm"] == 0.0


def test_weather_cells_store_accumulations_and_expose_them(client):
    refresh(r1=2.0, r3=5.0, r6=9.0, r24=20.0, f3=4.0, f6=7.0)
    loc = anon().get("/weather/monitoring").json()["locations"][0]
    assert (loc["rain_1h_mm"], loc["rain_3h_mm"], loc["rain_6h_mm"], loc["rainfall_24h_mm"], loc["forecast_6h_mm"]) == (2.0, 5.0, 9.0, 20.0, 7.0)


# ===================================================================== satellite water change
def test_normal_water_is_not_a_flood():
    r = jobs.compare_water(0.050, [0.049, 0.051, 0.050], 80.0)   # a lake that is always there
    assert r["abnormal"] is False and r["expansion_area_km2"] < config.SAT_ABNORMAL_MIN_KM2


def test_abnormal_expansion_is_flagged_with_confidence():
    r = jobs.compare_water(0.080, [0.020, 0.021, 0.019], 80.0)
    assert r["abnormal"] is True and r["expansion_area_km2"] == pytest.approx(4.8, abs=0.1) and r["confidence"] == "HIGH"
    one = jobs.compare_water(0.080, [0.020], 80.0)
    assert one["abnormal"] is True and one["confidence"] == "LOW"  # a single baseline pass cannot give high confidence


def test_new_water_where_there_was_none_has_no_percentage():
    r = jobs.compare_water(0.02, [0.0, 0.0], 80.0)
    assert r["abnormal"] is True and r["expansion_percentage"] is None


def test_gain_must_exceed_every_baseline_pass():
    assert jobs.compare_water(0.050, [0.010, 0.060, 0.012], 80.0)["abnormal"] is False  # within the range seen before


class FakeSat(SatelliteProvider):
    def __init__(self, fractions, scenes=None, fail_for=()):
        self.fractions, self.fail_for, self.calls = fractions, set(fail_for), 0
        self.scenes = scenes or [
            SatelliteScene("cur", "SAR", "sentinel-1-rtc", "2026-10-08T00:40:00Z", "descending", 12, None, "Sentinel (fake)"),
            SatelliteScene("b1", "SAR", "sentinel-1-rtc", "2026-09-26T00:40:00Z", "descending", 12, None, "Sentinel (fake)"),
            SatelliteScene("b2", "SAR", "sentinel-1-rtc", "2026-09-14T00:40:00Z", "descending", 12, None, "Sentinel (fake)"),
            SatelliteScene("other", "SAR", "sentinel-1-rtc", "2026-09-20T00:40:00Z", "ascending", 99, None, "Sentinel (fake)"),
        ]

    def get_source_name(self):
        return "Sentinel (fake)"

    async def find_scenes(self, bbox, kind="SAR", limit=20):
        return [s for s in self.scenes if s.kind == kind]

    async def water_fraction(self, scene, bbox):
        self.calls += 1
        if scene.scene_id in self.fail_for:
            raise SatelliteUnavailable("boom")
        f = self.fractions[scene.scene_id]
        return WaterStat(fraction=f, valid_pixels=1000, method="Sentinel-1 VV backscatter threshold", threshold="VV < -16 dB")


def run_sat(p):
    return asyncio.run(jobs.refresh_satellite(p))


def test_satellite_refresh_compares_only_the_same_orbit_track(client):
    p = FakeSat({"cur": 0.08, "b1": 0.02, "b2": 0.021, "other": 0.5})   # the other-track scene must never be used
    out = run_sat(p)
    assert out["ok"]
    with db.session() as c:
        rows = c.execute("SELECT * FROM satellite_observations").fetchall()
    assert len(rows) == 25 and all(r["baseline_scenes"] == 2 and r["abnormal"] == 1 for r in rows)
    assert rows[0]["scene_id"] == "cur" and rows[0]["expansion_percentage"] > 100
    assert p.calls == 75  # 3 scenes x 25 cells; the other track was never queried


def test_scene_results_are_cached(client):
    p = FakeSat({"cur": 0.08, "b1": 0.02, "b2": 0.021, "other": 0.5})
    run_sat(p)
    first = p.calls
    run_sat(p)
    assert p.calls == first  # nothing is requested again for scenes already processed


def test_partial_provider_failure_is_reported_not_hidden(client):
    p = FakeSat({"cur": 0.08, "b1": 0.02, "b2": 0.021, "other": 0}, fail_for=["b2"])
    out = run_sat(p)
    assert out["ok"]
    st = next(s for s in jobs.provider_statuses() if s["name"] == "satellite")
    assert "request(s) failed" in st["detail"]
    with db.session() as c:
        assert c.execute("SELECT MAX(baseline_scenes) FROM satellite_observations").fetchone()[0] == 1


def test_satellite_outage_degrades_to_weather_only_risk(client):
    class Down(FakeSat):
        async def find_scenes(self, *a, **k):
            raise SatelliteUnavailable("service down")
    out = run_sat(Down({}))
    assert out["ok"] is False
    st = next(s for s in jobs.provider_statuses() if s["name"] == "satellite")
    assert st["state"] == "UNAVAILABLE" and "unavailable" in st["detail"].lower()
    refresh(r24=60.0)   # weather alone still produces a risk estimate
    a = assess()
    assert a["risk_level"] in ("MEDIUM", "HIGH") and any(m["key"] == "satellite" for m in a["missing"])
    body = anon().get("/satellite/observations").json()
    assert body["cells"] == [] and body["message"] == "Satellite data unavailable"


def test_no_earlier_pass_means_no_comparison(client):
    p = FakeSat({"cur": 0.08}, scenes=[SatelliteScene("cur", "SAR", "c", "2026-10-08T00:40:00Z", "descending", 12, None, "x")])
    assert run_sat(p)["ok"] is False
    with db.session() as c:
        assert c.execute("SELECT COUNT(*) FROM satellite_observations").fetchone()[0] == 0


def test_get_satellite_observation_returns_the_documented_shape():
    out = asyncio.run(jobs.get_satellite_observation(FakeSat({"cur": 0.08, "b1": 0.02, "b2": 0.021, "other": 0}), (77.5, 12.9, 77.6, 13.0)))
    assert set(out) >= {"area", "timestamp", "water_area", "baseline_water_area", "expansion_area", "expansion_percentage", "confidence", "source"}
    assert out["timestamp"].startswith("2026-10-08") and out["abnormal"] is True


# ===================================================================== terrain
def test_susceptibility_combines_height_flatness_and_depression():
    assert jobs.susceptibility(0.0, 0.0, -5.0) == 100.0
    assert jobs.susceptibility(100.0, 12.0, 3.0) == 0.0
    assert jobs.susceptibility(0.0, 0.0, 0.0) == 80.0   # low and flat but not a depression
    assert jobs.susceptibility(50.0, None, None) == pytest.approx(40.0)  # unknown slope is neutral, never extreme


class FakeTerrain:
    def get_source_name(self):
        return "DEM (fake)"

    async def get_terrain(self, points):
        return [TerrainPoint(900.0 + i * 3, 1.0 + (i % 5), -1.0) for i in range(len(points))]


def test_terrain_refresh_ranks_cells_and_is_cached(client):
    assert asyncio.run(jobs.refresh_terrain(FakeTerrain()))["ok"]
    with db.session() as c:
        rows = c.execute("SELECT * FROM terrain_data ORDER BY elevation_m").fetchall()
    assert len(rows) == 25 and rows[0]["relative_elevation_pct"] == 0.0 and rows[-1]["relative_elevation_pct"] == 100.0
    assert rows[0]["susceptibility"] > rows[-1]["susceptibility"]
    assert asyncio.run(jobs.refresh_terrain(FakeTerrain()))["cached"] is True


# ===================================================================== river level
def test_discharge_classification_is_relative_and_labelled():
    r = lambda cur, normal, mx=None: WaterReading("RIVER_DISCHARGE_MODEL", cur, normal, mx, "m3/s", "2026-10-08", "GloFAS")  # noqa: E731
    assert jobs.classify_discharge(r(1.0, 1.0))[1] == "NORMAL"
    assert jobs.classify_discharge(r(2.0, 1.0))[1] == "ELEVATED"
    assert jobs.classify_discharge(r(3.5, 1.0))[1] == "HIGH"
    assert jobs.classify_discharge(r(9.0, 5.0, 10.0))[1] == "HIGH"


class FakeWater:
    def __init__(self, cur, normal=1.0):
        self.cur, self.normal = cur, normal

    def get_source_name(self):
        return "GloFAS (fake)"

    async def get_levels(self, points):
        return [WaterReading("RIVER_DISCHARGE_MODEL", self.cur, self.normal, 10.0, "m3/s", "2026-10-08", "GloFAS (fake)") for _ in points]


def test_water_level_unavailable_is_stated_not_invented(client):
    out = asyncio.run(jobs.refresh_water_levels([GaugeWaterLevelProvider()]))
    assert out["ok"] is False
    body = anon().get("/water-levels").json()
    assert body["cells"] == [] and body["message"] == "Water-level data unavailable for this area." and body["gauges_connected"] is False
    refresh(r24=60.0)
    assert any(m["key"] == "river" and "unavailable" in m["reason"].lower() for m in assess()["missing"])


def test_elevated_river_adds_risk_and_is_labelled_modelled(client):
    refresh(r24=60.0)
    base = assess()["risk_score"]
    assert asyncio.run(jobs.refresh_water_levels([FakeWater(3.5)]))["ok"]
    a = assess()
    s = sig(a, "river")
    assert abs(a["risk_score"] - (base + 15)) <= 1 and "Modelled river discharge" in s["label"] and s["source"] == "GloFAS (fake)"
    assert "river" in a["families"]


def test_gauge_provider_is_preferred_when_it_has_data(client):
    class Gauge:
        def get_source_name(self):
            return "Gauge"

        async def get_levels(self, points):
            return [WaterReading("GAUGE_LEVEL", 4.0, 2.0, None, "m", "2026-10-08", "Gauge")] * len(points)
    asyncio.run(jobs.refresh_water_levels([Gauge(), FakeWater(1.0)]))
    with db.session() as c:
        assert c.execute("SELECT DISTINCT kind FROM water_level_observations").fetchall()[0][0] == "GAUGE_LEVEL"


# ===================================================================== climatology and history
class FakeClimate:
    def get_source_name(self):
        return "ERA5 (fake)"

    async def get_climatology(self, points):
        return [Climatology(30.0, 60.0, 120.0, 10, "ERA5 (fake)") for _ in points]


def test_rain_above_the_ten_year_extremes_adds_context(client):
    asyncio.run(jobs.refresh_climatology(FakeClimate()))
    refresh(r24=65.0)
    h = sig(assess(), "history")
    assert h["points"] == 6 and "above p99" in h["detail"]
    refresh(r24=35.0)
    assert sig(assess(), "history")["points"] == 3


def test_history_without_records_is_listed_as_missing(client):
    refresh(r24=40.0)
    assert any(m["key"] == "history" for m in assess()["missing"])


def test_recorded_floods_nearby_raise_susceptibility_only_while_raining(client):
    ev = [{"latitude": 12.99, "longitude": 77.62, "event_date": "2022-09-05", "source": "BBMP report (test)", "severity": 3}]
    assert client.post("/admin/historical-events", json=ev).status_code == 201
    refresh(r24=2.0)
    assert sig(assess(), "history")["points"] == 0   # dry: history alone proves nothing
    refresh(r24=40.0)
    h = sig(assess(), "history")
    assert h["points"] == 3 and "BBMP report (test)" in h["detail"]


def test_historical_events_need_a_source_and_an_admin(client):
    bad = [{"latitude": 12.9, "longitude": 77.5, "event_date": "2022-09-05"}]
    assert client.post("/admin/historical-events", json=bad).status_code == 422
    ok = [{"latitude": 12.9, "longitude": 77.5, "event_date": "2022-09-05", "source": "x report", "external_id": "e1"}]
    assert user_client().post("/admin/historical-events", json=ok).status_code == 403
    assert client.post("/admin/historical-events", json=ok).json()["added"] == 1
    assert client.post("/admin/historical-events", json=ok).json()["added"] == 0  # same external id is not added twice
    assert client.get("/admin/historical-events").json()["by_source"] == {"x report": 1}


def test_a_verified_flood_report_becomes_labelled_local_history(client):
    u = user_client()
    iid = u.post("/incidents", json={"type": "FLOOD", "latitude": 12.95, "longitude": 77.55}).json()["id"]
    client.post(f"/incidents/{iid}/verify")
    ev = client.get("/admin/historical-events").json()["events"]
    assert ev[0]["source"] == "RiskN ResQ verified community report" and "not an official flood record" in ev[0]["notes"]


# ===================================================================== scoring
def test_rainfall_alone_is_scored_and_explained(client):
    refresh(r1=12.0, r3=30.0, r6=50.0, r24=80.0)
    a = assess()
    assert a["risk_level"] in ("HIGH", "CRITICAL") and not a["insufficient"]
    assert sig(a, "rainfall")["source"] == "Open-Meteo" and "12 mm last hour" in sig(a, "rainfall")["detail"]
    assert a["model"].startswith("Prototype") and "rainfall" in a["reason"].lower() and a["reason"].startswith("Flood risk is elevated because")
    assert a["probability_basis"].startswith("Prototype estimate") and 0 < a["probability"] < 1


def test_short_intense_burst_counts_even_when_24h_total_is_small(client):
    refresh(r1=30.0, r24=30.0)
    assert sig(assess(), "rainfall")["points"] >= 60


def test_dry_weather_is_low_and_says_so(client):
    refresh(r24=0.0)
    a = assess()
    assert a["risk_level"] == "LOW" and a["reason"].startswith("No strong flood signals")


def test_satellite_is_additive_and_scaled_by_confidence(client):
    refresh(r24=40.0)
    base = assess()["risk_score"]
    sat_row(conf="HIGH", pct=150.0)
    hi = assess()
    sat_row(conf="LOW", pct=150.0)
    lo = assess()
    assert hi["risk_score"] > lo["risk_score"] > base and hi["satellite_abnormal"] is True
    assert "Abnormal surface-water expansion" in sig(hi, "satellite")["label"] and "Sentinel (test)" == sig(hi, "satellite")["source"]


def test_old_satellite_pass_is_not_used(client):
    refresh(r24=40.0)
    base = assess()["risk_score"]
    sat_row(observed=days_ago(30))
    a = assess()
    assert a["risk_score"] == base and sig(a, "satellite")["stale"] is True and a["satellite_abnormal"] is False


def test_normal_satellite_result_adds_nothing(client):
    refresh(r24=40.0)
    base = assess()["risk_score"]
    sat_row(abnormal=0, km2=0.0, pct=3.0)
    a = assess()
    assert a["risk_score"] == base and sig(a, "satellite")["label"] == "No abnormal water expansion"


def test_terrain_amplifies_rain_but_never_proves_flooding(client):
    terrain_row(susc=90.0)
    refresh(r24=2.0)
    dry = assess()
    assert dry["risk_level"] == "LOW" and sig(dry, "terrain")["points"] == 0 and "counts only while it is raining" in sig(dry, "terrain")["detail"]
    refresh(r24=40.0)
    wet = assess()
    assert sig(wet, "terrain")["points"] == 11 and "Susceptibility, not proof of flooding" in sig(wet, "terrain")["detail"]


def test_missing_signals_are_listed_and_do_not_count(client):
    refresh(r24=40.0)
    a = assess()
    assert {m["key"] for m in a["missing"]} == {"satellite", "terrain", "river", "history"}
    assert a["risk_score"] == sig(a, "rainfall")["points"]


def test_reports_are_secondary_and_cannot_reach_high_alone(client):
    refresh(r24=0.0)
    u = user_client()
    for i in range(6):   # several distinct trusted-looking reports in the cell, no rain at all
        r = u.post("/incidents", json={"type": "FLOOD", "latitude": 12.99 + i * 0.004, "longitude": 77.62, "severity": 5}).json()
        client.post(f"/incidents/{r['id']}/verify")
    a = assess()
    assert sig(a, "reports")["points"] <= fi.REPORT_CAP and a["risk_score"] <= 49 and a["risk_level"] in ("LOW", "MEDIUM")


def test_one_unverified_report_does_not_declare_a_flood(client):
    refresh(r24=0.0)
    user_client().post("/incidents", json={"type": "FLOOD", "latitude": 12.99, "longitude": 77.62, "severity": 5})
    assert assess()["risk_level"] == "LOW"


def test_reports_add_to_real_environmental_evidence(client):
    refresh(r24=40.0)
    base = assess()["risk_score"]
    u = user_client()
    r = u.post("/incidents", json={"type": "FLOOD", "latitude": 12.99, "longitude": 77.62, "severity": 4}).json()
    client.post(f"/incidents/{r['id']}/verify")
    assert assess()["risk_score"] > base


def test_stale_weather_is_flagged_then_treated_as_unavailable(client):
    refresh(r24=80.0)
    with db.session() as c:
        c.execute("UPDATE environment_data SET updated_at=? WHERE zone=?", (fi._iso(fi._now() - fi.timedelta(minutes=config.WEATHER_REFRESH_INTERVAL / 60 * 4)), CELL_A))
    assert assess()["weather_stale"] is True and sig(assess(), "rainfall")["stale"] is True
    with db.session() as c:
        c.execute("UPDATE environment_data SET updated_at=? WHERE zone=?", (fi._iso(fi._now() - fi.timedelta(hours=6)), CELL_A))
    a = assess()
    assert a["insufficient"] is True and a["reason"] == "Insufficient data to estimate current flood risk." and a["risk_level"] is None
    assert any(m["key"] == "rainfall" for m in a["missing"])


def test_no_environmental_data_says_insufficient_not_low(client):
    with db.session() as c:
        z = fi.assess_cell(c, "grid:0,0", zone="Zone A")
    assert z["insufficient"] and z["risk_level"] is None and z["probability"] is None
    body = anon().get("/flood-risk/Zone A").json()
    assert body["insufficient"] is True and body["reason"] == "Insufficient data to estimate current flood risk."


@pytest.mark.parametrize("score,level", [(10, "LOW"), (25, "MEDIUM"), (50, "HIGH"), (75, "CRITICAL")])
def test_risk_thresholds(score, level):
    from engine import level_for
    assert level_for(score) == level


def test_probability_is_monotonic_and_labelled_uncalibrated():
    ps = [fi.probability_from_score(s) for s in (0, 25, 50, 75, 100)]
    assert ps == sorted(ps) and ps[0] < 0.05 and ps[-1] > 0.95
    refresh(r24=10.0)
    assert "uncalibrated" in assess()["probability_basis"]


# ===================================================================== hotspots
def test_hotspot_needs_high_risk_and_two_independent_signals(client):
    refresh(r24=80.0)            # heavy rain only: HIGH risk but a single signal family
    with db.session() as c:
        assert fi.recompute_all(c)["hotspots"] == 0
    sat_row(conf="MEDIUM")       # a second, independent family
    with db.session() as c:
        assert fi.recompute_all(c)["hotspots"] >= 1
    h = anon().get("/flood-hotspots").json()["hotspots"]
    spot = next(x for x in h if x["cell"] == CELL_A)
    assert spot["status"] == "POTENTIAL FLOOD HOTSPOT" and "not a confirmed flood" in spot["note"] and spot["radius_km"] > 0
    assert {"rainfall", "satellite"} <= {s["key"] for s in spot["signals"]} and spot["sources"]


def test_hotspot_clears_when_conditions_ease(client):
    refresh(r24=80.0)
    sat_row()
    with db.session() as c:
        fi.recompute_all(c)
    refresh(r24=0.0)
    assert [h for h in anon().get("/flood-hotspots").json()["hotspots"] if h["cell"] == CELL_A] == []


# ===================================================================== automatic alerts
def alerts_for(zone="Zone A"):
    return [a for a in anon().get("/alerts?active_only=true").json() if a["affected_zone"] == zone]


def test_alert_comes_from_environmental_evidence_without_any_report(client):
    refresh(r1=15.0, r6=50.0, r24=90.0)
    a = alerts_for()[0]
    assert a["severity"] in ("HIGH", "CRITICAL") and a["source"] == "ENGINE" and a["recommended_action"] and a["sources"]
    assert "Flood risk is elevated because" in a["reason"] and a["probability"] and a["simulated"] is False and a["created_at"]


def test_satellite_water_expansion_alone_gives_a_medium_heads_up_that_says_it_is_an_observation(client):
    refresh(r24=5.0)
    assert alerts_for() == []
    sat_row(conf="MEDIUM")
    with db.session() as c:
        fi.recompute_all(c)
    a = alerts_for()[0]
    assert a["severity"] == "MEDIUM" and "not confirmation of flooding" in a["message"] and "Satellite-detected water expansion" in a["message"]


def test_an_old_satellite_pass_with_no_rain_does_not_alert(client):
    refresh(r24=1.0)
    sat_row(conf="HIGH", observed=days_ago(9))
    with db.session() as c:
        fi.recompute_all(c)
    assert alerts_for() == []
    refresh(r24=15.0)   # once it is actually raining, the earlier water gain becomes relevant
    assert alerts_for() and alerts_for()[0]["severity"] == "MEDIUM"


def test_a_low_confidence_satellite_signal_does_not_alert(client):
    refresh(r24=5.0)
    sat_row(conf="LOW")
    with db.session() as c:
        fi.recompute_all(c)
    assert alerts_for() == []


def test_alert_clears_when_the_evidence_goes_away(client):
    refresh(r24=90.0)
    assert alerts_for()
    refresh(r24=0.0)
    assert alerts_for() == []


def test_drills_stay_labelled_and_never_overwrite_real_observations(client):
    refresh(r24=3.0)
    client.post("/simulate-hazard", json={"rainfall": 120, "zone": "Zone A"})
    a = alerts_for()[0]
    assert a["simulated"] is True and a["message"].startswith("SIMULATED DRILL")
    with db.session() as c:
        cell = c.execute("SELECT rainfall_24h, data_source FROM environment_data WHERE zone=?", (CELL_A,)).fetchone()
    assert cell["rainfall_24h"] == 3.0 and cell["data_source"] == "Open-Meteo"   # the real reading is untouched
    risk = anon().get("/flood-risk/Zone A").json()
    assert risk["mode"] == "SIMULATED DRILL"
    refresh(r24=3.0)   # a real refresh must not wipe the admin's drill
    assert alerts_for() and alerts_for()[0]["simulated"] is True


# ===================================================================== history
def test_risk_history_records_changes_in_order(client):
    refresh(r24=0.0)
    refresh(r24=90.0)
    h = anon().get("/risk-history", params={"zone": "Zone A", "hours": 1}).json()["history"]
    assert [x["risk_level"] for x in h][0] == "LOW" and h[-1]["risk_level"] in ("HIGH", "CRITICAL")
    assert all(x["zone"] == "Zone A" for x in h) and h[-1]["active_alerts"] >= 1
    assert anon().get("/risk-history", params={"zone": "Nowhere"}).status_code == 404


# ===================================================================== road risk
def add_road(name, pts, status="AVAILABLE", low=0):
    with db.session() as c:
        c.execute("INSERT INTO roads(name, coordinates, status, source, low_lying) VALUES(?,?,?,'OSM',?)", (name, json.dumps(pts), status, low))
        return c.execute("SELECT MAX(id) FROM roads").fetchone()[0]


def states():
    return {r["name"]: r for r in anon().get("/road-risk").json()["roads"]}


def test_road_states_open_potential_reported_and_verified(client):
    inside = [[12.985, 77.61], [12.995, 77.63]]      # in the Zone A cell
    far = [[12.835, 77.455], [12.84, 77.46]]         # in a quiet cell
    add_road("Inside Rd", inside)
    add_road("Far Rd", far)
    refresh(r24=0.0)
    assert states()["Inside Rd"]["state"] == "OPEN"
    refresh(r24=0.0, over={CELL_A: {"r1": 12.0, "r6": 50.0, "r24": 90.0}})   # heavy rain in this one cell only
    st = states()
    assert st["Inside Rd"]["state"] == "POTENTIALLY_AFFECTED" and "area-level estimate" in " ".join(st["Inside Rd"]["reasons"]).lower()
    assert st["Far Rd"]["state"] == "OPEN"                        # high risk elsewhere does not mark it
    u = user_client()
    inc = u.post("/incidents", json={"type": "BLOCKED_ROAD", "latitude": 12.99, "longitude": 77.62, "severity": 4}).json()
    assert states()["Inside Rd"]["state"] == "REPORTED_BLOCKED"
    client.post(f"/incidents/{inc['id']}/verify")
    assert states()["Inside Rd"]["state"] == "VERIFIED_BLOCKED"


def test_high_risk_alone_never_blocks_a_road(client):
    add_road("Only Risk", [[12.985, 77.61], [12.995, 77.63]])
    refresh(r24=120.0)
    assert states()["Only Risk"]["state"] == "POTENTIALLY_AFFECTED"


def test_admin_closure_is_verified_blocked_and_visible_on_the_roads_list(client):
    rid = add_road("Closed Rd", [[12.835, 77.455], [12.84, 77.46]])
    client.post(f"/roads/{rid}/block")
    assert states()["Closed Rd"]["state"] == "VERIFIED_BLOCKED"
    row = next(r for r in anon().get("/roads").json() if r["id"] == rid)
    assert row["risk_state"] == "VERIFIED_BLOCKED" and "Closed by an administrator" in row["risk_reasons"]


def test_low_lying_road_is_flagged_earlier(client):
    add_road("Dip Rd", [[12.985, 77.61], [12.995, 77.63]], low=1)
    refresh(r24=35.0)   # MEDIUM risk: enough only for a low-lying road
    assert states()["Dip Rd"]["state"] == "POTENTIALLY_AFFECTED"


# ===================================================================== risk-aware routing
class FakeRouting:
    def __init__(self, cands):
        self.cands = cands

    def get_source_name(self):
        return "fake"

    async def compute_routes(self, o, d):
        return self.cands


def cand(lat, dur, lng0=77.45, lng1=77.79, name="route"):
    pts = [[lat, lng0 + (lng1 - lng0) * i / 20.0] for i in range(21)]
    return RouteCandidate(polyline=pts, distance_meters=int(dur * 10), duration_seconds=dur, eta_minutes=max(1, dur // 60), summary=name, source="fake")


def plan(cands):
    import routing_service
    with db.session() as c:
        return asyncio.run(routing_service.plan_route(c, FakeRouting(cands), RoutePoint(latitude=12.9, longitude=77.45), RoutePoint(latitude=12.9, longitude=77.79)))


def set_scores(row_lat, score, level):
    with db.session() as c:
        c.execute("UPDATE flood_risk_predictions SET risk_score=?, risk_level=?, insufficient=0 WHERE ABS(latitude-?) < 0.001", (score, level, row_lat))


def test_routing_prefers_lower_flood_exposure_over_a_slightly_shorter_route(client):
    refresh(r24=0.0)
    set_scores(12.91, 80, "CRITICAL")
    set_scores(12.83, 10, "LOW")
    out = plan([cand(12.91, 1000, name="short but flooded"), cand(12.83, 1100, name="longer, drier")])
    assert out["success"] and out["summary"] == "longer, drier"
    assert out["risk_information"]["mean_risk_score"] == 10.0 and "lowest combined travel time and flood-risk exposure" in out["reason"]
    assert out["safetyNote"] == "Recommended alternative route based on current environmental and incident data."
    assert "safe" not in out["safetyNote"].lower() and set(out) >= {"recommended_route", "distance_km", "eta_minutes", "avoided_roads", "risk_information", "reason"}


def test_routing_keeps_the_faster_route_when_the_risk_is_equal(client):
    refresh(r24=0.0)
    out = plan([cand(12.91, 1000, name="fast"), cand(12.83, 1100, name="slow")])
    assert out["summary"] == "fast"


def test_blocked_roads_are_excluded_even_when_they_are_faster(client):
    refresh(r24=0.0)
    rid = add_road("Blocked Ring Rd", [[12.91, 77.45], [12.91, 77.79]])
    client.post(f"/roads/{rid}/block")
    out = plan([cand(12.91, 600, name="through the closure"), cand(12.83, 900, name="detour")])
    assert out["summary"] == "detour" and out["avoided_roads"] == ["Blocked Ring Rd"]


def test_reported_blocked_roads_are_avoided_too(client):
    refresh(r24=0.0)
    add_road("Reported Rd", [[12.91, 77.50], [12.91, 77.60]])
    u = user_client()
    u.post("/incidents", json={"type": "BLOCKED_ROAD", "latitude": 12.91, "longitude": 77.55, "severity": 4})
    out = plan([cand(12.91, 600, name="direct"), cand(12.83, 900, name="detour")])
    assert out["summary"] == "detour"


def test_when_every_route_is_blocked_it_says_so(client):
    refresh(r24=0.0)
    for lat in (12.91, 12.83):
        rid = add_road(f"Closed {lat}", [[lat, 77.45], [lat, 77.79]])
        client.post(f"/roads/{rid}/block")
    out = plan([cand(12.91, 600), cand(12.83, 900)])
    assert out["success"] and "Every available route crosses a blocked road" in out["reason"]


def test_potentially_affected_roads_add_cost_but_are_not_excluded(client):
    refresh(r24=0.0)
    add_road("Risky Rd", [[12.91, 77.45], [12.91, 77.79]])
    set_scores(12.91, 55, "HIGH")
    out = plan([cand(12.91, 1000, name="via risky"), cand(12.83, 1150, name="clear")])
    assert out["summary"] == "clear"
    out2 = plan([cand(12.91, 1000, name="only option")])
    assert out2["summary"] == "only option" and out2["risk_information"]["potentially_affected_roads_on_route"] == ["Risky Rd"]


def test_routing_without_risk_data_still_works_and_says_so(client):
    out = plan([cand(12.91, 600, name="a")])
    assert out["success"] and out["risk_information"]["mean_risk_score"] is None and "unavailable" in out["reason"].lower()


def test_a_long_straight_route_segment_cannot_slip_past_a_closed_road(client):
    """A route with vertices only at its two ends (as routing engines produce on straight highways) crosses the closed road."""
    refresh(r24=0.0)
    rid = add_road("Cross St", [[12.90, 77.60], [12.92, 77.60]])
    client.post(f"/roads/{rid}/block")
    straight = RouteCandidate(polyline=[[12.91, 77.50], [12.91, 77.70]], distance_meters=22000, duration_seconds=600, eta_minutes=10, summary="two vertices", source="fake")
    detour = RouteCandidate(polyline=[[12.83, 77.50], [12.83, 77.70]], distance_meters=22500, duration_seconds=900, eta_minutes=15, summary="detour", source="fake")
    out = plan([straight, detour])
    assert out["summary"] == "detour" and out["avoided_roads"] == ["Cross St"]


def test_densify_keeps_every_gap_small():
    import road_risk
    from engine import haversine_meters
    pts = road_risk.densify([[12.9, 77.5], [12.9, 77.6]], 25.0)
    assert len(pts) > 400 and max(haversine_meters(a[0], a[1], b[0], b[1]) for a, b in zip(pts, pts[1:])) <= 26.0
    assert pts[0] == [12.9, 77.5] and pts[-1] == [12.9, 77.6]


def test_route_endpoint_still_requires_login(client):
    r = anon().post("/routes/compute", json={"origin": {"latitude": 12.9, "longitude": 77.5}, "destination": {"latitude": 12.95, "longitude": 77.6}})
    assert r.status_code == 401


# ===================================================================== incident confidence
def test_report_confidence_reflects_environmental_evidence(client):
    u = user_client()
    refresh(r24=0.0)
    quiet = u.post("/incidents", json={"type": "FLOOD", "latitude": 12.99, "longitude": 77.62}).json()
    q_labels = [f["label"] for f in client.get(f"/incidents/{quiet['id']}").json()["trust_factors"]]
    assert "No heavy rain or satellite evidence in this area at the moment" in q_labels
    assert quiet["environmental_context"] == ["No heavy rain or satellite evidence in this area at the moment"]
    client.post("/reset")
    refresh(r1=10.0, r6=40.0, r24=70.0)
    sat_row()
    terrain_row()
    loud = u.post("/incidents", json={"type": "FLOOD", "latitude": 12.99, "longitude": 77.62}).json()
    labels = [f["label"] for f in client.get(f"/incidents/{loud['id']}").json()["trust_factors"]]
    assert {"Heavy rainfall recorded in this area", "Satellite shows abnormal water expansion here", "Location is low-lying, flood-susceptible ground"} <= set(labels)
    assert loud["trust_score"] > quiet["trust_score"] and len(loud["environmental_context"]) == 3


# ===================================================================== API and honesty
def test_flood_risk_endpoints_have_documented_shapes(client):
    refresh(r24=60.0)
    z = anon().get("/flood-risk/Zone A").json()
    assert set(z) >= {"zone", "risk_score", "risk_level", "probability", "reason", "signals", "missing", "sources", "model", "recommended_action"}
    allz = anon().get("/flood-risk").json()
    assert len(allz["zones"]) == 3 and allz["overall"]["risk_score"] >= 0
    p = anon().get("/flood-risk", params={"latitude": 12.99, "longitude": 77.62}).json()
    assert p["cell"] == CELL_A and p["explanation"]
    out = anon().get("/flood-risk", params={"latitude": 40.0, "longitude": 10.0}).json()
    assert out["insufficient"] is True and "outside the monitored area" in out["reason"]
    cells = anon().get("/flood-risk/cells").json()
    assert len(cells["cells"]) == 25 and cells["cell_size_km"]["lat"] > 5 and "half_deg" in cells
    assert anon().get("/flood-risk/Nowhere").status_code == 404


def test_overview_summarises_the_zone_risk_history_for_users(client):
    refresh(r24=0.0)
    refresh(r24=90.0)
    h = anon().get("/intelligence/overview", params={"latitude": 12.9716, "longitude": 77.5946}).json()["risk_history"]
    assert h["zone"] == "Zone A" and [s["risk_level"] for s in h["steps"]][0] == "LOW" and h["steps"][-1]["risk_level"] in ("HIGH", "CRITICAL")
    assert anon().get("/intelligence/overview").json()["risk_history"] is None


def test_overview_is_one_cached_read_with_provider_status(client):
    refresh(r24=60.0)
    o = anon().get("/intelligence/overview", params={"latitude": 12.99, "longitude": 77.62}).json()
    assert o["location"]["cell"] == CELL_A and len(o["cells"]) == 25 and [p["name"] for p in o["providers"]] == list(jobs.PROVIDERS)
    assert o["model"].startswith("Prototype")


def test_sync_uses_the_cache_and_never_calls_the_weather_service(client, monkeypatch):
    refresh(r24=60.0)
    import main

    class Boom:
        async def get_weather(self, *a, **k):
            raise AssertionError("a phone request must not call the weather provider")
    monkeypatch.setattr(main, "weather_provider", Boom())
    s = user_client().get("/sync", params={"latitude": 12.99, "longitude": 77.62}).json()
    assert s["weather"]["cached"] is True and s["risk"]["mode"] == "LIVE" and s["risk"]["signals"] and s["risk"]["insufficient"] is False
    assert all(i["user_id"] is None and "photo_file" not in i and "photo_url" not in i for i in s["incidents"])


def test_sync_outside_the_grid_labels_its_live_fallback(client, monkeypatch):
    import main

    class Live:
        def get_source_name(self):
            return "Open-Meteo"

        async def get_weather(self, la, lo):
            return WeatherObservation(source="Open-Meteo", station="x", latitude=la, longitude=lo, rainfall_24h_mm=10, rainfall_intensity_mm_per_hour=1, observed_at="2026-10-08T12:00:00")
    monkeypatch.setattr(main, "weather_provider", Live())
    s = user_client().get("/sync", params={"latitude": 40.0, "longitude": 10.0}).json()
    assert s["weather"]["cached"] is False and s["risk"]["mode"] == "LIVE (direct weather query)"


def test_sync_with_no_data_at_all_says_insufficient(client, monkeypatch):
    import main

    class Dead:
        async def get_weather(self, *a, **k):
            raise RuntimeError("down")
    monkeypatch.setattr(main, "weather_provider", Dead())
    s = user_client().get("/sync", params={"latitude": 40.0, "longitude": 10.0}).json()
    assert s["risk"]["insufficient"] is True and s["risk"]["reason"] == "Insufficient data to estimate current flood risk." and s["weather"] is None


def test_provider_status_page_is_admin_only_and_honest(client):
    assert user_client().get("/admin/providers").status_code == 403
    body = client.get("/admin/providers").json()
    assert {p["name"]: p["state"] for p in body["providers"]} == {n: "NOT_RUN" for n in jobs.PROVIDERS}
    refresh(r24=10.0)
    asyncio.run(jobs.refresh_water_levels([GaugeWaterLevelProvider()]))
    states_ = {p["name"]: p for p in client.get("/admin/providers").json()["providers"]}
    assert states_["weather"]["state"] == "OK" and states_["water_level"]["state"] == "UNAVAILABLE"
    assert states_["water_level"]["detail"] == "Water-level data unavailable for this area."


def test_a_provider_that_has_not_succeeded_recently_is_stale(client):
    jobs.set_status("weather", True, detail="x")
    with db.session() as c:
        c.execute("UPDATE provider_status SET last_success=? WHERE name='weather'", (fi._iso(fi._now() - fi.timedelta(hours=5)),))
    assert next(p for p in jobs.provider_statuses() if p["name"] == "weather")["state"] == "STALE"


def test_weather_failure_keeps_stale_data_and_reports_it(client):
    refresh(r24=60.0)

    class Down(RainProvider):
        async def get_weather_grid(self, points):
            raise RuntimeError("down")
    asyncio.run(wm.refresh(Down()))
    st = next(p for p in jobs.provider_statuses() if p["name"] == "weather")
    assert st["last_error"] and "stale" in st["detail"].lower()
    assert assess()["risk_score"] > 0   # the last real reading is kept, not replaced by a fake


def test_admin_can_refresh_jobs_and_failures_are_reported(client):
    import main
    r = client.post("/admin/intelligence/refresh", json={"jobs": ["climatology"]})
    assert r.status_code == 200
    assert user_client().post("/admin/intelligence/refresh", json={"jobs": []}).status_code == 403
    assert "results" in r.json() and len(r.json()["providers"]) == 5


def test_terrain_water_and_satellite_endpoints_say_unavailable_when_empty(client):
    assert anon().get("/terrain").json()["message"] == "Terrain data unavailable"
    assert anon().get("/water-levels").json()["message"] == "Water-level data unavailable for this area."
    assert anon().get("/satellite/observations").json()["message"] == "Satellite data unavailable"
    assert anon().get("/satellite/water-expansion").json()["abnormal_cells"] == []


def test_water_expansion_endpoint_lists_only_fresh_abnormal_cells(client):
    refresh(r24=0.0)
    sat_row()
    sat_row(wm._key(12.83, 77.45), observed=days_ago(60))
    body = anon().get("/satellite/water-expansion").json()
    assert [c["cell"] for c in body["abnormal_cells"]] == [CELL_A] and body["stale_abnormal_cells"] == 1
    assert "does not confirm a flood" in body["note"]


# ===================================================================== evacuation, resources, positioning, ML
def test_evacuation_points_are_called_designated_not_safe(client):
    client.post("/admin/places", json={"kind": "SHELTER", "name": "Community Hall", "latitude": 12.97, "longitude": 77.60})
    client.post("/admin/places", json={"kind": "HOSPITAL", "name": "City Hospital", "latitude": 12.98, "longitude": 77.61})
    import routes_intel
    routes_intel.routing_provider = FakeRouting([cand(12.9716, 600, 77.5946, 77.60)])
    u = user_client()
    out = u.get("/evacuation/nearest", params={"latitude": 12.9716, "longitude": 77.5946}).json()
    assert out["label"] == "Designated evacuation point" and out["points"][0]["name"] == "Community Hall" and out["route"]["success"]
    assert "not verified safe" in out["note"] and "safe route" not in out["route"]["safetyNote"].lower()
    assert anon().get("/evacuation/nearest", params={"latitude": 12.97, "longitude": 77.59}).status_code == 401


def test_evacuation_without_loaded_places_says_so(client):
    out = user_client().get("/evacuation/nearest", params={"latitude": 12.97, "longitude": 77.59}).json()
    assert out["points"] == [] and "No designated evacuation points" in out["message"]


def test_resource_quantities_are_tracked_and_decrease_on_completion(client):
    v, vol = (lambda r: (r[0], r[1]))(__import__("tests.test_auth", fromlist=["volunteer_client"]).volunteer_client(client, latitude=12.9716, longitude=77.5946))
    assert client.put(f"/volunteers/{vol['id']}", json={"quantities": {"MEDICINE": 10}}).json()["quantities"] == {"MEDICINE": 10}
    assert client.put(f"/volunteers/{vol['id']}", json={"quantities": {"MEDICINE": -1}}).status_code == 422
    assert client.put(f"/volunteers/{vol['id']}", json={"quantities": {"UNICORNS": 1}}).status_code == 422
    u = user_client()
    u.post("/help-requests", json={"type": "MEDICINE", "quantity": 4, "latitude": 12.9716, "longitude": 77.5946})
    mid = v.get("/volunteers/me/requests").json()["assigned"][0]
    assert mid["quantity"] == 4
    v.post(f"/matches/{mid['match_id']}/accept")
    v.post(f"/matches/{mid['match_id']}/complete")
    assert client.get("/volunteers").json()[-1]["quantities"] == {"MEDICINE": 6}
    res = {r["type"]: r for r in client.get("/admin/resources").json()["resources"]}
    assert res["MEDICINE"]["quantity_on_hand"] == 6 and res["FOOD"]["open_requests"] == 0


def test_volunteer_positioning_is_a_suggestion_not_a_dispatch(client):
    refresh(r24=90.0)
    make_volunteer(client, latitude=12.9716, longitude=77.5946)
    z = next(x for x in client.get("/admin/positioning").json()["zones"] if x["zone"] == "Zone A")
    assert z["volunteers_within_2km"] >= 1 and "nothing is dispatched automatically" in z["note"].lower() and "volunteer" in z["suggestion"]
    assert user_client().get("/admin/positioning").status_code == 403


def test_ml_is_honestly_not_trained_without_real_labelled_history(client):
    st = client.get("/admin/ml/status").json()
    assert st["status"] == "not_trained" and "insufficient real labelled data" in (st["reason"] or "") or not st["scikit_learn_installed"]
    out = client.post("/admin/ml/train").json()
    assert out["trained"] is False and out["status"] == "not_trained"
    assert "accuracy" not in json.dumps(out).lower().replace("no accuracy is claimed", "")
    refresh(r24=20.0)
    assert assess()["probability_basis"].startswith("Prototype estimate")


def test_ml_pipeline_mechanics_on_synthetic_rows():
    """MECHANICS ONLY: synthetic rows are used here, in a test, to prove the training and prediction code runs. The shipped
    system never trains on synthetic data and reports no accuracy unless it was measured on real held-out history."""
    pytest.importorskip("sklearn")
    import random
    from datetime import datetime, timedelta, timezone
    random.seed(3)
    t0 = datetime.now(timezone.utc) - timedelta(days=30)
    positives = [t0 + timedelta(hours=25 * k + 24) for k in range(16)]   # a verified flood every 25 h
    with db.session() as c:
        for i in range(400):
            at_dt = t0 + timedelta(hours=i)
            label = any(timedelta(0) <= p - at_dt <= timedelta(hours=ml_model.LABEL_WINDOW_H) for p in positives)
            feats = {"rain_1h": 20 if label else 1, "rain_3h": 40 if label else 2, "rain_6h": 60 if label else 4, "rain_24h": 90 if label else 8,
                     "satellite_abnormal": int(label), "susceptibility": 70 + random.random() * 10}
            c.execute("INSERT INTO risk_history(at, zone, rainfall_24h, risk_score, risk_level, features, source) VALUES(?,?,?,?,?,?,?)",
                      (at_dt.isoformat(timespec="seconds"), "Zone A", 1, 10, "LOW", json.dumps(feats), "Open-Meteo"))
        for p in positives:
            c.execute("INSERT INTO incidents(type,latitude,longitude,status,zone,timestamp,updated_at) VALUES('FLOOD',12.9,77.5,'VERIFIED','Zone A',?,?)",
                      (p.isoformat(timespec="seconds"), p.isoformat(timespec="seconds")))
        out = ml_model.train(c)
    assert out["trained"] is True and out["holdout_metrics"]["holdout_rows"] > 0
    p, basis = ml_model.predict({"rain_1h": 20, "rain_3h": 40, "rain_6h": 60, "rain_24h": 90, "satellite_abnormal": 1, "susceptibility": 75}, 70)
    assert p > 0.5 and basis.startswith("Trained model")
    ml_model.MODEL_PATH.unlink(missing_ok=True)
    ml_model.reset_cache()


def test_risk_reports_data_confidence_freshness_and_rain_figures(client):
    refresh(r24=60.0)
    p = anon().get("/flood-risk", params={"latitude": 12.99, "longitude": 77.62}).json()
    assert p["confidence"] in ("HIGH", "MEDIUM", "LOW") and "not a calibrated probability" in p["confidence_basis"]
    assert p["computed_at"] and p["features"]["rain_24h"] == 60.0
    s = anon().get("/sync", params={"latitude": 12.99, "longitude": 77.62}).json()["risk"]
    assert s["confidence"] == p["confidence"] and s["recommended_action"] and s["rain_1h_mm"] is not None and "forecast_3h_mm" in s
    assert s["computed_at"] and s["weather_stale"] is False


def test_data_confidence_falls_when_signals_are_missing_or_stale():
    sig = lambda k, stale=False: {"key": k, "points": 0, "stale": stale}  # noqa: E731
    full = [sig(k) for k in fi.CORE_FAMILIES]
    assert fi.data_confidence(full, [], False, 0, "LOW")[0] == "HIGH"
    assert fi.data_confidence(full[:3], [], False, 0, "LOW")[0] == "MEDIUM"
    assert fi.data_confidence(full[:2], [], False, 0, "LOW")[0] == "LOW"
    assert fi.data_confidence(full, [], True, 0, "LOW")[0] == "LOW"                 # stale weather is never high confidence
    assert fi.data_confidence(full, [], False, 1, "HIGH")[0] == "MEDIUM"            # one signal alone does not make an elevated estimate high-confidence


def test_satellite_imagery_catalogue_is_honest_about_dates(monkeypatch):
    import imagery
    xml = ("<Layer><ows:Identifier>VIIRS_SNPP_CorrectedReflectance_TrueColor</ows:Identifier><Default>2026-10-08</Default></Layer>"
           "<Layer><ows:Identifier>OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1</ows:Identifier><Default>2026-10-07</Default></Layer>")
    assert imagery.parse_latest_dates(xml, ["VIIRS_SNPP_CorrectedReflectance_TrueColor", "OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1", "Missing"]) == \
        {"VIIRS_SNPP_CorrectedReflectance_TrueColor": "2026-10-08", "OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1": "2026-10-07"}
    monkeypatch.setattr(imagery, "_ensure_fresh", lambda: None)  # no network in tests
    monkeypatch.setitem(imagery._state, "dates", {"VIIRS_SNPP_CorrectedReflectance_TrueColor": "2026-10-08"})
    monkeypatch.setitem(imagery._state, "fetched_at", 1.0)
    monkeypatch.setitem(imagery._state, "error", None)
    c = anon().get("/satellite/imagery").json()
    by = {l["id"]: l for l in c["layers"]}
    assert set(by) == {"satellite", "today", "nasa_flood", "radar_water"}
    assert by["satellite"]["live"] is False and "not live" in by["satellite"]["note"]        # the high-res basemap is never called live
    assert by["today"]["date"] == "2026-10-08" and "{z}/{y}/{x}" in by["today"]["url"] and by["today"]["max_native_zoom"] == 9
    assert by["radar_water"]["date"] is None and by["nasa_flood"]["legend"][0]["label"] == "Flood"   # unknown dates stay unknown
    assert "not a live video feed" in c["note"]


# ------------------------------------------------------------- conservative multi-signal rules and evidence tiers
def test_rain_on_low_ground_alone_is_held_at_high_never_critical():
    refresh(r1=40.0, r3=90.0, r6=150.0, r24=220.0)
    terrain_row(susc=90.0)
    a = assess()
    assert a["risk_level"] == "HIGH" and a["risk_score"] == 74 and a["capped_at_high"] is True
    assert any("Held at HIGH" in e for e in a["explanation"])
    assert a["evidence_tier"] == "HIGH FLOOD RISK"                       # rain + low ground: high risk, not "flooding"


def test_independent_water_evidence_allows_critical_and_the_top_tier():
    refresh(r1=40.0, r3=90.0, r6=150.0, r24=220.0)
    terrain_row(susc=90.0)
    sat_row(conf="HIGH", pct=150.0)
    a = assess()
    assert a["risk_level"] == "CRITICAL" and a["capped_at_high"] is False
    assert a["evidence_tier"] == "CRITICAL FLOOD RISK" and "including direct evidence of water" in a["evidence_tier_note"]


def test_evidence_tiers_need_independent_signals():
    assert fi.evidence_tier("LOW", set(), False) == "NORMAL"
    assert fi.evidence_tier("CRITICAL", {"rainfall"}, False) == "OBSERVATION"          # one kind of evidence is only an observation
    assert fi.evidence_tier("MEDIUM", {"rainfall", "satellite"}, True) == "POSSIBLE FLOODING"
    assert fi.evidence_tier("MEDIUM", {"rainfall", "terrain"}, False) == "OBSERVATION"  # terrain is susceptibility, not water
    assert fi.evidence_tier("HIGH", {"rainfall", "terrain"}, False) == "HIGH FLOOD RISK"
    assert fi.evidence_tier("CRITICAL", {"rainfall", "terrain", "history"}, False) == "HIGH FLOOD RISK"   # no direct water evidence
    assert all("confirmed" not in n.lower() or "not" in n.lower() for n in fi.TIER_NOTE.values())


def test_place_search_and_names_go_through_the_backend(monkeypatch):
    import httpx
    import geocode
    calls = []

    def handler(request):
        calls.append(request.url.path)
        assert "RiskN-ResQ" in request.headers["user-agent"]                       # Nominatim policy: identify the app
        if request.url.path == "/search":
            return httpx.Response(200, json=[
                {"lat": "12.9352", "lon": "77.6245", "name": "Koramangala", "display_name": "Koramangala, Bengaluru", "address": {"city": "Bengaluru"}},
                {"lat": "19.07", "lon": "72.87", "name": "Koramangala Lane", "display_name": "Mumbai", "address": {"city": "Mumbai"}}])
        return httpx.Response(200, json={"name": "MG Road", "address": {"suburb": "Shivajinagar"}})

    monkeypatch.setattr(geocode, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(geocode, "_cache", {})
    monkeypatch.setattr(geocode, "_last", [0.0])
    u = user_client("geo@test.local")
    r = u.get("/geocode/search", params={"q": "Koramangala"}).json()["results"]
    assert r[0]["name"] == "Koramangala, Bengaluru" and r[0]["inside_monitored_area"] is True and r[1]["inside_monitored_area"] is False
    u.get("/geocode/search", params={"q": "koramangala"})                          # cached: no second request
    assert calls.count("/search") == 1
    assert u.get("/geocode/reverse", params={"latitude": 12.975, "longitude": 77.605}).json()["name"] == "MG Road, Shivajinagar"
    assert anon().get("/geocode/search", params={"q": "x"}).status_code == 401


class ViaRouting(FakeRouting):
    """A router that can also detour through a waypoint (like OSRM)."""
    supports_via = True

    def __init__(self, cands, detour):
        super().__init__(cands)
        self.detour, self.vias = detour, []

    async def compute_routes(self, o, d, via=None):
        if via:
            self.vias.append(via[0])
            return [self.detour] if len(self.vias) == 1 else []
        return self.cands


def test_detours_are_requested_when_the_only_route_crosses_danger_and_compared_with_the_fastest(client):
    import routing_service
    refresh(r24=0.0)
    rid = add_road("Flooded Ring Rd", [[12.91, 77.45], [12.91, 77.79]])
    client.post(f"/roads/{rid}/block")
    router = ViaRouting([cand(12.91, 600, name="direct")], cand(12.83, 800, name="around"))
    with db.session() as c:
        out = asyncio.run(routing_service.plan_route(c, router, RoutePoint(latitude=12.9, longitude=77.45), RoutePoint(latitude=12.9, longitude=77.79)))
    assert len(router.vias) == 2                                                      # one waypoint on each side of the trip
    assert out["summary"].startswith("Detour") and out["candidates_considered"] == 2
    assert out["fastest"]["summary"] == "direct" and out["fastest"]["blocked_roads"] == ["Flooded Ring Rd"]
    assert "+3 min compared with the fastest route" in out["comparison"] and "avoids Flooded Ring Rd" in out["comparison"]
    assert out["risk_segments"] and all(len(s["points"]) > 1 for s in out["risk_segments"])
    assert "safe" not in (out["reason"] + out["safetyNote"]).lower()


def test_no_detours_when_there_are_enough_clear_routes(client):
    import routing_service
    refresh(r24=0.0)
    router = ViaRouting([cand(12.91, 600), cand(12.87, 650), cand(12.83, 700)], cand(12.95, 900))
    with db.session() as c:
        asyncio.run(routing_service.plan_route(c, router, RoutePoint(latitude=12.9, longitude=77.45), RoutePoint(latitude=12.9, longitude=77.79)))
    assert router.vias == []


def test_route_risk_segments_follow_the_cell_levels(client):
    import routing_service
    refresh(r24=0.0)
    set_scores(12.91, 80, "CRITICAL")
    out = plan([cand(12.91, 600, name="through the flood")])
    levels = {s["level"] for s in out["risk_segments"]}
    assert "CRITICAL" in levels
