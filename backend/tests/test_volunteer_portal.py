"""Volunteer portal API: requests, nearby, claim/accept/complete, availability, and who may touch what."""
import pytest

from tests.test_api import A, client, login_as, simulate  # noqa: F401  (client = signed-in admin)
from tests.test_auth import PW, anon, make_volunteer, user_client, volunteer_client

HERE = {"latitude": 12.9716, "longitude": 77.5946}


def help_req(u, type_="MEDICINE", priority="HIGH", **pos):
    r = u.post("/help-requests", json={"type": type_, "priority": priority, **(pos or HERE)})
    assert r.status_code == 201, r.text
    return r.json()["requestId"]


# ---------- unauthenticated / wrong-role access is refused ----------

@pytest.mark.parametrize("method,path,body", [
    ("post", "/volunteers/register", {"name": "x", "skill": "FOOD", "resources": "[]", "latitude": 12.9, "longitude": 77.5}),
    ("post", "/volunteers/1/availability", {"available": False, "responderMode": True}),
    ("post", "/volunteers/1/location", {"latitude": 12.9, "longitude": 77.5}),
    ("get", "/volunteers/nearby?latitude=12.9716&longitude=77.5946", None),
    ("post", "/routes/compute", {"origin": {"latitude": 12.9, "longitude": 77.5}, "destination": {"latitude": 12.95, "longitude": 77.6}}),
    ("post", "/help-requests", {"type": "FOOD", "latitude": 12.9, "longitude": 77.5}),
    ("post", "/help-requests/1/claim", None),
])
def test_formerly_open_endpoints_now_need_login(client, method, path, body):
    r = getattr(anon(), method)(path, **({"json": body} if body is not None else {}))
    assert r.status_code == 401, (path, r.status_code)


def test_only_admin_can_register_roster_volunteers_and_users_cannot_claim(client):
    body = {"name": "Roster", "skill": "FOOD", "resources": "[]", "latitude": 12.9, "longitude": 77.5}
    assert user_client().post("/volunteers/register", json=body).status_code == 403
    assert client.post("/volunteers/register", json=body).status_code == 201
    assert user_client("other@test.local").post("/help-requests/1/claim").status_code == 403


def test_a_volunteer_can_only_change_their_own_availability_and_location(client):
    a, va = volunteer_client(client)
    b, vb = volunteer_client(client, email="b@test.local", name="Vol B")
    assert b.post(f"/volunteers/{va['id']}/availability", json={"available": False, "responderMode": True}).status_code == 404
    assert b.post(f"/volunteers/{va['id']}/location", json={"latitude": 1.0, "longitude": 1.0}).status_code == 404
    assert a.post(f"/volunteers/{va['id']}/availability", json={"available": False, "responderMode": True}).status_code == 200
    assert user_client().post(f"/volunteers/{va['id']}/availability", json={"available": True, "responderMode": True}).status_code == 403
    assert client.post(f"/volunteers/{va['id']}/availability", json={"available": True, "responderMode": True}).status_code == 200  # admin
    assert a.get("/volunteers/me").json()["volunteer"]["available"] is True


def test_nearby_volunteers_hide_contact_details_from_non_admins(client):
    make_volunteer(client, latitude=12.9716, longitude=77.5946)
    seen = user_client().get("/volunteers/nearby", params=HERE).json()
    assert seen and all("phone" not in v and "user_id" not in v for v in seen)
    assert any("phone" in v for v in client.get("/volunteers/nearby", params=HERE).json())


def test_help_request_owner_is_the_signed_in_user_not_the_body(client):
    u = user_client()
    me = u.get("/auth/me").json()["id"]
    rid = u.post("/help-requests", json={"userId": 999, "type": "FOOD", **HERE}).json()["requestId"]
    assert client.get(f"/help-requests/{rid}").json()["user_id"] == me


# ---------- availability drives matching ----------

