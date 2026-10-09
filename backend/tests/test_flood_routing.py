"""Satellite flood analysis and hazard-aware routing. External services (Planetary Computer, Earth Engine, OSRM) are always
mocked here; live checks belong in separately configured integration runs."""
import asyncio
import base64
import io
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth  # noqa: E402
import config  # noqa: E402
import db  # noqa: E402
import flood_analysis as fa  # noqa: E402
import geo  # noqa: E402
import main  # noqa: E402
import routes_flood  # noqa: E402
import safe_route  # noqa: E402
from providers.routing.base import RouteCandidate  # noqa: E402
from providers.routing.osrm import directions  # noqa: E402

ADMIN = {"email": "admin@test.local", "password": "Adm1n-test-pass"}
PW = "Str0ng-pass-1"
BBOX = (77.50, 12.90, 77.60, 13.00)


def iso(days_ago=0.0):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat(timespec="seconds")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN["email"])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN["password"])
    auth.reset_login_throttle()
    routes_flood._hits.clear()
    with TestClient(main.app) as c:
        r = c.post("/auth/login", json=ADMIN)
        c.headers["Authorization"] = f"Bearer {r.json()['token']}"
        yield c


def user_headers(c, email="rider@test.local"):
    c.post("/auth/register", json={"name": "Rider", "email": email, "password": PW, "confirm_password": PW})
    r = c.post("/auth/login", json={"email": email, "password": PW})
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ================================================================ detection maths
def test_new_water_needs_dark_now_not_dark_before_and_a_real_drop():
    after = np.array([[-22.0, -22.0, -10.0, -22.0, np.nan]])
    before = np.array([[-8.0, -21.0, -8.0, -17.5, -8.0]])
    m = fa.detect_new_water(after, before, change_db=-3)
    # new water | dark before too (existing water) | still bright | crossed the threshold with a 4.5 dB drop | no data
    assert m.tolist() == [[True, False, False, True, False]]


def test_steep_slopes_are_masked():
    after, before = np.full((1, 2), -22.0), np.full((1, 2), -8.0)
    m = fa.detect_new_water(after, before, slope_deg=np.array([[1.0, 12.0]]), change_db=-3, max_slope=5)
    assert m.tolist() == [[True, False]]


def test_median_filter_removes_single_speckle_pixel():
    a = np.full((5, 5), -8.0)
    a[2, 2] = -25.0
    assert fa.median3(a)[2, 2] == -8.0


def test_vectorised_area_matches_the_ground_area():
    mask = np.zeros((100, 100), bool)
    mask[10:30, 10:30] = True  # 20 x 20 pixels of a 100 x 100 raster over BBOX -> 4% of its area
    g = fa.mask_to_geometry(mask, BBOX)
    whole = geo.area_km2(geo.bbox_polygon(*BBOX))
    assert abs(geo.area_km2(g) - whole * 0.04) < whole * 0.04 * 0.02


def test_postprocess_removes_permanent_water_and_small_patches():
    aoi = geo.bbox_polygon(*BBOX)
    flood = geo.union([geo.bbox_polygon(77.52, 12.92, 77.54, 12.94), geo.bbox_polygon(77.58, 12.98, 77.5801, 12.9801)])
    lake = geo.bbox_polygon(77.52, 12.92, 77.53, 12.94)  # half of the big patch is a permanent lake
    out = fa.postprocess(flood, aoi, lake, min_area_m2=20000)
    assert len(out["features"]) == 1 and out["dropped_small"] == 1
    half = geo.area_km2(geo.bbox_polygon(77.53, 12.92, 77.54, 12.94))
    assert abs(out["flooded_km2"] - half) < 0.01
    assert out["permanent_water_km2"] > 0
    f = out["features"][0]["properties"]
    assert f["kind"] == "SATELLITE_DETECTED_INUNDATION" and f["label"].startswith("Potential")
    assert "confirmed" not in f["label"].lower()


def test_quality_is_never_high_and_explains_itself():
    raw = fa.RawResult(engine="x", source="s", method="m", after_scenes=["a"], after_acquired=iso(1), baseline_dates=["d"],
                       flood=geo.union([]), permanent_water=None, valid_fraction=0.6, pixel_size_m=50, thresholds={}, urban_fraction=0.5)
    q = fa.quality(raw, 1, 1)
    assert q["grade"] == "LOW" and len(q["reasons"]) == 4
    raw.permanent_water, raw.valid_fraction, raw.urban_fraction = geo.union([]), 0.95, 0.1
    assert fa.quality(raw, 3, 1)["grade"] == "MODERATE"


