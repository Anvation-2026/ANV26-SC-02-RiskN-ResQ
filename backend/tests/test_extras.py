"""Account recovery, notifications, duplicate merging, tracking, admin tools, imports and hardening."""
import asyncio
import re

import pytest

import config
import db
import hardening
import main
import notify
import osm
import weather_monitor as wm
from providers.weather.base import WeatherObservation
from tests.test_api import A, client, login_as  # noqa: F401  (client = signed-in admin)
from tests.test_auth import PW, anon, make_volunteer, register, user_client, volunteer_client
from tests.test_weather_monitor import FakeProvider

HERE = {"latitude": 12.9716, "longitude": 77.5946}
TOKEN = "ExponentPushToken[abcdefghijklmnop]"


@pytest.fixture(autouse=True)
def _tables():
    db.init_db(reset=False)  # tests here register users before any admin client exists


def code_from(box, to, subject_part):
    mail = [e for e in box.emails if e["to"] == to and subject_part in e["subject"]][-1]
    return re.search(r"\b(\d{6})\b", mail["body"]).group(1)


# ---------------------------------------------------------------- password reset / email verification
def test_forgot_password_flow_and_old_sessions_end(outbox):
    u = user_client("reset@test.local")
    anon().post("/auth/forgot-password", json={"email": "reset@test.local"})
    code = code_from(outbox, "reset@test.local", "Reset")
    c = anon()
    assert c.post("/auth/reset-password", json={"email": "reset@test.local", "code": "000000", "new_password": "NewPass-9999"}).status_code == 400
    assert c.post("/auth/reset-password", json={"email": "reset@test.local", "code": code, "new_password": "NewPass-9999"}).status_code == 200
    assert c.post("/auth/reset-password", json={"email": "reset@test.local", "code": code, "new_password": "Another-9999"}).status_code == 400  # one use
    assert u.get("/auth/me").status_code == 401  # signed out everywhere
    assert c.post("/auth/login", json={"email": "reset@test.local", "password": "NewPass-9999"}).status_code == 200