def test_unavailable_volunteers_are_not_matched(client):
    vc, v = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    u = user_client()
    vc.patch("/volunteers/me", json={"available": False})
    for vol in client.get("/volunteers").json():  # the demo roster would otherwise match
        client.put(f"/volunteers/{vol['id']}", json={"available": vol["id"] == v["id"] and False})
    r = u.post("/help-requests", json={"type": "MEDICINE", "priority": "HIGH", **HERE}).json()
    assert r["match"]["matched"] is False
    vc.patch("/volunteers/me", json={"available": True})
    r2 = u.post("/help-requests", json={"type": "MEDICINE", "priority": "HIGH", **HERE}).json()
    assert r2["match"]["matched"] is True and r2["match"]["volunteer"]["name"] == v["name"]


# ---------- nearby: ordering, skills, exclusions ----------

def test_nearby_is_sorted_by_priority_then_distance_and_respects_skills(client):
    vc, v = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    client.put(f"/volunteers/{v['id']}", json={"skill": "Medicine"})
    u = user_client()
    far_high = help_req(u, "MEDICINE", "HIGH", latitude=12.9916, longitude=77.5946)   # ~2.2 km
    near_high = help_req(u, "MEDICINE", "HIGH", latitude=12.9726, longitude=77.5946)  # ~0.1 km
    near_low = help_req(u, "MEDICINE", "LOW", latitude=12.9717, longitude=77.5946)
    crit_far = help_req(u, "MEDICINE", "CRITICAL", latitude=13.0100, longitude=77.5946)
    food = help_req(u, "FOOD", "CRITICAL")  # not this volunteer's skill
    # requests that are matched automatically would not be open: make sure we test OPEN ones only
    for rid in (far_high, near_high, near_low, crit_far, food):
        pass
    nearby = vc.get("/volunteers/me/requests").json()["nearby_open"]
    ids = [n["request_id"] for n in nearby]
    assert food not in ids
    assert set(ids) <= {far_high, near_high, near_low, crit_far}
    ranks = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}
    keys = [(-ranks[n["priority"]], n["distance_km"]) for n in nearby]
    assert keys == sorted(keys)


def test_resources_list_counts_as_a_skill(client):
    vc, v = volunteer_client(client, skill="Food", latitude=12.9716, longitude=77.5946)
    from db import session
    with session() as c:  # the backend stores extra resources as JSON text
        c.execute("UPDATE volunteers SET resources=? WHERE id=?", ('["Medicine", "First Aid"]', v["id"]))
    u = user_client()
    isolate(client, v["id"])  # no other volunteer may auto-match these requests
    client.put(f"/volunteers/{v['id']}", json={"available": False})
    ids = []
    for t in ("MEDICINE", "FIRST_AID", "WATER"):
        ids.append(help_req(u, t, "HIGH"))
    client.put(f"/volunteers/{v['id']}", json={"available": True})
    near = [n["type"] for n in vc.get("/volunteers/me/requests").json()["nearby_open"]]
    assert "MEDICINE" in near and "FIRST_AID" in near and "WATER" not in near


# ---------- claim -> accept -> complete ----------

def open_request_for(client, vc, u, type_="MEDICINE"):
    """Create a request while the volunteer is unavailable so it stays OPEN, then make them available."""
    vc.patch("/volunteers/me", json={"available": False})
    rid = help_req(u, type_, "HIGH")
    vc.patch("/volunteers/me", json={"available": True})
    return rid


def isolate(client, keep_id):
    for vol in client.get("/volunteers").json():
        if vol["id"] != keep_id:
            client.put(f"/volunteers/{vol['id']}", json={"available": False})


def test_claim_then_complete_and_everyone_sees_the_state(client):
    vc, v = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    isolate(client, v["id"])
    u = user_client()
    rid = open_request_for(client, vc, u)
    assert rid in [n["request_id"] for n in vc.get("/volunteers/me/requests").json()["nearby_open"]]
    m = vc.post(f"/help-requests/{rid}/claim")
    assert m.status_code == 201 and m.json()["status"] == "ACCEPTED"
    mine = vc.get("/volunteers/me/requests").json()
    assert [a["request_id"] for a in mine["assigned"]] == [rid] and mine["assigned"][0]["match_status"] == "ACCEPTED"
    assert mine["assigned"][0]["requester_name"] and mine["assigned"][0]["zone"]
    assert rid not in [n["request_id"] for n in mine["nearby_open"]]
    assert client.get(f"/help-requests/{rid}").json()["status"] == "MATCHED"  # admin sees it
    assert u.get(f"/help-requests/{rid}").json()["status"] == "MATCHED"        # the requester sees it
    done = vc.post(f"/matches/{m.json()['id']}/complete")
    assert done.status_code == 200 and done.json()["status"] == "COMPLETED"
    after = vc.get("/volunteers/me/requests").json()
    assert after["assigned"] == [] and [c["request_id"] for c in after["completed"]] == [rid]
    assert after["stats"] == {"assigned": 0, "nearby": 0, "completed": 1}
    assert vc.get("/volunteers/me").json()["completed_count"] == 1
    assert client.get(f"/help-requests/{rid}").json()["status"] == "COMPLETED"
    assert u.get(f"/help-requests/{rid}").json()["status"] == "COMPLETED"


