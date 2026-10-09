"""Cloudinary photo storage. The real Cloudinary service is replaced by a fake HTTP transport, so these tests check
exactly what the backend sends (signed request, no secret leaked) and what it stores, not Cloudinary itself."""
import hashlib
import re

import httpx
import pytest

import storage
from tests.test_api import A, client  # noqa: F401  (client = signed-in admin)
from tests.test_auth import anon, user_client
from tests.test_photo import JPEG, tiny_png

SECRET = "test-secret-not-real"
URL = "https://res.cloudinary.com/democloud/image/upload/v1/risknresq/incidents/incident_1_abc.png"


@pytest.fixture()
def cloud(monkeypatch):
    monkeypatch.setenv("CLOUDINARY_CLOUD_NAME", "democloud")
    monkeypatch.setenv("CLOUDINARY_API_KEY", "123456")
    monkeypatch.setenv("CLOUDINARY_API_SECRET", SECRET)
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"secure_url": URL, "public_id": "x"})

    monkeypatch.setattr(storage, "_transport", httpx.MockTransport(handler))
    return sent


def test_signature_follows_cloudinary_rules():
    params = {"timestamp": "1315060510", "public_id": "sample", "folder": "f"}
    expected = hashlib.sha1(("folder=f&public_id=sample&timestamp=1315060510" + "s3cr3t").encode()).hexdigest()
    assert storage.sign(params, "s3cr3t") == expected
    assert storage.sign({"b": "2", "a": "1"}, "k") == storage.sign({"a": "1", "b": "2"}, "k")  # order never matters


def test_thumbnail_url_requests_a_resized_image():
    assert "/upload/c_limit,w_1000,q_auto/" in storage.thumbnail_url(URL)
    assert storage.thumbnail_url("https://example.com/x.png") == "https://example.com/x.png"


def test_upload_goes_to_cloudinary_signed_and_the_url_is_stored(client, cloud):
    u = user_client()
    iid = u.post("/incidents", json={"type": "FLOOD", **A}).json()["id"]
    r = u.post(f"/incidents/{iid}/photo", content=tiny_png(), headers={"Content-Type": "image/png"})
    assert r.status_code == 201 and r.json()["storage"] == "cloudinary"
    req = cloud[0]
    assert str(req.url) == "https://api.cloudinary.com/v1_1/democloud/image/upload"
    body = req.read().decode("latin1")
    assert SECRET not in body and "api_secret" not in body  # the secret is used to sign, never sent
    sig = re.search(r'name="signature"\r\n\r\n([0-9a-f]{40})', body).group(1)
    ts = re.search(r'name="timestamp"\r\n\r\n(\d+)', body).group(1)
    pid = re.search(r'name="public_id"\r\n\r\n([^\r]+)', body).group(1)
    assert sig == storage.sign({"folder": storage.FOLDER, "public_id": pid, "timestamp": ts}, SECRET)
    # stored as a URL reference in the database, not as image bytes
    from db import session
    with session() as c:
        row = c.execute("SELECT photo_url, photo_file FROM incidents WHERE id=?", (iid,)).fetchone()
    assert row["photo_url"] == URL and row["photo_file"] is None


def test_photo_is_served_through_an_authorised_redirect_and_never_exposed_raw(client, cloud):
    u = user_client()
    iid = u.post("/incidents", json={"type": "FLOOD", **A}).json()["id"]
    u.post(f"/incidents/{iid}/photo", content=tiny_png())
    got = u.get(f"/incidents/{iid}/photo", follow_redirects=False)
    assert got.status_code == 307 and got.headers["location"].startswith("https://res.cloudinary.com/democloud/image/upload/c_limit")
    assert client.get(f"/incidents/{iid}/photo", follow_redirects=False).status_code == 307  # admin too
    assert user_client("other@test.local").get(f"/incidents/{iid}/photo", follow_redirects=False).status_code == 404
    assert anon().get(f"/incidents/{iid}/photo", follow_redirects=False).status_code == 401
    for payload in (u.get(f"/incidents/{iid}").json(), client.get("/incidents").json()[0]):
        assert payload["has_photo"] is True and "photo_url" not in payload and "cloudinary" not in str(payload)
    assert u.post(f"/incidents/{iid}/photo", content=tiny_png()).status_code == 409  # one photo per incident


def test_a_cloudinary_failure_is_reported_and_the_incident_is_kept(client, monkeypatch):
    monkeypatch.setenv("CLOUDINARY_CLOUD_NAME", "democloud")
    monkeypatch.setenv("CLOUDINARY_API_KEY", "1")
    monkeypatch.setenv("CLOUDINARY_API_SECRET", SECRET)
    monkeypatch.setattr(storage, "_transport", httpx.MockTransport(lambda r: httpx.Response(401, json={"error": {"message": "bad key"}})))
    u = user_client()
    iid = u.post("/incidents", json={"type": "FLOOD", **A}).json()["id"]
    r = u.post(f"/incidents/{iid}/photo", content=tiny_png())
    assert r.status_code == 502 and "unavailable" in r.json()["detail"].lower()
    assert "bad key" not in r.text and SECRET not in r.text  # no internals leaked
    assert u.get(f"/incidents/{iid}").json()["has_photo"] is False  # nothing recorded
    assert any(i["id"] == iid for i in client.get("/incidents").json())  # the report itself survived


def test_without_credentials_photos_stay_on_local_disk(client, monkeypatch):
    for k in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"):
        monkeypatch.delenv(k, raising=False)
    u = user_client()
    iid = u.post("/incidents", json={"type": "FLOOD", **A}).json()["id"]
    r = u.post(f"/incidents/{iid}/photo", content=JPEG)
    assert r.status_code == 201 and r.json()["storage"] == "local"
    assert u.get(f"/incidents/{iid}/photo").status_code == 200


def test_a_client_cannot_plant_a_photo_link(client):
    u = user_client()
    body = {"type": "FLOOD", "photoUrl": "https://evil.example/x.png", **A}
    iid = u.post("/incidents", json=body).json()["id"]
    assert u.get(f"/incidents/{iid}").json()["has_photo"] is False
    assert u.get(f"/incidents/{iid}/photo").status_code == 404


def test_cloudinary_url_is_accepted_as_well_as_the_three_variables(monkeypatch):
    import storage
    for k in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "CLOUDINARY_URL"):
        monkeypatch.delenv(k, raising=False)
    assert storage.cloud_configured() is False
    monkeypatch.setenv("CLOUDINARY_URL", "cloudinary://123456:s3cr3t@democloud")
    assert storage.credentials() == ("democloud", "123456", "s3cr3t") and storage.cloud_configured() is True
    monkeypatch.setenv("CLOUDINARY_URL", "not-a-cloudinary-url")
    assert storage.cloud_configured() is False