# ================================================================ Planetary Computer engine (mocked)
def scene(id, day, orbit=("descending", 165)):
    return {"id": id, "properties": {"datetime": f"{day}T00:39:45Z", "sat:orbit_state": orbit[0], "sat:relative_orbit": orbit[1]}}


class FakePC(fa.PlanetaryEngine):
    """Planetary Computer with chosen scenes and rasters (linear VV)."""

    def __init__(self, scenes, rasters=None, fail=None):
        self.scenes, self.rasters, self.fail, self.calls = scenes, rasters or {}, fail, []

    async def search(self, collection, bbox, start, end, limit=100):
        if self.fail == "search":
            raise RuntimeError("down")
        if collection == fa.PC_S1:
            return self.scenes
        if collection == "jrc-gsw":
            return [{"id": "jrc", "properties": {}}]
        if collection == "esa-worldcover":
            return [{"id": "wc", "properties": {"datetime": "2021-01-01T00:00:00Z"}}]
        return [{"id": "dem", "properties": {}}]

    async def array(self, collection, item, asset, bbox, size):
        self.calls.append(item)
        shape = (size[1], size[0])
        if item in self.rasters:
            v = self.rasters[item](shape)
        elif collection == "jrc-gsw":
            v = np.zeros(shape)
            v[:5, :5] = 12  # a permanent lake in the corner
        elif collection == "esa-worldcover":
            v = np.full(shape, 10.0)
        elif collection == "cop-dem-glo-30":
            v = np.full(shape, 900.0)
        else:
            v = np.full(shape, 0.15)  # about -8 dB: dry ground
        return v.astype("float32"), np.ones(shape, bool)


def flooded(shape):
    v = np.full(shape, 0.15)
    v[40:80, 40:80] = 0.004   # about -24 dB: new water
    v[:5, :5] = 0.004         # the permanent lake, dark in every pass
    return v


def lake_only(shape):
    v = np.full(shape, 0.15)
    v[:5, :5] = 0.004
    return v


@pytest.fixture()
def small_grid(monkeypatch):
    monkeypatch.setattr(config, "FLOOD_ANALYSIS_PIXELS", 160)


def test_engine_detects_new_water_and_ignores_the_permanent_lake(small_grid):
    eng = FakePC([scene("A", "2026-09-27"), scene("B1", "2026-09-15"), scene("B2", "2026-09-03"), scene("X", "2026-09-20", ("ascending", 63))],
                 {"A": flooded, "B1": lake_only, "B2": lake_only})
    raw = asyncio.run(eng.run(fa.Request(bbox=BBOX)))
    assert raw.after_scenes == ["A"] and raw.baseline_dates == ["2026-09-15", "2026-09-03"]  # other track never used
    assert "X" not in eng.calls
    out = fa.postprocess(raw.flood, geo.bbox_polygon(*BBOX), raw.permanent_water)
    expected = geo.area_km2(geo.bbox_polygon(*BBOX)) * (40 * 40) / (160 * raw_rows(BBOX))
    assert len(out["features"]) == 1 and abs(out["flooded_km2"] - expected) < expected * 0.05


def raw_rows(bbox):
    return fa._grid(bbox)[1]


def test_no_change_means_zero_area_not_an_invented_flood(small_grid):
    eng = FakePC([scene("A", "2026-09-27"), scene("B1", "2026-09-15")], {"A": lake_only, "B1": lake_only})
    raw = asyncio.run(eng.run(fa.Request(bbox=BBOX)))
    assert fa.postprocess(raw.flood, geo.bbox_polygon(*BBOX), raw.permanent_water)["flooded_km2"] == 0


@pytest.mark.parametrize("scenes,fail,status", [
    ([], None, fa.INSUFFICIENT_DATA),                                                         # no imagery at all
    ([scene("A", "2026-09-27"), scene("Y", "2026-09-15", ("ascending", 63))], None, fa.INSUFFICIENT_DATA),  # no same-track baseline
    ([scene("A", "2026-09-27"), scene("B", "2026-09-24")], None, fa.INSUFFICIENT_DATA),       # baseline too close to compare
    ([scene("A", "2026-09-27")], "search", fa.UNAVAILABLE),                                   # service down
])
def test_missing_imagery_ends_with_an_explicit_status(small_grid, scenes, fail, status):
    with pytest.raises(fa.AnalysisStop) as e:
        asyncio.run(FakePC(scenes, fail=fail).run(fa.Request(bbox=BBOX)))
    assert e.value.status == status


