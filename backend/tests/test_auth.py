"""Authentication, roles and permissions."""
import pytest
from fastapi.testclient import TestClient

import auth
import main
from tests.test_api import A, ADMIN, client, login_as, simulate  # noqa: F401  (client fixture = signed-in admin)

PW = "Passw0rd-123"


def anon():
    return TestClient(main.app)


def register(c, email="alice@test.local", name="Alice", **extra):
    return c.post("/auth/register", json={"name": name, "email": email, "password": PW, "confirm_password": PW, **extra})


def user_client(email="alice@test.local"):
    c = anon()
    assert register(c, email).status_code == 201
    login_as(c, {"email": email, "password": PW})
    return c


VOL = {"name": "Dr Meera", "email": "meera@test.local", "phone": "+91 98450 11111", "password": "Vol-pass-123",
       "skill": "Medicine", "latitude": 12.9700, "longitude": 77.5900}


def make_volunteer(admin, **over):
    r = admin.post("/volunteers", json={**VOL, **over})
    assert r.status_code == 201, r.text
    return r.json()


def volunteer_client(admin, **over):
    v = make_volunteer(admin, **over)
    c = anon()
    login_as(c, {"email": over.get("email", VOL["email"]), "password": over.get("password", VOL["password"])})
    return c, v


# ---------- registration & login ----------

def test_register_creates_a_plain_user_without_leaking_secrets(client):
    r = register(anon())
    assert r.status_code == 201
    body = r.json()
    assert body["role"] == "user" and body["email"] == "alice@test.local"
    assert "password" not in body and "password_hash" not in body


@pytest.mark.parametrize("extra", [{"role": "admin"}, {"role": "volunteer"}, {"is_admin": True}, {"skill": "MEDICINE"}])
def test_nobody_can_pick_a_role_at_registration(client, extra):
    r = register(anon(), **extra)
    assert r.status_code == 422 and "Extra inputs" in r.text
    assert "alice@test.local" not in [u["email"] for u in client.get("/admin/users").json()]


def test_registration_validation(client):
    c = anon()
    assert c.post("/auth/register", json={"name": "A", "email": "nope", "password": PW}).status_code == 422
    assert c.post("/auth/register", json={"name": "A", "email": "a@b.co", "password": "short"}).status_code == 422
    assert c.post("/auth/register", json={"name": "A", "email": "a@b.co", "password": PW, "confirm_password": "other"}).status_code == 422
    assert c.post("/auth/register", json={"name": "  ", "email": "a@b.co", "password": PW}).status_code == 422
    assert c.post("/auth/register", json={"name": "A", "email": "a@b.co", "password": PW, "phone": "abc"}).status_code == 422
    assert c.post("/auth/register", json={"name": "A", "email": "a@b.co", "password": PW, "phone": "+91 98450 12345"}).status_code == 201


def test_duplicate_email_is_rejected_case_insensitively(client):
    assert register(anon(), "dup@test.local").status_code == 201
    r = register(anon(), "DUP@Test.local")
    assert r.status_code == 409
    assert register(anon(), ADMIN["email"]).status_code == 409  # cannot re-register the admin's email


def test_login_me_logout_and_session_persistence(client):
    c = anon()
    register(c)
    data = login_as(c, {"email": "ALICE@test.local", "password": PW})  # email is case-insensitive
    assert data["user"]["role"] == "user" and data["token_type"] == "bearer" and data["expires_at"]
    assert c.get("/auth/me").json()["email"] == "alice@test.local"
    assert c.get("/auth/me").status_code == 200  # the same token keeps working (session persistence)
    token = c.headers["Authorization"]
    assert c.post("/auth/logout").status_code == 200
    assert anon().get("/auth/me", headers={"Authorization": token}).status_code == 401  # revoked
    assert c.post("/auth/logout").status_code == 401


def test_wrong_password_and_unknown_email_look_identical(client):
    register(anon())
    c = anon()
    bad_pw = c.post("/auth/login", json={"email": "alice@test.local", "password": "wrong-password"})
    no_user = c.post("/auth/login", json={"email": "ghost@test.local", "password": "wrong-password"})
    assert bad_pw.status_code == no_user.status_code == 401
    assert bad_pw.json() == no_user.json() == {"detail": "Invalid email or password."}