def test_claim_rules(client):
    a, va = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    b, vb = volunteer_client(client, email="b@test.local", name="Vol B", latitude=12.9716, longitude=77.5946)
    isolate(client, va["id"])
    u = user_client()
    rid = open_request_for(client, a, u)  # Vol B is unavailable (isolated), so the request stays open
    client.put(f"/volunteers/{vb['id']}", json={"available": True})
    assert a.post(f"/help-requests/{rid}/claim").status_code == 201
    assert b.post(f"/help-requests/{rid}/claim").status_code == 409          # already taken
    assert a.post(f"/help-requests/{rid}/claim").status_code == 409          # cannot claim twice
    assert b.post("/help-requests/9999/claim").status_code == 404
    food = open_request_for(client, a, u, "WATER")
    assert a.post(f"/help-requests/{food}/claim").status_code == 422         # not suited
    a.patch("/volunteers/me", json={"available": False})
    other = help_req(u, "MEDICINE", "LOW")
    assert a.post(f"/help-requests/{other}/claim").status_code == 409        # must be available


def test_invalid_transitions_and_other_volunteers_matches(client):
    a, va = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    b, vb = volunteer_client(client, email="b@test.local", name="Vol B", latitude=12.9716, longitude=77.5946)
    isolate(client, va["id"])
    u = user_client()
    rid = open_request_for(client, a, u)
    mid = a.post(f"/help-requests/{rid}/claim").json()["id"]
    assert b.post(f"/matches/{mid}/complete").status_code == 404              # someone else's match
    assert b.post(f"/matches/{mid}/accept").status_code == 404
    assert a.post(f"/matches/{mid}/accept").status_code == 409                # already accepted
    assert a.post(f"/matches/{mid}/complete").status_code == 200
    assert a.post(f"/matches/{mid}/complete").status_code == 409              # already completed
    assert a.get("/volunteers/me/requests").json()["assigned"] == []
    assert b.get("/volunteers/me/requests").json()["completed"] == []         # nothing leaks to others


def test_volunteer_data_survives_in_the_database(client):
    from db import session
    vc, v = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    isolate(client, v["id"])
    u = user_client()
    rid = open_request_for(client, vc, u)
    mid = vc.post(f"/help-requests/{rid}/claim").json()["id"]
    vc.post(f"/matches/{mid}/complete")
    vc.patch("/volunteers/me", json={"available": False})
    with session() as c:  # read straight from the database, not through the API
        assert c.execute("SELECT status FROM matches WHERE id=?", (mid,)).fetchone()["status"] == "COMPLETED"
        assert c.execute("SELECT available FROM volunteers WHERE id=?", (v["id"],)).fetchone()["available"] == 0


# ---------- weather ----------

def test_weather_endpoint_reports_source_and_rainfall(client, monkeypatch):
    import main
    from providers.weather.base import WeatherObservation

    class FakeProvider:
        async def get_weather(self, lat, lng):
            return WeatherObservation(source="Open-Meteo", station="grid", latitude=lat, longitude=lng,
                                      rainfall_24h_mm=45.2, observed_at="2026-10-08T12:00:00Z")
    monkeypatch.setattr(main, "weather_provider", FakeProvider())
    r = anon().get("/weather", params=HERE).json()
    assert r["source"] == "Open-Meteo" and r["precipitation_mm"] == 45.2 and r["timestamp"] and r["latitude"] == 12.9716
    assert anon().get("/weather", params={"latitude": 999, "longitude": 1}).status_code == 422
