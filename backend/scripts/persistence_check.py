"""Creates real records through the API, RESTARTS the backend, and checks they are still there; then checks that /reset clears
only runtime state. Runs against the isolated E2E backend (scripts/e2e_backend.sh), never production data.
    scripts/e2e_backend.sh start && python scripts/persistence_check.py"""
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

BASE = f"http://127.0.0.1:{os.environ.get('E2E_PORT', '8000')}"
HERE = {"latitude": 12.9716, "longitude": 77.5946}
ADMIN = {"email": "e2e-admin@test.local", "password": "E2e-admin-pass-1"}
USER = {"name": "Persist User", "email": f"persist{int(time.time())}@test.local", "password": "Persist-pass-123"}
VOL = {"name": "Persist Vol", "email": f"vol{int(time.time())}@test.local", "password": "Persist-vol-123", "skill": "Medicine", **HERE}
fails = []


def check(name, ok, extra=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  {extra}" if extra else ""))
    if not ok:
        fails.append(name)


def login(c, cred):
    r = c.post("/auth/login", json=cred)
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def restart():
    subprocess.run([str(Path(__file__).with_name("e2e_backend.sh")), "restart"], check=True, capture_output=True)


c = httpx.Client(base_url=BASE, timeout=30)
admin = login(c, ADMIN)
vol = c.post("/volunteers", json=VOL, headers=admin).json()
check("volunteer created by admin", "id" in vol)
c.post("/auth/register", json={**USER, "confirm_password": USER["password"]})
user = login(c, USER)
inc = c.post("/incidents", json={"type": "FLOOD", **HERE, "severity": 3, "description": "persistence check"}, headers=user).json()
req = c.post("/help-requests", json={"type": "MEDICINE", "priority": "HIGH", **HERE}, headers=user).json()
check("incident created", "id" in inc)
check("help request matched to the volunteer", req.get("match", {}).get("matched") is True, str(req.get("match", {}).get("volunteer", {}).get("name")))
rid = req["requestId"]

restart()  # ------------------------------------------------------------- the backend process is gone and comes back
c = httpx.Client(base_url=BASE, timeout=30)
admin = login(c, ADMIN)
check("user still exists and can log in after restart", c.post("/auth/login", json=USER).status_code == 200)
user = login(c, USER)
vol_login = c.post("/auth/login", json={"email": VOL["email"], "password": VOL["password"]})
check("volunteer still exists and can log in after restart", vol_login.status_code == 200)
check("incident persisted", any(i["id"] == inc["id"] for i in c.get("/incidents", headers=admin).json()))
reqs = c.get("/help-requests", headers=user).json()
check("help request persisted", any(r["id"] == rid for r in reqs))
matches = c.get("/matches", headers=admin).json()
check("match persisted", any(m["help_request_id"] == rid and m["status"] in ("MATCHED", "ACCEPTED") for m in matches))

# volunteer accepts and completes, restart again: statuses persist
vh = {"Authorization": "Bearer " + vol_login.json()["token"]}
mid = next(m["id"] for m in matches if m["help_request_id"] == rid)
check("volunteer accepts", c.post(f"/matches/{mid}/accept", headers=vh).status_code == 200)
check("volunteer completes", c.post(f"/matches/{mid}/complete", headers=vh).status_code == 200)
restart()
c = httpx.Client(base_url=BASE, timeout=30)
user = login(c, USER)
t = c.get(f"/help-requests/{rid}/tracking", headers=user).json()
check("completed status and timeline persisted", t["status"] == "COMPLETED" and [e["event"] for e in t["timeline"]][-1] == "COMPLETED", str([e["event"] for e in t["timeline"]]))

# reset clears runtime state only
admin = login(c, ADMIN)
cells_before = len(c.get("/weather/monitoring").json()["locations"])
check("reset succeeds", c.post("/reset", headers=admin).status_code == 200)
check("reset removed incidents", not any(i["id"] == inc["id"] for i in c.get("/incidents", headers=admin).json()))
check("reset removed help requests", c.get("/help-requests", headers=admin).json() == [])
check("reset kept the user account", c.post("/auth/login", json=USER).status_code == 200)
check("reset kept the volunteer account", c.post("/auth/login", json={"email": VOL["email"], "password": VOL["password"]}).status_code == 200)
check("reset kept the admin", c.post("/auth/login", json=ADMIN).status_code == 200)
check("reset kept the road network", len(c.get("/roads").json()) >= 3)
check("reset kept the real weather grid (observations are not demo state)", len(c.get("/weather/monitoring").json()["locations"]) == cells_before, f"{cells_before} cells")
print("\nRESULT:", "ALL PASSED" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