def test_execute_stores_results_and_failures():
    db.init_db()
    good = FakePC([scene("A", (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()),
                   scene("B", (datetime.now(timezone.utc) - timedelta(days=13)).date().isoformat())], {"A": flooded, "B": lake_only})
    with db.session() as c:
        aid = fa.create(c, fa.Request(bbox=BBOX), None, "test")
    asyncio.run(fa.execute(aid, good))
    with db.session() as c:
        res = fa.result_dict(c.execute("SELECT * FROM flood_analyses WHERE id=?", (aid,)).fetchone())
    assert res["status"] == "COMPLETED" and res["newly_inundated_km2"] > 0 and res["official"] is False and res["live"] is False
    assert res["geojson"]["features"] and res["baseline_observation_date"] and not res["stale"] and res["limitations"]
    with db.session() as c:
        aid2 = fa.create(c, fa.Request(bbox=BBOX), None, "test")
    asyncio.run(fa.execute(aid2, FakePC([])))
    with db.session() as c:
        st = fa.status_dict(c.execute("SELECT * FROM flood_analyses WHERE id=?", (aid2,)).fetchone())
    assert st["status"] == fa.INSUFFICIENT_DATA and "No Sentinel-1 pass" in st["message"]


def test_old_satellite_pass_is_marked_stale():
    db.init_db()
    with db.session() as c:
        aid = fa.create(c, fa.Request(bbox=BBOX), None, "test")
        c.execute("UPDATE flood_analyses SET status='COMPLETED', acquired_at=?, polygons=?, quality='{}', warnings='[]' WHERE id=?",
                  (iso(20), json.dumps({"type": "FeatureCollection", "features": []}), aid))
        res = fa.result_dict(c.execute("SELECT * FROM flood_analyses WHERE id=?", (aid,)).fetchone())
    assert res["stale"] and res["warnings"][0].startswith("This satellite pass is 20 days old")


def test_earth_engine_is_optional_and_reads_base64_keys(monkeypatch):
    monkeypatch.setattr(config, "GEE_SERVICE_ACCOUNT_JSON", "")
    monkeypatch.setattr(config, "FLOOD_ANALYSIS_ENGINE", "auto")
    assert fa.pick_engine().name == "planetary" and not fa.engine_status()["earth_engine_configured"]
    key = json.dumps({"client_email": "svc@proj.iam.gserviceaccount.com", "private_key": "-----BEGIN PRIVATE KEY-----x"})
    monkeypatch.setattr(config, "GEE_SERVICE_ACCOUNT_JSON", base64.b64encode(key.encode()).decode())
    monkeypatch.setattr(config, "GEE_PROJECT", "proj")
    assert fa.gee_credentials()["client_email"].startswith("svc@") and fa.pick_engine().name == "earth-engine"
    monkeypatch.setattr(config, "GEE_SERVICE_ACCOUNT_JSON", "not-json")
    assert fa.gee_credentials() is None


def test_earth_engine_failure_is_reported_not_faked(monkeypatch):
    eng = fa.EarthEngineEngine()
    monkeypatch.setattr(eng, "_compute", lambda req: (_ for _ in ()).throw(RuntimeError("quota")))
    with pytest.raises(fa.AnalysisStop) as e:
        asyncio.run(eng.run(fa.Request(bbox=BBOX)))
    assert e.value.status == fa.UNAVAILABLE


# ================================================================ analysis API
def test_analysis_api_permissions_and_validation(client, monkeypatch):
    async def nothing(aid, engine=None):
        return None
    monkeypatch.setattr(fa, "execute", nothing)
    u = user_headers(client)
    assert client.post("/flood-analysis/run", json={}, headers=u).status_code == 403
    assert TestClient(main.app).get("/flood-analysis/latest").status_code == 401
    assert client.post("/flood-analysis/run", json={"bbox": [77, 12, 78.5, 13]}).status_code == 422  # too large
    assert client.post("/flood-analysis/run", json={"baseline_start": "2026-01-01"}).status_code == 422
    r = client.post("/flood-analysis/run", json={"bbox": list(BBOX)})
    assert r.status_code == 202 and r.json()["status"] == "QUEUED"
    assert client.post("/flood-analysis/run", json={"bbox": list(BBOX)}).status_code == 409  # one at a time
    assert client.get(f"/flood-analysis/status/{r.json()['analysis_id']}", headers=u).json()["status"] == "QUEUED"
    assert client.get("/flood-analysis/results/999").status_code == 404
    latest = client.get("/flood-analysis/latest", headers=u).json()
    assert latest["available"] is False and latest["last_attempt"]["status"] == "QUEUED"


def test_recent_identical_analysis_is_reused(client):
    with db.session() as c:
        aid = fa.create(c, fa.Request(bbox=BBOX), None, "test")
        c.execute("UPDATE flood_analyses SET status='COMPLETED', finished_at=?, acquired_at=? WHERE id=?", (iso(0), iso(1), aid))
    r = client.post("/flood-analysis/run", json={"bbox": list(BBOX)}).json()
    assert r["reused"] and r["analysis_id"] == aid


# ================================================================ routing
O = {"latitude": 12.95, "longitude": 77.55}
D = {"latitude": 12.95, "longitude": 77.60}
NORTH = [[12.95, 77.55], [12.97, 77.56], [12.97, 77.59], [12.95, 77.60]]
DIRECT = [[12.95, 77.55], [12.95, 77.575], [12.95, 77.60]]
SOUTH = [[12.95, 77.55], [12.93, 77.56], [12.93, 77.59], [12.95, 77.60]]


def cand(points, minutes, summary):
    return RouteCandidate(polyline=points, distance_meters=int(geo.projection_for(12.95, 77.57).to_m(geo.line_from_latlng(points)).length),
                          duration_seconds=minutes * 60, eta_minutes=minutes, summary=summary, source="Fake router",
                          steps=[{"instruction": "Head east", "distance_m": 100, "duration_s": 10, "road": None, "location": points[0]}])


class FakeRouter:
    supports_via = True

    def __init__(self, routes, via_routes=None, error=None):
        self.routes, self.via_routes, self.error, self.calls = routes, via_routes or [], error, 0

    async def compute_routes(self, origin, destination, via=None):
        self.calls += 1
        if self.error:
            raise self.error
        if via:
            return [self.via_routes.pop(0)] if self.via_routes else []
        return list(self.routes)


def satellite_flood(poly, days_old=1):
    with db.session() as c:
        aid = fa.create(c, fa.Request(bbox=BBOX), None, "test")
        fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": geo.to_geojson(poly),
                                                         "properties": {"id": "sat-1", "area_km2": 0.5, "kind": "SATELLITE_DETECTED_INUNDATION", "label": fa.DETECTION_LABEL}}]}
        c.execute("UPDATE flood_analyses SET status='COMPLETED', finished_at=?, acquired_at=?, polygons=?, quality=?, warnings='[]', source='test', "
                  "engine='planetary' WHERE id=?", (iso(0), iso(days_old), json.dumps(fc), json.dumps({"grade": "MODERATE"}), aid))
    return aid


