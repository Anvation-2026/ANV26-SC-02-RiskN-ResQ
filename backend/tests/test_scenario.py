"""The complete disaster scenario in ONE test, each stage checked to feed the next (not just that a screen exists):
normal -> heavy rain -> risk HIGH -> alert -> satellite water change -> hotspot -> road potentially affected -> road blocked ->
alternative route -> help request -> volunteer match -> accept -> complete -> admin sees the whole history.
Environmental inputs come through the real ingestion path with fake providers; nothing touches the network."""
import asyncio
import json

import db
import flood_intel as fi
from tests.test_api import client  # noqa: F401  (client = signed-in admin)
from tests.test_auth import anon, user_client, volunteer_client
from tests.test_intelligence import (CELL_A, FakeRouting, RainProvider, add_road, cand, days_ago, plan, refresh, sat_row, states, terrain_row)
import pytest

HERE = {"latitude": 12.9716, "longitude": 77.5946}


@pytest.fixture(autouse=True)
def _tables():
    db.init_db(reset=False)


def zone_a():
    return anon().get("/flood-risk/Zone A").json()


def test_full_disaster_scenario(client):
    admin = client
    user = user_client("citizen@test.local")
    vol, vol_row = volunteer_client(admin, latitude=12.9716, longitude=77.5946)
    # a road inside the Zone A cell, one far away, and the data the engine can use besides rain
    add_road("Hosur Main Rd", [[12.985, 77.61], [12.995, 77.63]])
    add_road("Outer Ring Rd", [[12.835, 77.455], [12.84, 77.46]])
    terrain_row(CELL_A, susc=85.0)

    # 1. NORMAL: dry weather -> LOW, no alert, roads open, no hotspot
    refresh(r24=1.0)
    assert zone_a()["risk_level"] == "LOW" and not zone_a()["insufficient"]
    assert anon().get("/alerts?active_only=true").json() == []
    assert states()["Hosur Main Rd"]["state"] == "OPEN" and anon().get("/flood-hotspots").json()["hotspots"] == []
    home = user.get("/sync", params=HERE).json()
    assert home["risk"]["risk_level"] == "LOW" and home["weather"]["cached"] is True

    # 2. HEAVY RAINFALL in that area (real ingestion path): accumulations feed the score, the risk rises
    refresh(r24=1.0, over={CELL_A: {"r1": 14.0, "r3": 36.0, "r6": 60.0, "r24": 95.0, "f3": 20.0, "f6": 30.0}})
    z = zone_a()
    assert z["risk_level"] in ("HIGH", "CRITICAL") and z["risk_score"] >= 50
    rain = next(s for s in z["signals"] if s["key"] == "rainfall")
    assert "14 mm last hour" in rain["detail"] and "60 mm in 6 h" in rain["detail"] and rain["source"] == "Open-Meteo"
    assert any(s["key"] == "terrain" and s["points"] > 0 for s in z["signals"])        # terrain amplifies because it is raining
    assert z["probability"] is not None and z["probability_basis"].startswith("Prototype")
    assert "Flood risk is elevated because" in z["reason"]

    # 3. ALERT: raised automatically from environmental evidence, with reason, sources and action (no user report involved)
    alert = next(a for a in anon().get("/alerts?active_only=true").json() if a["affected_zone"] == "Zone A")
    assert alert["severity"] == z["risk_level"] and alert["source"] == "ENGINE" and not alert["simulated"]
    assert alert["recommended_action"] and alert["sources"] and "Flood risk is elevated" in alert["reason"]

    # 4. SATELLITE WATER CHANGE arrives (fresh pass, abnormal expansion): it adds to the score and is labelled an observation
    sat_row(CELL_A, conf="HIGH", pct=140.0, observed=days_ago(1))
    with db.session() as c:
        fi.recompute_all(c)
    z2 = zone_a()
    assert z2["risk_score"] >= z["risk_score"]
    s = next(x for x in z2["signals"] if x["key"] == "satellite")
    assert s["points"] > 0 and s["label"] == "Abnormal surface-water expansion"

    # 5. HOTSPOT: HIGH risk + two or more independent signals -> a potential hotspot (not a confirmed flood)
    spots = anon().get("/flood-hotspots").json()["hotspots"]
    spot = next(h for h in spots if h["cell"] == CELL_A)
    assert {"rainfall", "satellite"} <= {x["key"] for x in spot["signals"]} and spot["status"] == "POTENTIAL FLOOD HOTSPOT"

    # 6. ROAD POTENTIALLY AFFECTED (not blocked), the far road stays open
    st = states()
    assert st["Hosur Main Rd"]["state"] == "POTENTIALLY_AFFECTED" and st["Outer Ring Rd"]["state"] == "OPEN"

    # 7. ROAD BLOCKED by an administrator -> verified blocked
    rid = next(r["id"] for r in anon().get("/roads").json() if r["name"] == "Hosur Main Rd")
    assert admin.post(f"/roads/{rid}/block").status_code == 200
    assert states()["Hosur Main Rd"]["state"] == "VERIFIED_BLOCKED"

    # 8. ALTERNATIVE ROUTE avoids the blocked road, reports it, and never calls itself safe
    route = plan([cand(12.99, 600, name="through the closure", lng0=77.60, lng1=77.64), cand(12.83, 900, name="detour", lng0=77.60, lng1=77.64)])
    assert route["success"] and route["summary"] == "detour" and route["avoided_roads"] == ["Hosur Main Rd"]
    assert route["distance_km"] > 0 and route["eta_minutes"] > 0 and route["reason"]
    assert "safe" not in route["safetyNote"].lower() and "current environmental and incident data" in route["safetyNote"]

    # 9. USER REQUESTS HELP -> 10. VOLUNTEER MATCHED (same matching algorithm as before)
    req = user.post("/help-requests", json={"type": "MEDICINE", "priority": "HIGH", "quantity": 2, **HERE}).json()
    assert req["match"]["matched"] is True and req["match"]["volunteer"]["name"] == vol_row["name"]
    rid_h = req["requestId"]

    # 11. VOLUNTEER ACCEPTS -> 12. completes; the user sees the live status and the timeline
    mine = vol.get("/volunteers/me/requests").json()["assigned"][0]
    assert mine["request_id"] == rid_h and mine["quantity"] == 2
    assert vol.post(f"/matches/{mine['match_id']}/accept").status_code == 200
    t = user.get(f"/help-requests/{rid_h}/tracking").json()
    assert t["match_status"] == "ACCEPTED" and t["volunteer"]["eta_minutes"] >= 1 and t["volunteer"]["phone"]
    assert vol.post(f"/matches/{mine['match_id']}/complete").status_code == 200
    t = user.get(f"/help-requests/{rid_h}/tracking").json()
    assert t["status"] == "COMPLETED" and [e["event"] for e in t["timeline"]] == ["REQUESTED", "MATCHED", "ACCEPTED", "COMPLETED"]

    # 13. ADMIN sees the complete history
    acts = [a["action"] for a in admin.get("/admin/audit").json()]
    assert "road.block" in acts
    history = anon().get("/risk-history", params={"zone": "Zone A", "hours": 1}).json()["history"]
    levels = [h["risk_level"] for h in history]
    assert levels[0] == "LOW" and levels[-1] in ("HIGH", "CRITICAL")               # LOW -> HIGH recorded as it happened
    rq = next(r for r in admin.get("/help-requests").json() if r["id"] == rid_h)
    assert rq["requester_name"] == "Alice" and rq["volunteer_name"] == vol_row["name"] and rq["status"] == "COMPLETED"
    analytics = admin.get("/admin/analytics").json()
    assert analytics["help_requests_by_status"].get("COMPLETED") == 1 and analytics["avg_response_minutes"] is not None
    providers = {p["name"]: p["state"] for p in admin.get("/admin/providers").json()["providers"]}
    assert providers["weather"] == "OK"
    csv = admin.get("/admin/export/help-requests.csv").text
    assert "COMPLETED" in csv and "MEDICINE" in csv

    # 14. RECOVERY: conditions ease -> risk falls and the automatic alert clears
    refresh(r24=0.5)
    sat_row(CELL_A, abnormal=0, km2=0.0, pct=1.0, observed=days_ago(0))
    with db.session() as c:
        fi.recompute_all(c)
    assert zone_a()["risk_level"] in ("LOW", "MEDIUM")
    assert [a for a in anon().get("/alerts?active_only=true").json() if a["affected_zone"] == "Zone A" and a["source"] == "ENGINE"] == []


def test_no_orphaned_references_after_a_busy_session(client):
    """The schema has no foreign keys, so check the application kept every reference consistent."""
    import scripts.integrity_check as ic
    admin = client
    u1, u2 = user_client("o1@test.local"), user_client("o2@test.local")
    v, vol = volunteer_client(admin, latitude=12.9716, longitude=77.5946)
    for u in (u1, u2):
        u.post("/incidents", json={"type": "FLOOD", "latitude": 12.95, "longitude": 77.55})   # the second merges into the first
        u.post("/help-requests", json={"type": "MEDICINE", **HERE})
    mine = v.get("/volunteers/me/requests").json()["assigned"]
    if mine:
        v.post(f"/matches/{mine[0]['match_id']}/accept")
    admin.delete(f"/volunteers/{vol['id']}")      # disabling a volunteer cancels their matches and reopens the requests
    admin.post("/reset")
    assert ic.run() == []
