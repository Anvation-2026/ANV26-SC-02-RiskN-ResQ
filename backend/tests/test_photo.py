"""Incident photo upload: real bytes are stored, validated and access-controlled."""
import struct
import zlib

import pytest
from fastapi.testclient import TestClient

import main
from tests.test_api import A, client, login_as  # noqa: F401  (client fixture = signed-in admin)
from tests.test_auth import PW, anon, register, user_client


def tiny_png() -> bytes:
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"\x00\xff\x00\x00"  # one red pixel
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def report(c):
    return c.post("/incidents", json={"type": "FLOOD", **A}).json()["id"]


def test_reporter_uploads_and_downloads_the_same_bytes(client):
    u = user_client()
    iid = report(u)
    assert u.get("/incidents").json()[0]["has_photo"] is False
    r = u.post(f"/incidents/{iid}/photo", content=tiny_png(), headers={"Content-Type": "image/png"})
    assert r.status_code == 201 and r.json()["stored"] is True and r.json()["content_type"] == "image/png"
    got = u.get(f"/incidents/{iid}/photo")
    assert got.status_code == 200 and got.content == tiny_png()
    assert got.headers["content-type"] == "image/png" and got.headers["x-content-type-options"] == "nosniff"
    assert u.get(f"/incidents/{iid}").json()["has_photo"] is True
    assert client.get(f"/incidents/{iid}/photo").content == tiny_png()  # admin can view it too
    assert len(list(main.PHOTO_DIR.iterdir())) == 1


def test_type_is_decided_by_the_bytes_not_the_header(client):
    iid = report(client)
    assert client.post(f"/incidents/{iid}/photo", content=b"<script>alert(1)</script>", headers={"Content-Type": "image/png"}).status_code == 415
    assert client.post(f"/incidents/{iid}/photo", content=b"GIF89a....", headers={"Content-Type": "image/jpeg"}).status_code == 415
    assert client.post(f"/incidents/{iid}/photo", content=b"", headers={"Content-Type": "image/png"}).status_code == 422
    assert client.post(f"/incidents/{iid}/photo", content=JPEG, headers={"Content-Type": "text/plain"}).status_code == 201  # real JPEG bytes


def test_size_limit_and_one_photo_per_incident(client, monkeypatch):
    iid = report(client)
    monkeypatch.setattr(main, "MAX_PHOTO_BYTES", 100)
    assert client.post(f"/incidents/{iid}/photo", content=JPEG + b"x" * 200).status_code == 413
    monkeypatch.setattr(main, "MAX_PHOTO_BYTES", 5 * 1024 * 1024)
    assert client.post(f"/incidents/{iid}/photo", content=JPEG).status_code == 201
    assert client.post(f"/incidents/{iid}/photo", content=JPEG).status_code == 409


def test_only_reporter_or_admin_can_touch_a_photo(client):
    alice, bob = user_client("alice@test.local"), user_client("bob@test.local")
    iid = report(alice)
    assert bob.post(f"/incidents/{iid}/photo", content=JPEG).status_code == 404
    assert alice.post(f"/incidents/{iid}/photo", content=JPEG).status_code == 201
    assert bob.get(f"/incidents/{iid}/photo").status_code == 404
    assert anon().get(f"/incidents/{iid}/photo").status_code == 401
    assert anon().post(f"/incidents/{iid}/photo", content=JPEG).status_code == 401
    assert client.post("/incidents/9999/photo", content=JPEG).status_code == 404


def test_missing_photo_is_404_and_reset_removes_files(client):
    iid = report(client)
    assert client.get(f"/incidents/{iid}/photo").status_code == 404
    client.post(f"/incidents/{iid}/photo", content=JPEG)
    assert len(list(main.PHOTO_DIR.iterdir())) == 1
    client.post("/reset")
    assert list(main.PHOTO_DIR.iterdir()) == []
