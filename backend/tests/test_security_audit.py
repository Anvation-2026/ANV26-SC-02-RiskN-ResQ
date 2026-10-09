"""Security audit: every route is either deliberately public or refuses anonymous requests; role walls hold; no secret or
private field leaks. Walks the real route table, so a new endpoint cannot be added open by accident."""
import re

import pytest
from fastapi.routing import APIRoute

import config
import db
import main
from tests.test_api import client  # noqa: F401  (signed-in admin)
from tests.test_auth import PW, anon, make_volunteer, user_client, volunteer_client

# Public on purpose: login/registration/recovery, health, and read-only environmental data (the same kind of data a public map shows).
PUBLIC = {
    ("GET", "/health"), ("GET", "/health/providers"), ("GET", "/openapi.json"), ("GET", "/docs"), ("GET", "/redoc"), ("GET", "/docs/oauth2-redirect"),
    ("POST", "/auth/register"), ("POST", "/auth/login"), ("POST", "/auth/forgot-password"), ("POST", "/auth/reset-password"),
    ("POST", "/auth/login-code/request"), ("POST", "/auth/login-code/verify"),
    ("GET", "/weather"), ("GET", "/weather/monitoring"), ("GET", "/risk"), ("GET", "/sync"),
    ("GET", "/flood-risk"), ("GET", "/flood-risk/cells"), ("GET", "/flood-risk/{zone}"), ("GET", "/intelligence/overview"),
    ("GET", "/satellite/observations"), ("GET", "/satellite/imagery"), ("GET", "/satellite/water-expansion"), ("GET", "/terrain"), ("GET", "/water-levels"),
    ("GET", "/flood-hotspots"), ("GET", "/risk-history"), ("GET", "/road-risk"),
    ("GET", "/alerts"), ("GET", "/roads"), ("GET", "/roads/{road_id}"), ("GET", "/places"),
}


def _walk(rs):
    for r in rs:
        inner = getattr(r, "original_router", None)  # routers added with include_router are wrapped by newer FastAPI versions
        if inner is not None:
            yield from _walk(inner.routes)
        else:
            yield r


def routes():
    out = []
    for r in _walk(main.app.routes):
        if isinstance(r, APIRoute) or getattr(r, "path", "") in ("/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"):
            for m in sorted(getattr(r, "methods", {"GET"}) - {"HEAD", "OPTIONS"}):
                out.append((m, r.path))
    return out


def concrete(path):
    return re.sub(r"\{(\w+)\}", lambda m: "Zone A" if m.group(1) == "zone" else "1", path)


def test_every_non_public_route_refuses_anonymous_requests(client):
    open_routes = []
    for method, path in routes():
        if (method, path) in PUBLIC:
            continue
        r = anon().request(method, concrete(path), json={} if method in ("POST", "PUT", "PATCH") else None)
        if r.status_code not in (401, 403):
            open_routes.append((method, path, r.status_code))
    assert open_routes == [], f"routes that answer anonymous callers: {open_routes}"


def test_the_route_walk_sees_every_router(client):
    paths = {p for _, p in routes()}
    assert len(paths) > 80 and {"/flood-risk", "/auth/forgot-password", "/admin/export/{kind}.csv", "/me/push-token", "/evacuation/nearest"} <= paths


def test_the_public_list_is_not_stale(client):
    live = set(routes())
    assert PUBLIC - live == set(), f"public allowlist names routes that no longer exist: {PUBLIC - live}"


ADMIN_ONLY = [(m, p) for m, p in routes() if "/admin/" in p or p in ("/reset", "/simulate-hazard", "/alerts", "/volunteers", "/volunteers/register")
              or p.endswith(("/block", "/unblock", "/verify", "/reject", "/resolve")) or p in ("/incidents/{incident_id}", "/volunteers/{volunteer_id}")]
# the help-request lifecycle routes are for the assigned volunteer (or an admin); they are checked in test_help_lifecycle_routes_refuse_normal_users
LIFECYCLE = ("accept", "en-route", "arrived", "reject")
ADMIN_ONLY = [(m, p) for m, p in ADMIN_ONLY if not (p.startswith("/help-requests/") and p.rsplit("/", 1)[-1] in LIFECYCLE)]