def weather_cells():
    """Weather-based predictions covering the trip at LOW risk (so the area counts as checked)."""
    with db.session() as c:
        c.execute("DELETE FROM flood_risk_predictions")
        for i, lng in enumerate((77.53, 77.61)):
            c.execute("INSERT INTO flood_risk_predictions(cell, latitude, longitude, risk_score, risk_level, insufficient, computed_at) VALUES(?,?,?,?,?,0,?)",
                      (f"t{i}", 12.95, lng, 10, "LOW", iso(0)))


def plan(router):
    routes_flood.routing_provider = router
    return router


def test_route_through_satellite_flood_is_not_recommended(client):
    plan(FakeRouter([cand(DIRECT, 10, "Direct"), cand(NORTH, 14, "North")]))
    satellite_flood(geo.bbox_polygon(77.57, 12.945, 77.58, 12.955))  # sits on the direct road only
    weather_cells()
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D}).json()
    assert r["status"] == "RECOMMENDED"
    rec = next(x for x in r["routes"] if x["recommended"])
    assert rec["summary"] == "North" and rec["hazard_intersections"] == [] and rec["steps"]
    direct = next(x for x in r["routes"] if x["summary"] == "Direct")
    hit = direct["hazard_intersections"][0]
    assert not direct["feasible"] and hit["kind"] == "SATELLITE_INUNDATION" and 900 < hit["length_m"] < 1200  # ~1.08 km inside
    assert "avoids hazards" in r["selection_reason"] and "+4 min" in r["selection_reason"]
    assert any(h["kind"] == "SATELLITE_INUNDATION" for h in r["hazards"]) and "safe" not in rec["label"].lower()