def test_login_is_throttled_after_repeated_failures(client):
    register(anon())
    c = anon()
    for _ in range(5):
        assert c.post("/auth/login", json={"email": "alice@test.local", "password": "bad-password"}).status_code == 401
    assert c.post("/auth/login", json={"email": "alice@test.local", "password": PW}).status_code == 429


def test_login_throttle_survives_a_backend_restart(client):
    register(anon())
    for _ in range(5):
        assert anon().post("/auth/login", json={"email": "alice@test.local", "password": "bad-password"}).status_code == 401
    with TestClient(main.app) as restarted:  # the app starts again on the same database file
        r = restarted.post("/auth/login", json={"email": "alice@test.local", "password": PW})
        assert r.status_code == 429
    auth.reset_login_throttle()
    assert anon().post("/auth/login", json={"email": "alice@test.local", "password": PW}).status_code == 200


def test_successful_login_clears_earlier_failures(client):
    register(anon())
    for _ in range(4):
        anon().post("/auth/login", json={"email": "alice@test.local", "password": "bad-password"})
    assert anon().post("/auth/login", json={"email": "alice@test.local", "password": PW}).status_code == 200
    for _ in range(4):  # counter started again from zero
        assert anon().post("/auth/login", json={"email": "alice@test.local", "password": "bad-password"}).status_code == 401