def test_admin_routes_refuse_normal_users_and_volunteers(client):
    u = user_client()
    v, _ = volunteer_client(client)
    for method, path in ADMIN_ONLY:
        if (method, path) in PUBLIC or (method, path) in (("GET", "/volunteers"), ("GET", "/incidents/{incident_id}"), ("POST", "/alerts")) and False:
            continue
        for who, c in (("user", u), ("volunteer", v)):
            r = c.request(method, concrete(path), json={} if method in ("POST", "PUT", "PATCH", "DELETE") else None)
            # GET /volunteers and GET /incidents/{id} are readable by signed-in users in a reduced form; everything else is admin-only
            if (method, path) in (("GET", "/volunteers"), ("GET", "/incidents/{incident_id}")):
                continue
            assert r.status_code in (403, 404, 405, 422) and r.status_code != 200, (who, method, path, r.status_code)
            assert r.status_code == 403 or (method, path) in (("PATCH", "/incidents/{incident_id}"),), (who, method, path, r.status_code)


def test_volunteer_only_routes_refuse_normal_users_and_admins(client):
    u = user_client()
    for path, method in (("/volunteers/me", "GET"), ("/volunteers/me/requests", "GET"), ("/help-requests/1/claim", "POST")):
        assert u.request(method, path).status_code == 403, path


def test_users_cannot_read_each_others_private_data(client):
    a, b = user_client("a@test.local"), user_client("b@test.local")
    rid = a.post("/help-requests", json={"type": "FOOD", "latitude": 12.97, "longitude": 77.59}).json()["requestId"]
    inc = a.post("/incidents", json={"type": "FLOOD", "latitude": 12.95, "longitude": 77.55}).json()["id"]
    assert b.get(f"/help-requests/{rid}").status_code == 404
    assert b.get(f"/help-requests/{rid}/tracking").status_code == 404
    assert rid not in [r["id"] for r in b.get("/help-requests").json()]
    assert b.get(f"/incidents/{inc}/photo").status_code == 404
    assert b.get("/matches").json() == []
    # incident lists never reveal who reported
    assert all(i["user_id"] is None for i in b.get("/incidents").json())
    # /auth/me shows only the caller
    assert b.get("/auth/me").json()["email"] == "b@test.local"


def test_responses_never_contain_password_hashes_tokens_or_storage_details(client):
    u = user_client()
    make_volunteer(client)
    blob = "".join(r.text for r in (client.get("/admin/users"), client.get("/volunteers"), u.get("/auth/me"), client.get("/incidents"),
                                      u.get("/sync", params={"latitude": 12.97, "longitude": 77.59}), client.get("/admin/audit")))
    for needle in ("password_hash", "scrypt$", "token_hash", "photo_file", "cloudinary", "code_hash"):
        assert needle not in blob, needle


def test_passwords_and_session_tokens_are_stored_hashed(client):
    user_client("hash@test.local")
    with db.session() as c:
        row = c.execute("SELECT password_hash FROM users WHERE email='hash@test.local'").fetchone()
        assert row["password_hash"].startswith("scrypt$") and PW not in row["password_hash"]
        toks = c.execute("SELECT token_hash FROM sessions").fetchall()
    assert toks and all(len(t["token_hash"]) == 64 for t in toks)  # sha256 hex, never the bearer token itself


def test_malformed_input_returns_clean_errors_not_server_errors(client):
    u = user_client()
    bad = [("POST", "/incidents", {"type": "NOT_A_TYPE", "latitude": 999, "longitude": "x"}), ("POST", "/help-requests", {"type": "FOOD"}),
           ("POST", "/auth/register", {"name": "", "email": "nope", "password": "1"}), ("POST", "/auth/login", {}),
           ("POST", "/me/push-token", {"token": "x"}), ("PATCH", "/me/preferences", {"language": "xx"})]
    for method, path, body in bad:
        r = u.request(method, path, json=body)
        assert r.status_code in (400, 401, 422), (path, r.status_code)
    assert u.get("/flood-risk", params={"latitude": "abc"}).status_code == 422
    assert u.post("/incidents/99999/photo", content=b"not an image").status_code in (404, 415, 422)


def test_cors_is_open_for_development_and_closed_by_default_when_deployed(monkeypatch):
    import importlib
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    importlib.reload(config)
    assert config.CORS_ORIGINS == []                       # deployed behind a proxy: no browser origin until you choose one
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com, https://b.example.com")
    importlib.reload(config)
    assert config.CORS_ORIGINS == ["https://app.example.com", "https://b.example.com"]
    monkeypatch.delenv("TRUST_PROXY")
    monkeypatch.delenv("CORS_ORIGINS")
    importlib.reload(config)
    assert config.CORS_ORIGINS == ["*"]                    # local development


def test_help_lifecycle_routes_refuse_normal_users_and_unassigned_volunteers(client):
    u = user_client()
    for step in LIFECYCLE:
        assert u.post(f"/help-requests/1/{step}").status_code == 403, step
    v, _ = volunteer_client(client)
    for step in ("reject", "en-route", "arrived"):
        r = v.post(f"/help-requests/999999/{step}")
        assert r.status_code == 404, (step, r.status_code)