def test_route_avoiding_all_polygons_is_still_not_called_safe(client):
    plan(FakeRouter([cand(DIRECT, 10, "Direct")], via_routes=[cand(NORTH, 14, "N")]))
    weather_cells()
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D}).json()
    assert r["status"] == "RECOMMENDED" and r["routes"][0]["summary"] == "Direct"
    assert "no hazard currently known" in r["selection_reason"] and any("cannot guarantee any route" in x for x in r["limitations"])
    assert "safe route" not in json.dumps(r).lower()


def test_alternatives_rank_by_exposure_then_time(client):
    plan(FakeRouter([cand(DIRECT, 10, "Direct"), cand(NORTH, 14, "North"), cand(SOUTH, 13, "South")]))
    weather_cells()
    # an older (AVOID-class) satellite detection on the south road, a fresh (EXCLUDE) one on the direct road
    satellite_flood(geo.bbox_polygon(77.57, 12.925, 77.58, 12.935), days_old=5)
    satellite_flood(geo.bbox_polygon(77.57, 12.945, 77.58, 12.955), days_old=1)
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D}).json()
    # only the newest analysis is used: the fresh one; south is clear and faster than north
    assert [x["summary"] for x in r["routes"]][:2] == ["South", "North"]
    assert r["routes"][-1]["summary"] == "Direct" and not r["routes"][-1]["feasible"]


def test_lower_confidence_hazard_exposure_beats_speed(client):
    plan(FakeRouter([cand(DIRECT, 10, "Direct"), cand(NORTH, 14, "North")]))
    weather_cells()
    satellite_flood(geo.bbox_polygon(77.57, 12.945, 77.58, 12.955), days_old=6)  # AVOID class: not excluded, but ranked lower
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D}).json()
    assert r["routes"][0]["summary"] == "North" and r["routes"][1]["feasible"] and r["routes"][1]["exposure"]["avoid_hazard_m"] > 0


def test_every_route_affected_gives_no_recommendation(client):
    plan(FakeRouter([cand(DIRECT, 10, "Direct"), cand(NORTH, 14, "North")]))
    weather_cells()
    satellite_flood(geo.bbox_polygon(77.551, 12.90, 77.553, 13.00))  # a band across every road out of the origin
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D}).json()
    assert r["status"] == "ALL_ROUTES_AFFECTED" and r["recommended_route_id"] is None
    assert r["least_exposed_route_id"] and not any(x["recommended"] for x in r["routes"])
    assert "No route is recommended" in r["selection_reason"] and "Every route" in r["warnings"][0]


def test_hazard_detours_are_requested_when_routes_cross_hazards(client):
    router = plan(FakeRouter([cand(DIRECT, 10, "Direct"), cand(SOUTH, 13, "South")], via_routes=[cand(NORTH, 15, "via")]))
    weather_cells()
    satellite_flood(geo.union([geo.bbox_polygon(77.57, 12.945, 77.58, 12.955), geo.bbox_polygon(77.57, 12.925, 77.58, 12.935)]))
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D}).json()
    rec = next(x for x in r["routes"] if x["recommended"])
    assert router.calls > 1 and rec["summary"] == "Detour around a reported hazard"


def test_missing_hazard_data_is_stated(client):
    plan(FakeRouter([cand(DIRECT, 10, "Direct")]))
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D}).json()
    assert r["status"] == "NOT_CHECKED" and any("could not be fully checked" in w for w in r["warnings"])
    assert r["data_coverage"]["satellite"]["status"] == "NONE"


def test_stale_satellite_data_is_not_used_but_reported(client):
    plan(FakeRouter([cand(DIRECT, 10, "Direct")]))
    weather_cells()
    satellite_flood(geo.bbox_polygon(77.57, 12.945, 77.58, 12.955), days_old=30)
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D}).json()
    assert r["routes"][0]["feasible"] and r["data_coverage"]["satellite"]["status"] == "STALE"
    assert any("Satellite layer" in w for w in r["warnings"])


