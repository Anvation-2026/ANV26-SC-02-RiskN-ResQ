"""Normal operation holds only real data: no fake users, volunteers, incidents, requests or matches."""
import pytest
from fastapi.testclient import TestClient

import auth
import db
import main
from tests.test_api import ADMIN, A, login_as
from tests.test_auth import PW, anon, register, volunteer_client


@pytest.fixture()
def real(monkeypatch):
    """A fresh database started the way production starts it: DEMO_DATA off."""
    monkeypatch.setattr(db, "DEMO_DATA", False)
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN["email"])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN["password"])
    with TestClient(main.app) as c:
        login_as(c, ADMIN)
        yield c


def test_fresh_database_has_no_fake_people_incidents_requests_or_matches(real):
    assert [u["role"] for u in real.get("/admin/users").json()] == ["admin"]  # only the configured Super Admin
    assert real.get("/volunteers").json() == []
    assert real.get("/incidents").json() == []
    assert real.get("/help-requests").json() == []
    assert real.get("/matches").json() == []
    assert real.get("/alerts").json() == []


def test_reference_data_is_still_there(real):
    assert len(real.get("/roads").json()) == 3  # the road network is reference data, not fake activity
    assert real.get("/risk", params={"zone": "Zone A"}).json()["risk_level"] == "LOW"


def test_reset_does_not_bring_back_fake_data(real):
    real.post("/reset")
    assert real.get("/volunteers").json() == [] and real.get("/incidents").json() == []


def test_help_request_without_real_volunteers_is_an_honest_no_match(real):
    from tests.test_auth import user_client
    r = user_client().post("/help-requests", json={"type": "MEDICINE", "priority": "HIGH", "latitude": 12.9716, "longitude": 77.5946})
    assert r.status_code == 201
    assert r.json()["match"]["matched"] is False and "volunteer" not in r.json()["match"]
    assert real.get("/matches").json() == []  # nothing invented


def test_real_records_are_stored_and_visible_to_the_admin(real):
    assert register(anon(), "rahul@real.test", "Rahul").status_code == 201
    assert "rahul@real.test" in [u["email"] for u in real.get("/admin/users").json()]  # appears in the admin list at once
    u = anon()
    login_as(u, {"email": "rahul@real.test", "password": PW})
    inc = u.post("/incidents", json={"type": "BLOCKED_ROAD", "description": "Tree down", **A}).json()
    assert [i["id"] for i in real.get("/incidents").json()] == [inc["id"]]
    vc, v = volunteer_client(real, latitude=12.9716, longitude=77.5946)
    req = u.post("/help-request", json={"type": "MEDICINE", "priority": "HIGH", **A}).json()["request_id"]
    assert u.post("/matches", json={"help_request_id": req, "volunteer_id": v["id"]}).status_code == 201
    assert len(vc.get("/volunteers/me/requests").json()["assigned"]) == 1


def test_remove_demo_data_script_keeps_real_records(monkeypatch):
    import scripts.remove_demo_data as cleaner
    monkeypatch.setattr(db, "DEMO_DATA", True)
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN["email"])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN["password"])
    with TestClient(main.app) as c:
        login_as(c, ADMIN)
        assert len(c.get("/volunteers").json()) == 4 and len(c.get("/incidents").json()) == 1  # sample data present
        vc, v = volunteer_client(c)  # a REAL volunteer (has a login)
        cleaner.main()
        names = [x["name"] for x in c.get("/volunteers").json()]
        assert names == [v["name"]] and c.get("/incidents").json() == []
