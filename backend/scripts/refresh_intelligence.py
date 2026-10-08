"""Run the flood-intelligence ingestion jobs once, now (they also run on a schedule inside the server).

    python scripts/refresh_intelligence.py                 # weather, terrain, climatology, river level, satellite
    python scripts/refresh_intelligence.py satellite       # only some jobs
Prints each provider's status afterwards; a provider that is down is reported, never faked."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db  # noqa: E402
import intel_jobs  # noqa: E402
import main  # noqa: E402
import weather_monitor  # noqa: E402


async def go(jobs):
    db.init_db(reset=False)
    if "weather" in jobs:
        w = await weather_monitor.refresh(main.weather_provider)
        print("weather:", w["status"], w["last_error"] or "")
    out = await intel_jobs.run_all(main.intel_providers, tuple(j for j in jobs if j != "weather"))
    for k, v in out.items():
        print(f"{k}: {v}")
    print()
    for s in intel_jobs.provider_statuses():
        print(f"{s['name']:12s} {s['state']:11s} {s['detail']}" + (f"   [error: {s['last_error']}]" if s['last_error'] else ""))


if __name__ == "__main__":
    asyncio.run(go(sys.argv[1:] or ["weather", "terrain", "climatology", "water", "satellite"]))