def test_verified_report_on_route_is_avoided(client):
    plan(FakeRouter([cand(DIRECT, 10, "Direct"), cand(NORTH, 14, "North")]))
    weather_cells()
    inc = client.post("/incidents", json={"type": "FLOODED_ROAD", "latitude": 12.95, "longitude": 77.575}).json()
    client.post(f"/incidents/{inc.get('id') or inc['incident']['id']}/verify")
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D}).json()
    assert next(x for x in r["routes"] if x["recommended"])["summary"] == "North"


@pytest.mark.parametrize("body", [
    {"origin": {"latitude": 100, "longitude": 77.5}, "destination": D},
    {"origin": O},
    {"origin": O, "destination": D, "extra": 1},
    {"origin": O, "destination": O},
    {"origin": O, "destination": {"latitude": 19.07, "longitude": 72.87}},  # Mumbai: not a local trip
])
def test_invalid_origin_or_destination(client, body):
    plan(FakeRouter([cand(DIRECT, 10, "Direct")]))
    assert client.post("/routes/safe-route", json=body).status_code == 422


def test_routing_failures_and_rate_limits(client):
    import httpx
    plan(FakeRouter([], error=RuntimeError("boom")))
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D})
    assert r.status_code == 503 and "unavailable" in r.json()["detail"]
    resp = httpx.Response(429, request=httpx.Request("GET", "https://router"))
    plan(FakeRouter([], error=httpx.HTTPStatusError("429", request=resp.request, response=resp)))
    r = client.post("/routes/safe-route", json={"origin": O, "destination": D})
    assert r.status_code == 503 and r.headers.get("retry-after") == "60"
    plan(FakeRouter([]))
    assert client.post("/routes/safe-route", json={"origin": O, "destination": D}).status_code == 404
    codes = [client.post("/routes/safe-route", json={"origin": O, "destination": D}).status_code for _ in range(12)]
    assert codes[-1] == 429


def test_routing_requires_sign_in(client):
    anon = TestClient(main.app)
    assert anon.post("/routes/safe-route", json={"origin": O, "destination": D}).status_code == 401
    assert anon.post("/routes/reassess", json={"geometry": DIRECT}).status_code == 401


def test_reassess_flags_only_new_hazards_and_offers_a_choice(client):
    plan(FakeRouter([cand(DIRECT, 10, "Direct"), cand(NORTH, 14, "North")]))
    weather_cells()
    quiet = client.post("/routes/reassess", json={"geometry": DIRECT}).json()
    assert quiet["affected"] is False
    satellite_flood(geo.bbox_polygon(77.57, 12.945, 77.58, 12.955))
    r = client.post("/routes/reassess", json={"geometry": DIRECT, "current_position": O, "destination": D}).json()
    assert r["affected"] and r["new_intersections"][0]["kind"] == "SATELLITE_INUNDATION"
    assert r["suggestion"]["routes"][0]["summary"] == "North" and "Review the new route" in r["message"]
    known = [h["hazard_id"] for h in r["hazard_intersections"]]
    assert client.post("/routes/reassess", json={"geometry": DIRECT, "known_hazard_ids": known}).json()["affected"] is False
    assert client.post("/routes/reassess", json={"geometry": [[95, 1], [0, 0]]}).status_code == 422


def test_osrm_steps_become_plain_directions():
    legs = [{"steps": [
        {"maneuver": {"type": "depart", "bearing_after": 90, "location": [77.5, 12.9]}, "name": "MG Road", "distance": 200, "duration": 30},
        {"maneuver": {"type": "continue", "location": [77.51, 12.9]}, "name": "MG Road", "distance": 100, "duration": 10},
        {"maneuver": {"type": "turn", "modifier": "left", "location": [77.52, 12.9]}, "name": "Brigade Road", "distance": 300, "duration": 40},
        {"maneuver": {"type": "roundabout", "exit": 2, "location": [77.53, 12.9]}, "name": "", "distance": 50, "duration": 8},
        {"maneuver": {"type": "arrive", "location": [77.54, 12.9]}, "name": "", "distance": 0, "duration": 0}]}]
    steps = directions(legs)
    assert [s["instruction"] for s in steps] == ["Head east on MG Road", "Turn left onto Brigade Road", "At the roundabout, take exit 2",
                                                 "Arrive at your destination"]
    assert steps[0]["distance_m"] == 300 and steps[1]["location"] == [12.9, 77.52]