def test_admin_account_comes_from_environment_only(tmp_path, monkeypatch):
    import db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "noadmin.db")
    monkeypatch.delenv("ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    with TestClient(main.app) as c:
        assert c.post("/auth/login", json=ADMIN).status_code == 401  # no admin exists without configuration
        assert register(c, "x@test.local").json()["role"] == "user"
    monkeypatch.setenv("ADMIN_EMAIL", "short@test.local")
    monkeypatch.setenv("ADMIN_PASSWORD", "short")  # too weak: refused
    with TestClient(main.app) as c:
        assert c.post("/auth/login", json={"email": "short@test.local", "password": "short"}).status_code == 401


# ---------- unauthenticated / invalid tokens ----------

PROTECTED = [("get", "/incidents"), ("get", "/incidents/1"), ("post", "/incidents"), ("post", "/help-request"),
             ("get", "/help-requests"), ("get", "/volunteers"), ("get", "/matches"), ("post", "/matches"),
             ("get", "/auth/me"), ("post", "/auth/logout"), ("post", "/reset"), ("post", "/simulate-hazard"),
             ("post", "/roads/1/block"), ("post", "/roads/1/unblock"), ("post", "/volunteers"), ("put", "/volunteers/1"),
             ("delete", "/volunteers/1"), ("post", "/incidents/1/verify"), ("post", "/alerts"), ("get", "/admin/summary"),
             ("get", "/admin/users"), ("get", "/volunteers/me"), ("patch", "/volunteers/me")]
PUBLIC = ["/health", "/risk", "/alerts", "/roads"]


@pytest.mark.parametrize("method,path", PROTECTED)
def test_unauthenticated_requests_are_rejected(client, method, path):
    r = getattr(anon(), method)(path)
    assert r.status_code == 401, (method, path, r.status_code)


@pytest.mark.parametrize("header", ["", "Bearer", "Bearer nonsense", "Basic abc", "bearer   "])
def test_invalid_authorization_headers(client, header):
    assert anon().get("/auth/me", headers={"Authorization": header}).status_code == 401


@pytest.mark.parametrize("path", PUBLIC)
def test_public_hazard_information_needs_no_login(client, path):
    assert anon().get(path).status_code == 200


def test_expired_token_is_rejected(client, monkeypatch):
    monkeypatch.setattr(auth, "TOKEN_TTL_HOURS", -1)
    c = anon()
    register(c)
    login_as(c, {"email": "alice@test.local", "password": PW})
    assert c.get("/auth/me").status_code == 401
    assert "expired" in c.get("/auth/me").json()["detail"].lower()


# ---------- normal user ----------

ADMIN_ONLY = [("post", "/reset", None), ("post", "/simulate-hazard", {"rainfall": 80}), ("post", "/roads/1/block", None),
              ("post", "/roads/1/unblock", None), ("post", "/volunteers", VOL), ("put", "/volunteers/1", {"name": "x"}),
              ("delete", "/volunteers/1", None), ("post", "/incidents/1/verify", None), ("post", "/incidents/1/reject", None),
              ("post", "/incidents/1/resolve", None), ("patch", "/incidents/1", {"status": "VERIFIED"}),
              ("post", "/alerts", {"severity": "HIGH", "message": "x", "affected_zone": "Zone A"}),
              ("get", "/admin/summary", None), ("get", "/admin/users", None), ("patch", "/admin/users/1", {"is_active": False})]


@pytest.mark.parametrize("method,path,body", ADMIN_ONLY)
def test_user_cannot_use_admin_apis(client, method, path, body):
    r = getattr(user_client(), method)(path, **({"json": body} if body is not None else {}))
    assert r.status_code == 403, (method, path, r.status_code)


@pytest.mark.parametrize("method,path,body", ADMIN_ONLY)
def test_volunteer_cannot_use_admin_apis(client, method, path, body):
    vc, _ = volunteer_client(client)
    r = getattr(vc, method)(path, **({"json": body} if body is not None else {}))
    assert r.status_code == 403, (method, path, r.status_code)


def test_user_flow_incident_and_help_are_owned_by_the_token(client):
    u = user_client()
    me = u.get("/auth/me").json()
    inc = u.post("/incidents", json={"type": "FLOOD", "user_id": 1, **A})
    assert inc.status_code == 201 and inc.json()["user_id"] is None  # owner hidden from non-admins
    assert client.get(f"/incidents/{inc.json()['id']}").json()["user_id"] == me["id"]  # ...but recorded as the caller, not user_id 1
    req = u.post("/help-request", json={"type": "Medicine", "priority": "High", **A}).json()
    assert req["user_id"] == me["id"]
    assert [r["id"] for r in u.get("/help-requests").json()] == [req["request_id"]]
    assert u.get(f"/help-requests/{req['request_id']}").status_code == 200


def test_users_cannot_see_each_others_requests_or_matches(client):
    alice, bob = user_client("alice@test.local"), user_client("bob@test.local")
    rid = alice.post("/help-request", json={"type": "MEDICINE", **A}).json()["request_id"]
    assert bob.get("/help-requests").json() == []
    assert bob.get(f"/help-requests/{rid}").status_code == 404
    assert bob.post("/matches", json={"help_request_id": rid, "volunteer_id": 1}).status_code == 404
    assert alice.post("/matches", json={"help_request_id": rid, "volunteer_id": 1}).status_code == 201
    assert len(alice.get("/matches").json()) == 1 and bob.get("/matches").json() == []
    assert len(client.get("/help-requests").json()) == 1  # admin sees everything


def test_users_only_see_public_volunteer_fields(client):
    make_volunteer(client)
    users_view = user_client().get("/volunteers").json()
    assert all(set(v) == {"id", "name", "skill", "latitude", "longitude", "available"} for v in users_view)
    admin_view = client.get("/volunteers").json()
    assert any(v["email"] == VOL["email"] and v["phone"] == VOL["phone"] for v in admin_view)
    assert "password_hash" not in str(admin_view)


# ---------- admin: volunteers ----------

def test_only_admin_creates_volunteers_and_they_can_log_in(client):
    assert user_client().post("/volunteers", json=VOL).status_code == 403
    v = make_volunteer(client)
    assert v["skill"] == "MEDICINE" and v["status"] == "ACTIVE" and v["has_login"] and "password" not in str(v)
    vc = anon()
    data = login_as(vc, {"email": VOL["email"], "password": VOL["password"]})
    assert data["user"]["role"] == "volunteer"
    assert vc.get("/auth/me").json()["volunteer"]["skill"] == "MEDICINE"


def test_volunteer_creation_validation(client):
    assert client.post("/volunteers", json={**VOL, "skill": "Pizza"}).status_code == 422
    assert client.post("/volunteers", json={**VOL, "role": "admin"}).status_code == 422
    make_volunteer(client)
    assert client.post("/volunteers", json=VOL).status_code == 409
    assert client.post("/volunteers", json={**VOL, "email": ADMIN["email"]}).status_code == 409


def test_admin_edits_volunteer_and_password_change_revokes_sessions(client):
    vc, v = volunteer_client(client)
    r = client.put(f"/volunteers/{v['id']}", json={"skill": "Water", "phone": "+91 99999 00000", "name": "Meera K", "password": "New-pass-4567"})
    assert r.status_code == 200 and r.json()["skill"] == "WATER" and r.json()["name"] == "Meera K"
    assert vc.get("/volunteers/me").status_code == 401  # old session ended
    c = anon()
    assert c.post("/auth/login", json={"email": VOL["email"], "password": VOL["password"]}).status_code == 401
    assert c.post("/auth/login", json={"email": VOL["email"], "password": "New-pass-4567"}).status_code == 200
    assert client.put("/volunteers/9999", json={"name": "x"}).status_code == 404


def test_disabling_a_volunteer_stops_login_and_releases_work(client):
    vc, v = volunteer_client(client)
    alice = user_client()
    rid = alice.post("/help-request", json={"type": "MEDICINE", **A}).json()["request_id"]
    assert alice.post("/matches", json={"help_request_id": rid, "volunteer_id": v["id"]}).status_code == 201
    assert client.delete(f"/volunteers/{v['id']}").json()["status"] == "DISABLED"
    assert vc.get("/volunteers/me").status_code == 401  # session revoked
    assert anon().post("/auth/login", json={"email": VOL["email"], "password": VOL["password"]}).status_code == 403
    assert client.get(f"/help-requests/{rid}").json()["status"] == "OPEN"  # request is free to be re-matched
    assert client.get("/matches").json()[0]["status"] == "CANCELLED"
    assert v["id"] not in [x["id"] for x in alice.get("/volunteers").json()]
    assert alice.post("/matches", json={"help_request_id": rid, "volunteer_id": v["id"]}).status_code == 409
    client.put(f"/volunteers/{v['id']}", json={"status": "ACTIVE"})  # can be re-enabled
    assert anon().post("/auth/login", json={"email": VOL["email"], "password": VOL["password"]}).status_code == 200


def test_disabled_login_hides_the_reason_from_wrong_passwords(client):
    _, v = volunteer_client(client)
    client.delete(f"/volunteers/{v['id']}")
    assert anon().post("/auth/login", json={"email": VOL["email"], "password": "wrong-password"}).status_code == 401


# ---------- volunteer ----------

def test_volunteer_dashboard_flow(client):
    vc, v = volunteer_client(client)
    me = vc.get("/volunteers/me").json()
    assert me["volunteer"]["skill"] == "MEDICINE" and me["volunteer"]["available"] is True
    alice = user_client()
    near = alice.post("/help-request", json={"type": "Medicine", "priority": "High", **A}).json()["request_id"]
    alice.post("/help-request", json={"type": "Food", **A})  # different skill: not for this volunteer
    assert [r["request_id"] for r in vc.get("/volunteers/me/requests").json()["nearby_open"]] == [near]
    assert vc.get("/volunteers/me").json()["nearby_open_count"] == 1
    # the requester's app matched this volunteer and saved it
    m = alice.post("/matches", json={"help_request_id": near, "volunteer_id": v["id"]}).json()
    mine = vc.get("/volunteers/me/requests").json()
    assert [a["request_id"] for a in mine["assigned"]] == [near] and mine["assigned"][0]["requester_name"] == "Alice"
    assert mine["nearby_open"] == []
    assert vc.get("/help-requests").json()[0]["id"] == near  # assigned request visible to the volunteer
    assert vc.post(f"/matches/{m['id']}/complete").status_code == 409  # must be accepted first
    assert vc.post(f"/matches/{m['id']}/accept").json()["status"] == "ACCEPTED"
    assert vc.post(f"/matches/{m['id']}/accept").status_code == 409
    assert vc.post(f"/matches/{m['id']}/complete").json()["status"] == "COMPLETED"
    assert client.get(f"/help-requests/{near}").json()["status"] == "COMPLETED"
    assert alice.get(f"/help-requests/{near}").json()["status"] == "COMPLETED"  # the requester sees the outcome


def test_volunteer_availability(client):
    vc, v = volunteer_client(client)
    assert vc.patch("/volunteers/me", json={"available": False}).json()["available"] is False
    user = user_client()
    assert v["id"] not in [x["id"] for x in user.get("/volunteers", params={"available": True}).json()]
    rid = user.post("/help-request", json={"type": "MEDICINE", **A}).json()["request_id"]
    assert user.post("/matches", json={"help_request_id": rid, "volunteer_id": v["id"]}).status_code == 409
    assert vc.patch("/volunteers/me", json={"available": True}).json()["available"] is True
    assert vc.patch("/volunteers/me", json={"role": "admin"}).status_code == 422
    assert user.get("/volunteers/me").status_code == 403 and client.get("/volunteers/me").status_code == 403


def test_volunteers_cannot_touch_other_peoples_matches(client):
    v1c, v1 = volunteer_client(client)
    v2c, _ = volunteer_client(client, email="second@test.local", name="Second")
    alice = user_client()
    rid = alice.post("/help-request", json={"type": "MEDICINE", **A}).json()["request_id"]
    m = alice.post("/matches", json={"help_request_id": rid, "volunteer_id": v1["id"]}).json()
    assert v2c.post(f"/matches/{m['id']}/accept").status_code == 404
    assert v2c.get("/matches").json() == [] and v2c.get(f"/help-requests/{rid}").status_code == 404
    assert alice.post(f"/matches/{m['id']}/accept").status_code == 403  # the requester is not the volunteer
    assert v1c.post(f"/matches/{m['id']}/accept").status_code == 200


def test_match_must_fit_the_request(client):
    alice = user_client()
    rid = alice.post("/help-request", json={"type": "MEDICINE", **A}).json()["request_id"]
    assert alice.post("/matches", json={"help_request_id": rid, "volunteer_id": 2}).status_code == 422  # Volunteer 2 = FOOD


# ---------- admin: dashboard, users, reset ----------

def test_admin_summary_and_users(client):
    simulate(client, 80)
    client.post("/roads/1/block")
    user_client()
    s = client.get("/admin/summary").json()
    assert s["risk"]["risk_level"] == "HIGH" and s["active_alerts"] == 3 and s["blocked_roads"] == 1
    assert s["open_incidents"] == 1 and s["pending_help_requests"] == 0 and s["available_volunteers"] == 4
    assert s["users"] == {"user": 1, "volunteer": 0, "admin": 1}
    users = client.get("/admin/users").json()
    assert {u["role"] for u in users} == {"user", "admin"} and "password" not in str(users)


def test_admin_can_disable_a_user_but_not_self(client):
    u = user_client()
    uid = u.get("/auth/me").json()["id"]
    assert client.patch(f"/admin/users/{uid}", json={"is_active": False}).json()["is_active"] is False
    assert u.get("/auth/me").status_code == 401
    assert anon().post("/auth/login", json={"email": "alice@test.local", "password": PW}).status_code == 403
    admin_id = client.get("/auth/me").json()["id"]
    assert client.patch(f"/admin/users/{admin_id}", json={"is_active": False}).status_code == 409
    assert client.patch(f"/admin/users/{uid}", json={"is_active": True}).json()["is_active"] is True
    assert anon().post("/auth/login", json={"email": "alice@test.local", "password": PW}).status_code == 200


def test_reset_keeps_accounts_and_sessions(client):
    vc, v = volunteer_client(client)
    u = user_client()
    vc.patch("/volunteers/me", json={"available": False})
    simulate(client, 120)
    assert client.post("/reset").json()["risk_level"] == "LOW"
    assert client.get("/auth/me").status_code == 200 and u.get("/auth/me").status_code == 200 and vc.get("/auth/me").status_code == 200
    assert vc.get("/volunteers/me").json()["volunteer"]["available"] is True  # roster back to available
    assert len(client.get("/volunteers").json()) == 5  # seeded demo roster + the real volunteer


def test_disaster_features_still_work_for_every_role(client):
    simulate(client, 80)
    for who in (user_client(), volunteer_client(client)[0], client):
        assert who.get("/risk").json()["overall"]["risk_level"] == "HIGH"
        assert len(who.get("/alerts", params={"active_only": True}).json()) == 3
        assert len(who.get("/roads").json()) == 3
    u = user_client("c@test.local")
    assert u.post("/incidents", json={"type": "BLOCKED_ROAD", **A}).status_code == 201