def test_forgot_password_does_not_reveal_accounts_and_skips_admin(client, outbox):
    a = anon().post("/auth/forgot-password", json={"email": "nobody@test.local"})
    b = anon().post("/auth/forgot-password", json={"email": "admin@test.local"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert outbox.emails == []


def test_reset_code_dies_after_five_wrong_guesses(outbox, monkeypatch):
    user_client("guess@test.local")
    anon().post("/auth/forgot-password", json={"email": "guess@test.local"})
    code = code_from(outbox, "guess@test.local", "Reset")
    monkeypatch.setattr("auth.MAX_FAILED_LOGINS", 99)
    c = anon()
    for _ in range(5):
        assert c.post("/auth/reset-password", json={"email": "guess@test.local", "code": "123456" if code != "123456" else "654321", "new_password": "NewPass-9999"}).status_code == 400
    assert c.post("/auth/reset-password", json={"email": "guess@test.local", "code": code, "new_password": "NewPass-9999"}).status_code == 400


def test_email_verification(outbox):
    u = user_client("verify@test.local")
    assert u.get("/auth/me").json()["email_verified"] is False
    assert [e for e in outbox.emails if e["to"] == "verify@test.local"] == []   # registering sends no code (codes belong to the login page)
    assert u.post("/auth/resend-verification").status_code == 200              # the API still works if a client asks for one
    code = code_from(outbox, "verify@test.local", "Verify")
    assert u.post("/auth/verify-email", json={"code": "111111" if code != "111111" else "222222"}).status_code == 400
    assert u.post("/auth/verify-email", json={"code": code}).status_code == 200
    assert u.get("/auth/me").json()["email_verified"] is True


def test_admin_created_volunteer_is_already_verified(client):
    c, _ = volunteer_client(client)
    assert c.get("/auth/me").json()["email_verified"] is True


# ---------------------------------------------------------------- push, SMS and who gets notified
def test_push_token_validation_and_preferences():
    u = user_client()
    assert u.post("/me/push-token", json={"token": "not-a-token-at-all"}).status_code == 422
    assert u.post("/me/push-token", json={"token": TOKEN, "platform": "ios"}).status_code == 201
    assert u.patch("/me/preferences", json={"notify_sms": True}).status_code == 422  # needs a phone first
    r = u.patch("/me/preferences", json={"phone": "+91 98450 22222", "notify_sms": True, "language": "kn"})
    assert r.status_code == 200 and r.json()["notify_sms"] is True and r.json()["language"] == "kn"
    assert u.patch("/me/preferences", json={"language": "xx"}).status_code == 422


def test_volunteer_is_pushed_when_a_request_is_matched(client, outbox):
    v, _ = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    assert v.post("/me/push-token", json={"token": TOKEN}).status_code == 201
    u = user_client()
    assert u.post("/help-requests", json={"type": "MEDICINE", **HERE}).status_code == 201
    pushes = [p for p in outbox.posts if p["url"] == notify.EXPO_URL]
    assert pushes and pushes[-1]["json"][0]["to"] == TOKEN and "help request" in pushes[-1]["json"][0]["title"].lower()


def test_requester_is_pushed_when_volunteer_accepts_and_completes(client, outbox):
    v, _ = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    u = user_client()
    u.post("/me/push-token", json={"token": "ExponentPushToken[requesterdevice1]"})
    rid = u.post("/help-requests", json={"type": "MEDICINE", **HERE}).json()["requestId"]
    mid = v.get("/volunteers/me/requests").json()["assigned"][0]["match_id"]
    assert v.post(f"/matches/{mid}/accept").status_code == 200
    assert v.post(f"/matches/{mid}/complete").status_code == 200
    titles = [p["json"][0]["title"] for p in outbox.posts if p["json"][0]["to"] == "ExponentPushToken[requesterdevice1]"]
    assert "A volunteer is on the way" in titles and "Your help request is complete" in titles


def _settle_real_alert(user, sms=False):
    user.post("/me/location", json=HERE)
    asyncio.run(wm.refresh(FakeProvider(rate=20.0, total=110.0)))


def test_real_alert_notifies_nearby_users_but_a_drill_does_not(client, outbox):
    u = user_client()
    u.post("/me/push-token", json={"token": TOKEN})
    u.post("/me/location", json=HERE)
    client.post("/simulate-hazard", json={"rainfall": 120})
    assert [p for p in outbox.posts if p["url"] == notify.EXPO_URL] == []  # drills never notify
    client.post("/reset")
    _settle_real_alert(u)
    pushes = [p for p in outbox.posts if p["url"] == notify.EXPO_URL]
    assert pushes and "flood risk" in pushes[0]["json"][0]["title"].lower()


def test_sms_only_goes_to_opted_in_users_and_respects_the_cap(client, outbox, monkeypatch):
    monkeypatch.setattr(config, "TWILIO_ACCOUNT_SID", "ACtest")
    monkeypatch.setattr(config, "TWILIO_AUTH_TOKEN", "secret")
    monkeypatch.setattr(config, "TWILIO_FROM", "+15550001111")
    yes, no = user_client("yes@test.local"), user_client("no@test.local")
    yes.patch("/me/preferences", json={"phone": "9845033333", "notify_sms": True})
    no.patch("/me/preferences", json={"phone": "9845044444"})
    for c in (yes, no):
        c.post("/me/location", json=HERE)
    asyncio.run(wm.refresh(FakeProvider(rate=20.0, total=110.0)))
    sms = [p for p in outbox.posts if "twilio.com" in p["url"]]
    assert len(sms) == 1 and sms[0]["data"]["To"] == "+919845033333"


def test_notification_failure_never_breaks_the_request(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("provider down")
    monkeypatch.setattr(notify, "_post", boom)
    v, _ = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    v.post("/me/push-token", json={"token": TOKEN})
    assert user_client().post("/help-requests", json={"type": "MEDICINE", **HERE}).status_code == 201


# ---------------------------------------------------------------- incidents: duplicates and trust
def test_duplicate_reports_merge_and_count_once_for_risk(client):
    a, b = user_client("a@test.local"), user_client("b@test.local")
    first = a.post("/incidents", json={"type": "FLOOD", "latitude": 12.95, "longitude": 77.55, "severity": 3}).json()
    second = b.post("/incidents", json={"type": "FLOOD", "latitude": 12.9502, "longitude": 77.5501, "severity": 3}).json()
    assert first["merged_into"] is None and second["merged_into"] == first["id"]
    mine = [i for i in client.get("/incidents").json() if i["id"] in (first["id"], second["id"])]
    assert {i["id"]: i["duplicate_of"] for i in mine}[second["id"]] == first["id"]
    assert client.get(f"/incidents/{first['id']}").json()["confirmations"] == 1
    far = a.post("/incidents", json={"type": "FLOOD", "latitude": 12.98, "longitude": 77.60, "severity": 3}).json()
    assert far["merged_into"] is None  # more than 100 m away: its own report
    sync = a.get("/sync", params={"latitude": 12.95, "longitude": 77.55}).json()
    assert second["id"] not in [i["id"] for i in sync["incidents"]]


def test_admin_sees_why_a_report_is_trusted_and_users_do_not(client):
    u = user_client()
    inc = u.post("/incidents", json={"type": "FLOOD", "latitude": 12.95, "longitude": 77.55}).json()
    admin_view = client.get(f"/incidents/{inc['id']}").json()
    assert admin_view["trust_factors"][0]["points"] == 50
    assert "trust_factors" not in u.get(f"/incidents/{inc['id']}").json()


def test_gps_plausibility_affects_trust(client):
    u = user_client()
    u.post("/me/location", json={"latitude": 13.10, "longitude": 77.70})  # reporter is ~20 km from the incident
    inc = u.post("/incidents", json={"type": "BLOCKED_ROAD", "latitude": 12.95, "longitude": 77.55}).json()
    labels = [f["label"] for f in client.get(f"/incidents/{inc['id']}").json()["trust_factors"]]
    assert any("km away" in l for l in labels)


# ---------------------------------------------------------------- tracking and admin visibility
def test_tracking_timeline_eta_and_privacy(client):
    v, vol = volunteer_client(client, latitude=12.9716, longitude=77.5946)
    u = user_client()
    rid = u.post("/help-requests", json={"type": "MEDICINE", **HERE}).json()["requestId"]
    t = u.get(f"/help-requests/{rid}/tracking").json()
    assert [e["event"] for e in t["timeline"]] == ["REQUESTED", "MATCHED"]
    assert t["volunteer"]["eta_minutes"] >= 1 and t["volunteer"]["phone"] is None  # phone only after they accept
    mid = v.get("/volunteers/me/requests").json()["assigned"][0]["match_id"]
    v.post(f"/matches/{mid}/accept")
    t = u.get(f"/help-requests/{rid}/tracking").json()
    assert t["timeline"][-1]["event"] == "ACCEPTED" and t["volunteer"]["phone"]
    assert user_client("other@test.local").get(f"/help-requests/{rid}/tracking").status_code == 404
    v.post(f"/matches/{mid}/complete")
    assert u.get(f"/help-requests/{rid}/tracking").json()["volunteer"]["latitude"] is None  # no live position once done


def test_admin_requests_list_has_names(client):
    make_volunteer(client, latitude=12.9716, longitude=77.5946)
    user_client("named@test.local")
    u = anon(); login_as(u, {"email": "named@test.local", "password": PW})
    u.post("/help-requests", json={"type": "MEDICINE", **HERE})
    row = client.get("/help-requests").json()[0]
    assert row["requester_name"] == "Alice" and row["volunteer_name"] == "Dr Meera"


# ---------------------------------------------------------------- admin tools
def test_audit_log_records_admin_actions(client):
    client.post("/roads/1/block")
    client.post("/simulate-hazard", json={"rainfall": 50})
    actions = [a["action"] for a in client.get("/admin/audit").json()]
    assert "road.block" in actions and "hazard.simulate" in actions
    assert user_client().get("/admin/audit").status_code == 403


def test_analytics_shape(client):
    u = user_client()
    u.post("/incidents", json={"type": "FLOOD", "latitude": 12.95, "longitude": 77.55})
    a = client.get("/admin/analytics").json()
    assert len(a["incidents_per_day"]) == 14 and sum(d["count"] for d in a["incidents_per_day"]) >= 1
    assert "avg_response_minutes" in a and a["users"]["user"] == 1
    assert user_client("x@test.local").get("/admin/analytics").status_code == 403


def test_csv_export_neutralises_formulas_and_is_admin_only(client):
    u = user_client()
    u.post("/incidents", json={"type": "OTHER", "latitude": 12.95, "longitude": 77.55, "description": "=HYPERLINK(\"http://evil\")"})
    r = client.get("/admin/export/incidents.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "'=HYPERLINK" in r.text and ",=HYPERLINK" not in r.text
    assert client.get("/admin/export/secrets.csv").status_code == 404
    assert u.get("/admin/export/incidents.csv").status_code == 403


def test_broadcast_creates_an_alert_notifies_and_can_be_cleared(client, outbox):
    u = user_client()
    u.post("/me/push-token", json={"token": TOKEN})
    u.post("/me/location", json=HERE)
    r = client.post("/admin/broadcast", json={"message": "Avoid the underpass", "severity": "HIGH", "zone": "Zone A"})
    assert r.status_code == 201 and r.json()["recipients"] == 1 and r.json()["push_devices"] == 1
    assert any(a["source"] == "ADMIN" and a["active"] for a in u.get("/alerts").json())
    assert client.post(f"/admin/broadcast/{r.json()['alert_id']}/clear").status_code == 200
    assert client.post("/admin/broadcast", json={"message": "x" * 3, "zone": "Nowhere"}).status_code == 404
    assert u.post("/admin/broadcast", json={"message": "spam spam"}).status_code == 403


def test_places_crud_listing_and_distance(client):
    body = {"kind": "HOSPITAL", "name": "City Hospital", "latitude": 12.97, "longitude": 77.59, "phone": "080 1234"}
    pid = client.post("/admin/places", json=body).json()["id"]
    anon_view = anon().get("/places", params={**HERE}).json()
    assert anon_view[0]["name"] == "City Hospital" and anon_view[0]["distance_km"] < 1
    assert user_client().post("/admin/places", json=body).status_code == 403
    assert client.delete(f"/admin/places/{pid}").status_code == 200 and anon().get("/places").json() == []


def test_osm_imports_use_real_shaped_data_and_never_duplicate(client, monkeypatch):
    async def fake(query):
        if "hospital" in query:
            return {"elements": [
                {"type": "node", "id": 1, "lat": 12.96, "lon": 77.58, "tags": {"amenity": "hospital", "name": "Fort Hospital"}},
                {"type": "node", "id": 3, "lat": 12.9, "lon": 77.5, "tags": {"amenity": "hospital"}}]}  # unnamed: skipped
        if "assembly_point" in query:
            return {"elements": [{"type": "way", "id": 2, "center": {"lat": 12.97, "lon": 77.60}, "tags": {"emergency": "assembly_point", "name": "Park Assembly"}}]}
        mk = lambda i, name, base: {"type": "way", "id": i, "tags": {"highway": "primary", "name": name},
                                    "geometry": [{"lat": 12.9 + base + k * 0.01, "lon": 77.5 + k * 0.01} for k in range(5)]}
        return {"elements": [mk(10, "Hosur Road", 0.0), mk(11, "Bellary Road", 0.05), mk(12, "Hosur Road", 0.02),
                             mk(13, "Mysore Road", 0.07), mk(14, "Tumkur Road", 0.09)]}
    monkeypatch.setattr(osm, "fetch", fake)

    class Elev:
        async def get_elevations(self, points):
            return [900.0, 800.0, 950.0, 970.0][:len(points)]
    monkeypatch.setattr("routes_admin.provider", Elev())
    r = client.post("/admin/places/import-osm").json()
    assert r["added"] == 2 and client.post("/admin/places/import-osm").json()["added"] == 0
    assert {p["kind"] for p in anon().get("/places").json()} == {"HOSPITAL", "SHELTER"}
    r = client.post("/admin/roads/import-osm").json()
    assert r["added"] == 4 and client.post("/admin/roads/import-osm").json()["added"] == 0
    osm_roads = [x for x in anon().get("/roads").json() if x["source"] == "OSM"]
    assert {x["name"] for x in osm_roads} == {"Hosur Road", "Bellary Road", "Mysore Road", "Tumkur Road"}
    assert sum(x["low_lying"] for x in osm_roads) == 1  # only the lowest quarter is flagged


def test_osm_outage_is_a_clear_503(client, monkeypatch):
    async def down(q):
        raise RuntimeError("x")
    monkeypatch.setattr(osm, "fetch", down)
    assert client.post("/admin/places/import-osm").status_code == 503
    assert client.post("/admin/roads/import-osm").status_code == 503


# ---------------------------------------------------------------- weather: forecast and history
class ForecastProvider(FakeProvider):
    async def get_weather_grid(self, points):
        out = await super().get_weather_grid(points)
        for o in out:
            o.forecast_peak_mm, o.forecast_peak_in_h = 9.0, 2
        return out


def test_forecast_and_history(client):
    asyncio.run(wm.refresh(ForecastProvider(rate=1.0, total=40.0)))
    body = anon().get("/weather/monitoring").json()
    assert body["summary"]["forecast_heavy_locations"] == 25
    loc = body["locations"][0]
    assert loc["forecast_level"] == "HEAVY" and loc["forecast_peak_in_h"] == 2
    hist = client.get("/admin/analytics").json()["rainfall_history"]
    assert len(hist) == 1 and hist[0]["max_mm"] == 1.0


# ---------------------------------------------------------------- hardening
def test_rate_limit_blocks_bursts_and_auth_has_a_tighter_limit(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(config, "AUTH_RATE_LIMIT_PER_MINUTE", 3)
    from fastapi.testclient import TestClient
    c = TestClient(main.app)
    codes = [c.post("/auth/login", json={"email": "x@test.local", "password": "nope"}).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]
    monkeypatch.setattr(config, "RATE_LIMIT_PER_MINUTE", 5)
    assert 429 in [c.get("/health").status_code for _ in range(12)]


# ---------------------------------------------------------------- idempotency (double taps and retries)
def test_a_repeated_help_request_with_the_same_key_creates_one_request(client):
    from tests.test_auth import volunteer_client
    volunteer_client(client, latitude=12.9716, longitude=77.5946)
    u = user_client()
    body = {"type": "MEDICINE", "priority": "HIGH", **HERE}
    first = u.post("/help-requests", json=body, headers={"Idempotency-Key": "form-1"}).json()
    second = u.post("/help-requests", json=body, headers={"Idempotency-Key": "form-1"}).json()
    assert second == first
    assert len([r for r in u.get("/help-requests").json() if r["type"] == "MEDICINE"]) == 1
    third = u.post("/help-requests", json=body, headers={"Idempotency-Key": "form-2"}).json()   # a new key is a new request
    assert third["requestId"] != first["requestId"]
    assert u.post("/help-requests", json=body).json()["requestId"] not in (first["requestId"], third["requestId"])  # no key: unchanged behaviour


def test_a_repeated_incident_report_with_the_same_key_creates_one_incident(client):
    u = user_client()
    body = {"type": "FLOOD", "latitude": 12.95, "longitude": 77.55, "severity": 3}
    a = u.post("/incidents", json=body, headers={"Idempotency-Key": "k1"}).json()
    b = u.post("/incidents", json=body, headers={"Idempotency-Key": "k1"}).json()
    assert a["id"] == b["id"]
    assert len([i for i in client.get("/incidents").json() if i["id"] == a["id"]]) == 1
    assert client.get("/incidents").json().count(None) == 0


def test_an_idempotency_key_is_private_to_the_user_who_sent_it(client):
    a, b = user_client("a@test.local"), user_client("b@test.local")
    ra = a.post("/help-requests", json={"type": "FOOD", **HERE}, headers={"Idempotency-Key": "shared"}).json()
    rb = b.post("/help-requests", json={"type": "FOOD", **HERE}, headers={"Idempotency-Key": "shared"}).json()
    assert ra["requestId"] != rb["requestId"]


# ---------------------------------------------------------------- reset keeps real data
def test_reset_clears_demo_state_but_keeps_real_weather_cells_and_imported_roads(client):
    import weather_monitor as wm
    asyncio.run(wm.refresh(FakeProvider(rate=1.0, total=5.0)))
    with db.session() as c:
        c.execute("INSERT INTO roads(name, coordinates, status, source) VALUES('Real OSM Rd', '[[12.9,77.5],[12.91,77.51]]', 'BLOCKED', 'OSM')")
    user_client().post("/incidents", json={"type": "FLOOD", "latitude": 12.95, "longitude": 77.55})
    assert client.post("/reset").status_code == 200
    assert len(anon().get("/weather/monitoring").json()["locations"]) == 25          # real observations are not demo state
    roads = {r["name"]: r for r in anon().get("/roads").json()}
    assert roads["Real OSM Rd"]["status"] == "AVAILABLE"                              # re-opened, not deleted
    # the synthetic seed roads are re-created by the reset but hidden once real (OSM) roads exist
    assert not {"Road A", "Road B", "Road C"} & set(roads)
    with db.session() as c:
        assert {r["name"] for r in c.execute("SELECT name FROM roads WHERE source='SEED'")} == {"Road A", "Road B", "Road C"}
    assert [i for i in client.get("/incidents").json() if i["type"] == "FLOOD" and i["latitude"] == 12.95] == []
    z = anon().get("/flood-risk/Zone A").json()
    assert z["insufficient"] is False                                                # real cell data still feeds the zone after a reset


def test_reset_twice_does_not_collide_ids(client):
    assert client.post("/reset").status_code == 200
    assert client.post("/reset").status_code == 200
    assert [r["name"] for r in anon().get("/roads").json()][:3] == ["Road A", "Road B", "Road C"]


def test_seed_roads_are_used_only_until_real_roads_are_imported(client):
    assert {r["name"] for r in anon().get("/roads").json()} >= {"Road A", "Road B", "Road C"}   # empty install: reference geometry
    with db.session() as c:
        c.execute("INSERT INTO roads(name, coordinates, status, source) VALUES('Imported Rd', '[[12.97,77.59],[12.98,77.60]]', 'AVAILABLE', 'OSM')")
    assert [r["name"] for r in anon().get("/roads").json()] == ["Imported Rd"]
    assert [r["name"] for r in anon().get("/road-risk").json()["roads"]] == ["Imported Rd"]


# ---------------------------------------------------------------- email sign-in code (users only)
def test_user_signs_in_with_an_emailed_code(outbox):
    register(anon(), "codeuser@test.local")
    r = anon().post("/auth/login-code/request", json={"email": "CodeUser@test.local"})
    assert r.status_code == 200 and r.json()["expires_in_minutes"] == 10
    code = code_from(outbox, "codeuser@test.local", "sign-in code")
    c = anon()
    assert c.post("/auth/login-code/verify", json={"email": "codeuser@test.local", "code": "000000" if code != "000000" else "111111"}).status_code == 400
    ok = c.post("/auth/login-code/verify", json={"email": "codeuser@test.local", "code": code})
    assert ok.status_code == 200 and ok.json()["user"]["role"] == "user" and ok.json()["user"]["email_verified"] is True
    c.headers["Authorization"] = f"Bearer {ok.json()['token']}"
    assert c.get("/auth/me").json()["email"] == "codeuser@test.local"
    assert anon().post("/auth/login-code/verify", json={"email": "codeuser@test.local", "code": code}).status_code == 400   # one use only


def test_sign_in_codes_never_go_to_volunteers_admins_or_unknown_emails(client, outbox):
    make_volunteer(client, email="vol-code@test.local")
    answers = [anon().post("/auth/login-code/request", json={"email": e}).json() for e in ("vol-code@test.local", "admin@test.local", "nobody@test.local")]
    assert answers[0] == answers[1] == answers[2]                                  # the same reply: nothing reveals who exists or their role
    assert outbox.emails == []
    for e in ("vol-code@test.local", "admin@test.local"):
        assert anon().post("/auth/login-code/verify", json={"email": e, "code": "123456"}).status_code == 400


def test_sign_in_code_resend_is_rate_limited_and_old_codes_stop_working(outbox, monkeypatch):
    register(anon(), "resend@test.local")
    anon().post("/auth/login-code/request", json={"email": "resend@test.local"})
    anon().post("/auth/login-code/request", json={"email": "resend@test.local"})       # within the cooldown: no second email
    assert len([e for e in outbox.emails if e["to"] == "resend@test.local" and "sign-in code" in e["subject"]]) == 1
    first = code_from(outbox, "resend@test.local", "sign-in code")
    import routes_account
    monkeypatch.setattr(routes_account, "LOGIN_CODE_COOLDOWN_S", 0)
    anon().post("/auth/login-code/request", json={"email": "resend@test.local"})
    second = code_from(outbox, "resend@test.local", "sign-in code")
    if first != second:
        assert anon().post("/auth/login-code/verify", json={"email": "resend@test.local", "code": first}).status_code == 400
    assert anon().post("/auth/login-code/verify", json={"email": "resend@test.local", "code": second}).status_code == 200


def test_new_report_types_and_my_reports(client):
    u = user_client("reporter2@test.local")
    for t in ("LANDSLIDE", "INFRASTRUCTURE_DAMAGE", "PERSON_IN_DANGER"):
        assert u.post("/incidents", json={"type": t, "latitude": 12.97, "longitude": 77.59, "description": t.lower()}).status_code == 201, t
    other = user_client("reporter3@test.local")
    other.post("/incidents", json={"type": "FLOOD", "latitude": 12.98, "longitude": 77.60})
    mine = u.get("/incidents", params={"mine": True}).json()
    assert sorted(i["type"] for i in mine) == ["INFRASTRUCTURE_DAMAGE", "LANDSLIDE", "PERSON_IN_DANGER"]   # only my own
    assert all(i["status"] == "REPORTED" for i in mine)
