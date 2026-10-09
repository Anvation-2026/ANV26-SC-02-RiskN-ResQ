"""RiskN AI: the RiskN ResQ assistant.

Grounded retrieval: every answer is built from the backend's own data at the time of the question (the flood-intelligence
assessment for the person's position, the cached weather grid, satellite observations, terrain, modelled river discharge,
road states, designated places, alerts, incidents and the person's own help requests). Nothing is estimated here:
a value that is not in the database is reported as unavailable.

Two layers:
  1. The built-in grounded engine (deterministic, always available): recognises the question and composes the answer
     from the retrieved facts. Emergency messages are recognised first and answered with action, not explanation.
  2. Optional LLM wording (Gemini or OpenAI, when a key is configured): the model only rephrases using the same retrieved
     context and strict rules. The source cards, risk badge and actions always come from the grounded engine.
"""
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from pydantic import BaseModel, Field

import config
import db
import flood_intel
import intel_jobs
import road_risk
from engine import _km

logger = logging.getLogger("assistant")
NAME = "RiskN AI"
EMERGENCY_NUMBERS = "112 (national emergency), 108 (ambulance), 101 (fire and rescue), 1070 (Karnataka State Disaster Management)"


# ----------------------------------------------------------------------------------------------------- data models
class ChatAction(BaseModel):
    label: str
    action: str  # open_map | open_evacuation | open_report | open_help | open_volunteer_requests | open_admin_dashboard
    params: Optional[Dict[str, Any]] = None


class ChatSource(BaseModel):
    title: str
    type: str
    status: str                       # e.g. "Current", "STALE", "Periodic", "Modelled", "Unavailable"
    detail: Optional[str] = None
    category: Optional[str] = None    # REAL | MODELLED | HISTORICAL | SIMULATED | STATIC


class RiskBadge(BaseModel):
    level: str
    score: Optional[float] = None
    confidence: Optional[str] = None
    freshness: Optional[str] = None


class ChatMessage(BaseModel):
    role: str
    content: str = Field(..., max_length=2000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    history: Optional[List[ChatMessage]] = Field(default_factory=list, max_length=20)


class ChatResponse(BaseModel):
    reply: str
    sources: List[ChatSource] = Field(default_factory=list)
    risk_badge: Optional[RiskBadge] = None
    actions: List[ChatAction] = Field(default_factory=list)
    suggested_questions: List[str] = Field(default_factory=list)
    context_summary: Optional[Dict[str, Any]] = None
    provider: str  # gemini | openai | grounded_engine
    emergency: bool = False


# ------------------------------------------------------------------------------------------------------- helpers
def ago(iso: Optional[str]) -> str:
    if not iso:
        return "time unknown"
    age = flood_intel.age_minutes(iso)
    if age is None:
        return "time unknown"
    if age < 1:
        return "just now"
    if age < 60:
        return f"{int(age)} min ago"
    if age < 48 * 60:
        return f"{int(age / 60)} h ago"
    return f"{int(age / 1440)} days ago"


def _has(q: str, *words) -> bool:
    return any(w in q for w in words)


def resolve_coordinates(user: dict, lat: Optional[float], lng: Optional[float]) -> Tuple[Optional[float], Optional[float], bool]:
    """The person's position: what the app sent, else the last position saved on the account. Never a made-up default."""
    if lat is not None and lng is not None:
        return float(lat), float(lng), True
    if user.get("latitude") is not None and user.get("longitude") is not None:
        return float(user["latitude"]), float(user["longitude"]), True
    return None, None, False


# --------------------------------------------------------------------------------------------- grounded retrieval
def gather_grounded_context(c, user: dict, lat: Optional[float], lng: Optional[float], query: str = "") -> Dict[str, Any]:
    role = user.get("role", "user")
    located = lat is not None and lng is not None
    cell = flood_intel.nearest_cell(c, lat, lng) if located else None
    assessment = flood_intel.assess_point(c, lat, lng) if cell else None

    weather = None
    if cell:
        interval = config.WEATHER_REFRESH_INTERVAL / 60.0
        age = flood_intel.age_minutes(cell["updated_at"])
        weather = {
            "source": cell["data_source"], "observed_at": cell["observed_at"] or cell["updated_at"],
            "rain_1h_mm": cell["rain_1h"], "rain_3h_mm": cell["rain_3h"], "rain_6h_mm": cell["rain_6h"], "rain_24h_mm": cell["rainfall_24h"],
            "forecast_3h_mm": cell["forecast_3h_mm"], "forecast_6h_mm": cell["forecast_6h_mm"],
            "stale": age is None or age > interval * 3, "simulated": cell["data_source"] == "SIMULATED",
        }

    sat_obs = c.execute("SELECT * FROM satellite_observations WHERE cell=?", (cell["zone"],)).fetchone() if cell else None
    latest_scene = c.execute("SELECT * FROM satellite_scenes ORDER BY acquired_at DESC LIMIT 1").fetchone()
    abnormal = [dict(r) for r in c.execute("SELECT cell, expansion_area_km2, expansion_percentage, observed_at, confidence FROM satellite_observations WHERE abnormal=1").fetchall()]
    terrain = c.execute("SELECT elevation_m, slope_deg, susceptibility, source, fetched_at FROM terrain_data WHERE cell=?", (cell["zone"],)).fetchone() if cell else None
    river = c.execute("SELECT kind, current_value, normal_value, ratio, status, unit, source, fetched_at FROM water_level_observations WHERE cell=?", (cell["zone"],)).fetchone() if cell else None

    roads = road_risk.assess_roads(c)
    places = [dict(r) for r in c.execute("SELECT id, kind, name, latitude, longitude, phone, address, source FROM places").fetchall()]
    if located:
        for p in places:
            p["distance_km"] = round(_km(lat, lng, p["latitude"], p["longitude"]), 2)
        places.sort(key=lambda p: p["distance_km"])

    alerts = [dict(r) for r in c.execute("SELECT id, severity, message, affected_zone, reason, action, created_at, updated_at FROM alerts WHERE active=1 ORDER BY id DESC LIMIT 10").fetchall()]
    zone = db.nearest_zone(lat, lng) if located else None
    history = []
    if zone:
        since = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat(timespec="seconds")
        history = [dict(r) for r in c.execute("SELECT at, risk_level, risk_score, rainfall_24h FROM risk_history WHERE zone=? AND at >= ? ORDER BY id", (zone, since)).fetchall()]

    incidents = [dict(r) for r in c.execute("SELECT id, type, status, latitude, longitude, timestamp FROM incidents WHERE duplicate_of IS NULL AND status IN ('REPORTED','VERIFIED') ORDER BY id DESC LIMIT 20").fetchall()]
    if located:
        for i in incidents:
            i["distance_km"] = round(_km(lat, lng, i["latitude"], i["longitude"]), 2)
        incidents = sorted([i for i in incidents if i["distance_km"] <= 5], key=lambda i: i["distance_km"])

    role_data: Dict[str, Any] = {}
    if role == "user":
        role_data["help_requests"] = [dict(r) for r in c.execute(
            "SELECT id, type, priority, status, quantity, created_at FROM help_requests WHERE user_id=? ORDER BY id DESC LIMIT 3", (user["id"],)).fetchall()]
    elif role == "volunteer":
        vol = c.execute("SELECT * FROM volunteers WHERE user_id=?", (user["id"],)).fetchone()
        role_data["assigned"] = [dict(r) for r in c.execute(
            "SELECT h.id, h.type, h.priority, h.status, h.quantity, m.status AS match_status FROM matches m JOIN help_requests h ON m.help_request_id=h.id "
            "WHERE m.volunteer_id=? AND m.status IN ('PROPOSED','MATCHED','ACCEPTED','EN_ROUTE','ARRIVED') ORDER BY m.id DESC", (vol["id"],)).fetchall()] if vol else []
        open_reqs = [dict(r) for r in c.execute("SELECT id, type, priority, status, quantity, latitude, longitude FROM help_requests WHERE status='OPEN' ORDER BY id DESC LIMIT 10").fetchall()]
        base = (vol["latitude"], vol["longitude"]) if vol and vol["latitude"] is not None else ((lat, lng) if located else None)
        for r in open_reqs:
            r["distance_km"] = round(_km(base[0], base[1], r["latitude"], r["longitude"]), 2) if base and r["latitude"] is not None else None
        role_data["open_nearby"] = sorted(open_reqs, key=lambda r: (r["distance_km"] is None, r["distance_km"] or 0))[:5]
    elif role == "admin":
        n = lambda q: c.execute(q).fetchone()[0]  # noqa: E731
        role_data["admin"] = {
            "users": n("SELECT COUNT(*) FROM users WHERE role='user'"), "volunteers_active": n("SELECT COUNT(*) FROM volunteers WHERE status='ACTIVE'"),
            "volunteers_available": n("SELECT COUNT(*) FROM volunteers WHERE status='ACTIVE' AND available=1"),
            "open_requests": n("SELECT COUNT(*) FROM help_requests WHERE status IN ('OPEN','MATCHED')"),
            "open_incidents": n("SELECT COUNT(*) FROM incidents WHERE status IN ('REPORTED','VERIFIED') AND duplicate_of IS NULL"),
            "unverified_incidents": n("SELECT COUNT(*) FROM incidents WHERE status='REPORTED' AND duplicate_of IS NULL"),
            "active_hotspots": n("SELECT COUNT(*) FROM flood_hotspots WHERE active=1"),
        }

    return {
        "role": role, "name": user.get("name") or "", "location_shared": located, "inside_monitored_area": bool(cell),
        "coords": {"latitude": lat, "longitude": lng} if located else None, "zone": zone,
        "assessment": assessment, "weather": weather,
        "satellite": {"cell_observation": dict(sat_obs) if sat_obs else None, "latest_scene": dict(latest_scene) if latest_scene else None, "abnormal_cells": abnormal[:5]},
        "terrain": dict(terrain) if terrain else None, "river": dict(river) if river else None,
        "roads": {"blocked": [r for r in roads if r["state"] in ("REPORTED_BLOCKED", "VERIFIED_BLOCKED")], "potentially_affected": [r for r in roads if r["state"] == "POTENTIALLY_AFFECTED"]},
        "places": places[:5] if located else [], "places_total": len(places),
        "alerts": alerts, "risk_history": history, "incidents_nearby": incidents[:5], "role_data": role_data,
        "providers": intel_jobs.provider_statuses(),
    }


# ------------------------------------------------------------------------------------------------ grounded engine
EMERGENCY_RE = re.compile(r"\b(trapped|drowning|stuck in (the )?water|water (is )?(entering|coming in|rising fast)|can'?t get out|cannot get out|"
                          r"injured|bleeding|unconscious|sos|help me|save me|emergency now|swept away|electrocut)\w*", re.I)

GLOSSARY = [
    (("glofas",), "GLOFAS: MODELLED RIVER DISCHARGE",
     "GloFAS (Global Flood Awareness System, Copernicus) is a **hydrological model** that estimates how much water rivers carry. RiskN ResQ compares the modelled discharge with the model's normal for the same place.\n\n"
     "• It is **modelled, not a river gauge measurement**.\n• Small urban drains and lakes are not resolved by it.\n• It adds at most 15 points to the risk, and only when discharge is well above normal.",
     "MODELLED", "GloFAS (Open-Meteo Flood API)"),
    (("sentinel-1", "sentinel 1", "sar", "radar"), "SENTINEL-1: SATELLITE RADAR",
     "Sentinel-1 is a European radar satellite. Radar sees through cloud and works at night, so it can map open water during the monsoon. "
     "RiskN ResQ compares the newest pass over each cell with earlier passes on the same orbit and flags an **abnormal gain in open water**.\n\n"
     "• A pass happens every few days, so the observation is often older than today.\n• **Water change observed** is not the same as a confirmed flood: ponds, wetlands and fields can also change.",
     "REAL", "Sentinel-1 via Microsoft Planetary Computer"),
    (("era5", "historical", "climatology"), "ERA5: HISTORICAL RAINFALL",
     "ERA5 is a reanalysis of past weather. RiskN ResQ uses 10 years of daily rainfall per cell to tell whether today's rain is unusual for that place (above its 95th or 99th percentile).",
     "HISTORICAL", "ERA5 via Open-Meteo archive"),
    (("copernicus", "dem", "elevation", "terrain", "slope"), "TERRAIN SUSCEPTIBILITY",
     "Terrain comes from the Copernicus 90 m elevation model: elevation, slope and how low a cell sits compared with its neighbours. "
     "It describes **susceptibility**: low, flat ground collects water first. It adds to the risk only while it is raining and never proves flooding on its own.",
     "STATIC", "Copernicus DEM 90 m (Open-Meteo)"),
    (("confidence",), "WHAT CONFIDENCE MEANS",
     "Confidence describes **how complete and current the evidence is**, not a statistical certainty:\n\n"
     "• **HIGH**: at least 4 of 5 data sources (rain, satellite, terrain, river, history) are available and current, and an elevated estimate is backed by at least 2 independent signals.\n"
     "• **MEDIUM**: at least 3 sources are current.\n• **LOW**: fewer sources, or the weather data is stale.",
     "MODELLED", "RiskN ResQ risk engine"),
    (("stale",), "WHY DATA CAN BE STALE",
     "Each source refreshes on its own schedule. Weather is refreshed every few minutes; it is marked **STALE** when the last successful update is more than three refresh intervals old (for example when the provider is unreachable). "
     "Satellite passes are only every few days, and an observation older than 14 days is not used. Stale data is shown with its time and never presented as live.",
     "REAL", "RiskN ResQ provider monitor"),
    (("how is", "calculated", "calculate", "methodology", "algorithm", "how does the risk", "how risk"), "HOW FLOOD RISK IS CALCULATED",
     "A **prototype, rule-based** model adds up points from independent signals (score 0-100):\n\n"
     "• Rainfall (worst of 24 h, 6 h and 1 h totals): up to 100\n• Forecast rain (next 3-6 h): up to 10\n• Satellite water gain (fresh passes only): up to 20\n"
     "• Terrain susceptibility (only while raining): up to 12\n• Modelled river discharge above normal: up to 15\n• Historical extremes and past floods (only while raining): up to 10\n"
     "• Community reports (secondary): up to 15, and reports alone can never lift the score above 49\n\n"
     "Levels: LOW < 25 ≤ MEDIUM < 50 ≤ HIGH < 75 ≤ CRITICAL. The probability is a logistic mapping of the score and is **uncalibrated**: the weights are documented heuristics, not a validated model.",
     "MODELLED", "RiskN ResQ risk engine"),
    (("probability",), "WHAT THE PROBABILITY MEANS",
     "The probability shown is a logistic mapping of the risk score. It is a **prototype estimate and uncalibrated**: it has not been validated against observed floods, so treat it as a relative indicator.",
     "MODELLED", "RiskN ResQ risk engine"),
    (("hotspot",), "WHAT A HOTSPOT IS",
     "A **potential flood hotspot** is a cell estimated HIGH or worse where at least two independent kinds of evidence agree (for example heavy rain and a satellite water gain). It is not confirmed flooding.",
     "MODELLED", "RiskN ResQ risk engine"),
    (("difference between", "difference between rain", "difference between rainfall"), "DIFFERENCE BETWEEN RAINFALL AND FLOOD RISK",
     "• **Rainfall** is an observable meteorological measurement of precipitation (in mm) over time intervals (1h, 3h, 6h, 24h).\n\n"
     "• **Flood Risk** is a multi-factor risk assessment that models the impact of that rain on terrain. It combines rainfall with elevation/slope (Copernicus DEM), satellite open-water detection (Sentinel-1 SAR), modelled river discharge (GloFAS), and historical vulnerability (ERA5).\n\n"
     "Heavy rain increases flood potential, but low-lying elevation, poor drainage, and saturated soil dictate whether flooding actually occurs.",
     "MODELLED", "RiskN ResQ risk engine"),
    (("what does the rainfall data mean", "rainfall data mean", "what rainfall means"), "UNDERSTANDING RAINFALL DATA",
     "Rainfall data in RiskN ResQ shows precipitation totals across recent time windows:\n\n"
     "• **1h / 3h / 6h Rain**: Short-duration intensity indicating flash-flood potential.\n"
     "• **24h Rain**: Cumulative accumulation saturating soil and drainage basins.\n"
     "• **3h / 6h Forecast**: Near-term precipitation predicted by numerical weather models.\n\n"
     "Values are labelled as **REAL** when live, **STALE** when updates lag, or **SIMULATED** during training drills.",
     "REAL", "Open-Meteo weather service"),
    (("what data sources", "data sources does", "data sources are", "sources used"), "RISKN RESQ DATA SOURCES",
     "RiskN ResQ integrates multi-modal, verifiable environmental data sources:\n\n"
     "1. **Open-Meteo API**: Live hourly precipitation observations and short-range forecast models.\n"
     "2. **Sentinel-1 SAR**: European Space Agency radar satellite observations detecting surface water changes through clouds.\n"
     "3. **Copernicus DEM (90m)**: High-resolution digital elevation model calculating slope and low-lying depression susceptibility.\n"
     "4. **GloFAS (Copernicus)**: Global Flood Awareness System hydrological river discharge model.\n"
     "5. **ERA5 Reanalysis**: 10-year climatological rainfall percentiles for localized extremity scoring.\n"
     "6. **OpenStreetMap / Municipal registries**: Designated shelters, hospitals, and road networks.\n"
     "7. **Verified Community Reports**: Crowdsourced on-the-ground citizen hazard and waterlogging reports.",
     "REAL", "RiskN ResQ data platform"),
]


def _src(title, type_, status, detail=None, category=None):
    return ChatSource(title=title, type=type_, status=status, detail=detail, category=category)


def _risk_sources(ctx) -> List[ChatSource]:
    out = []
    w = ctx.get("weather")
    if w:
        out.append(_src(w["source"], "Rainfall observation and forecast", "STALE" if w["stale"] else "Current", f"observed {ago(w['observed_at'])}", "SIMULATED" if w["simulated"] else "REAL"))
    sat = (ctx.get("satellite") or {}).get("cell_observation")
    if sat:
        out.append(_src("Sentinel-1 SAR", "Satellite water extent", "Periodic", f"pass {str(sat['observed_at'])[:10]}", "REAL"))
    if ctx.get("terrain"):
        out.append(_src("Copernicus DEM 90 m", "Terrain susceptibility", "Static", None, "STATIC"))
    if ctx.get("river"):
        out.append(_src("GloFAS", "Modelled river discharge", "Modelled", f"fetched {ago(ctx['river']['fetched_at'])}", "MODELLED"))
    out.append(_src("RiskN ResQ risk engine", "Prototype rule-based model", "Modelled", "weights not scientifically validated", "MODELLED"))
    return out


def _drill_note(ctx) -> str:
    drills = [a for a in ctx.get("alerts") or [] if (a.get("message") or "").startswith("SIMULATED DRILL")]
    return f"\n\n🟣 **SIMULATED DRILL** active in {', '.join(sorted({a['affected_zone'] for a in drills}))}: this is a drill, not a real warning." if drills else ""


def _need_location(topic: str) -> ChatResponse:
    return ChatResponse(
        reply=f"📍 **LOCATION NOT SHARED**\n\nI need your location to answer about {topic}. Allow location in RiskN ResQ (Home → Allow location), then ask again. "
              f"I will not guess where you are.",
        actions=[ChatAction(label="Open Home", action="open_home")], provider="grounded_engine",
        suggested_questions=["How is flood risk calculated?", "What should I do during a flood?", "What is Sentinel-1?"])


def _emergency(ctx) -> ChatResponse:
    near = (ctx.get("places") or [None])[0]
    lines = [
        "🚨 **CALL 112 NOW** if anyone is in danger. Ambulance 108, fire and rescue 101.",
        "",
        "• Move to the highest floor or ground you can reach. Do not walk or drive through moving water.",
        "• Switch off electricity at the main switch only if you can do it without touching water.",
        "• Keep your phone charged and tell someone where you are.",
    ]
    if near:
        lines.append(f"• Nearest designated point on record: **{near['name']}** ({near['kind'].lower()}), about {near['distance_km']} km away. Designated means listed in the source data, not verified safe.")
    lines.append("\nYou can also request help from nearby volunteers in the app.")
    return ChatResponse(reply="\n".join(lines), emergency=True, provider="grounded_engine",
                        actions=[ChatAction(label="Request help", action="open_help"), ChatAction(label="Nearest evacuation point", action="open_evacuation")],
                        sources=[_src("Emergency guidance", "Standard safety advice", "Standard", "Indian emergency numbers", "REAL")])


def build_grounded_response(query: str, ctx: Dict[str, Any], history: Optional[List[ChatMessage]] = None) -> ChatResponse:
    q = query.lower().strip()
    role = ctx["role"]
    asm = ctx.get("assessment")
    rd = ctx.get("role_data") or {}

    # 0. Someone may be in danger: action first, nothing else
    if EMERGENCY_RE.search(q):
        return _emergency(ctx)

    # 1. Admin overview (admins only)
    if _has(q, "admin", "provider", "system status", "system-wide", "unverified", "analytics", "fleet"):
        if role != "admin":
            return ChatResponse(reply="🔒 **Access Restricted**\n\nSystem-wide statistics and data-provider administration are only available to Super Administrators. "
                                      "You can ask about your flood risk, weather, the nearest designated evacuation point, roads or your help requests.",
                                suggested_questions=["What is my flood risk?", "Where is the nearest shelter?", "Which roads should I avoid?"], provider="grounded_engine")
        a = rd.get("admin") or {}
        prov = "\n".join(f"• **{p['name'].replace('_', ' ').title()}**: {('ONLINE' if p['state'] == 'OK' else p['state'])}"
                         f"{' · last success ' + ago(p.get('last_success')) if p.get('last_success') else ''}{' · error: ' + p['last_error'] if p.get('last_error') else ''}"
                         for p in ctx.get("providers") or [])
        reply = (f"🛡️ **SYSTEM-WIDE INTELLIGENCE OVERVIEW**\n\n"
                 f"• Registered Citizens: **{a.get('users', 0)}**\n• Active Responders: **{a.get('volunteers_active', 0)}** ({a.get('volunteers_available', 0)} available)\n"
                 f"• Open help requests: **{a.get('open_requests', 0)}**\n• Open incident reports: **{a.get('open_incidents', 0)}** ({a.get('unverified_incidents', 0)} awaiting verification)\n"
                 f"• Potential flood hotspots: **{a.get('active_hotspots', 0)}**\n\n**Data providers:**\n{prov or '• No provider has run yet.'}")
        return ChatResponse(reply=reply + _drill_note(ctx), provider="grounded_engine",
                            sources=[_src("RiskN ResQ database", "Operational counts", "Current", None, "REAL"), _src("Provider monitor", "Data-source health", "Current", None, "REAL")],
                            actions=[ChatAction(label="Open admin dashboard", action="open_admin_dashboard")],
                            suggested_questions=["Which data providers are stale?", "How many incidents await verification?"])

    # 2. Explanations of terms and method (no location needed)
    for keys, title, text, cat, src in GLOSSARY:
        if _has(q, *keys) and not _has(q, "my ", "near me", "nearby", "here", "show"):
            return ChatResponse(reply=f"📘 **{title}**\n\n{text}", provider="grounded_engine", sources=[_src(src, title.title(), "Reference", None, cat)],
                                suggested_questions=["What is my flood risk?", "How is flood risk calculated?", "What does confidence mean?"])

    # 3. Volunteer work
    if role == "volunteer" and _has(q, "assigned", "my task", "my request", "nearby", "open request", "claim", "next job"):
        if _has(q, "nearby", "open request", "claim"):
            items = rd.get("open_nearby") or []
            def line(r):
                far = f" · about {r['distance_km']} km away" if r.get("distance_km") is not None else ""
                return f"• **#{r['id']} {r['type'].replace('_', ' ').title()}** · priority {r['priority']}{far}"
            body = "\n".join(line(r) for r in items) \
                or "No open requests are waiting for a volunteer right now."
            return ChatResponse(reply=f"📍 **NEARBY EMERGENCY REQUESTS**\n\n{body}", provider="grounded_engine",
                                sources=[_src("Help requests", "Live database", "Current", None, "REAL")], actions=[ChatAction(label="Open requests", action="open_volunteer_requests")])
        items = rd.get("assigned") or []
        body = "\n".join(f"• **#{r['id']} {r['type'].replace('_', ' ').title()}** · {r['match_status'].replace('_', ' ').lower()} · priority {r['priority']}" for r in items) \
            or "You have no active assignments. Open requests near you are in the Nearby tab."
        return ChatResponse(reply=f"📋 **VOLUNTEER ASSIGNMENTS**\n\n{body}\n\nSteps: accept → start travel → arrived → complete.", provider="grounded_engine",
                            sources=[_src("Matches", "Live database", "Current", None, "REAL")], actions=[ChatAction(label="Open requests", action="open_volunteer_requests")])

    # 4. Help requests (the person's own status, or how to ask)
    if _has(q, "help request", "request help", "need help", "my request", "send help", "medicine", "food", "water supply", "first aid", "evacuate me", "rescue me"):
        reqs = rd.get("help_requests") or []
        status = ""
        if reqs:
            r = reqs[0]
            status = f"\n\n**Your latest request:** #{r['id']} {r['type'].replace('_', ' ').title()} · status **{r['status'].replace('_', ' ')}** · {ago(r['created_at'])}"
        return ChatResponse(reply=f"🆘 **EMERGENCY ASSISTANCE**\n\nRequest Medicine, Food, Water, First Aid, Evacuation, Rescue or other help from the Help tab. "
                                  f"Your position goes to the nearest available volunteer with that resource; once they accept you see their name, distance and arrival time.{status}\n\n"
                                  f"If anyone is in immediate danger, call **112** first.", provider="grounded_engine",
                            sources=[_src("Help requests", "Live database", "Current", None, "REAL")], actions=[ChatAction(label="Request help", action="open_help")])

    # 5. Safety guidance (no location needed)
    if _has(q, "what should i do", "safety", "precaution", "during a flood", "how to prepare", "prepare for"):
        return ChatResponse(reply="🚨 **FLOOD SAFETY INSTRUCTIONS**\n\n• Move to higher ground early if water starts rising; do not wait for it to reach you.\n"
                                  "• Never walk, swim or drive through flood water: 15 cm of moving water can knock a person down, 30 cm can float a car.\n"
                                  "• Switch off electricity and gas only if you can do so without touching water.\n"
                                  "• Keep a bag ready: water, food, medicines, a torch, a charged phone, documents in a waterproof pouch.\n"
                                  "• Follow instructions from local authorities.\n\n"
                                  f"**Emergency numbers:** {EMERGENCY_NUMBERS}.", provider="grounded_engine",
                            sources=[_src("Emergency guidance", "Standard flood-safety advice", "Standard", None, "REAL")],
                            actions=[ChatAction(label="Request help", action="open_help"), ChatAction(label="Nearest evacuation point", action="open_evacuation")])

    # 5b. How to report flooding
    if _has(q, "report flooding", "how to report", "how can i report", "report a flood", "report incident"):
        return ChatResponse(
            reply="📢 **HOW TO REPORT FLOODING**\n\nTo report waterlogging, flooded roads, or localized hazards:\n\n"
                  "1. Tap the **Report** tab in RiskN ResQ.\n"
                  "2. Choose the incident category (Waterlogging, Flooded Road, Trapped Person, Hazard).\n"
                  "3. Attach a photo if safe to do so.\n"
                  "4. Confirm your GPS location and submit.\n\n"
                  "Your submission appears on the community map after cross-referencing with sensor telemetry.",
            provider="grounded_engine",
            sources=[_src("Incident reporting", "Community hazard feed", "Current", None, "REAL")],
            actions=[ChatAction(label="Report flooding", action="open_report")],
            suggested_questions=["What is my flood risk?", "Which roads should I avoid?"]
        )

    # 5c. Alert verification: real vs simulated drill
    if _has(q, "alert real", "real alert", "simulated drill", "is this alert real", "is this real", "is the alert real", "is it a drill"):
        alerts = ctx.get("alerts") or []
        drills = [a for a in alerts if (a.get("message") or "").startswith("SIMULATED DRILL")]
        real_alerts = [a for a in alerts if not (a.get("message") or "").startswith("SIMULATED DRILL")]
        if drills:
            zones = ", ".join(sorted({a["affected_zone"] for a in drills}))
            reply = f"🟣 **SIMULATED DRILL NOTICE**\n\nThe active alert in {zones} is a **SIMULATED DRILL** for emergency training and procedure validation. It is **NOT** a live natural disaster warning."
        elif real_alerts:
            a = real_alerts[0]
            reply = f"🚨 **REAL ACTIVE ALERT**\n\n• **Severity:** {a.get('severity')}\n• **Zone:** {a.get('affected_zone')}\n• **Alert:** {a.get('message')}\n\nThis is a **LIVE OFFICIAL ALERT**. Please adhere to municipal safety directives."
        else:
            reply = "ℹ️ **NO ACTIVE ALERTS**\n\nThere are currently no active warnings or drills (neither real alerts nor simulated drills) in the system for your zone."
        return ChatResponse(
            reply=reply,
            provider="grounded_engine",
            sources=[_src("Alerts service", "Official warning dispatch", "Current", None, "REAL")],
            actions=[ChatAction(label="View risk map", action="open_map", params={"layer": "risk"})]
        )

    # 5d. Active hotspots query
    if _has(q, "are there any flood hotspots", "active hotspots", "show hotspots", "any flood hotspots", "hotspots near"):
        abnormal = (ctx.get("satellite") or {}).get("abnormal_cells") or []
        if abnormal:
            body = "\n".join(f"• **{c['cell']}**: +{c.get('expansion_area_km2', 0)} km² water gain ({c.get('confidence', 'MEDIUM')} confidence)" for c in abnormal[:4])
            reply = f"⚠️ **POTENTIAL FLOOD HOTSPOTS**\n\nThere are **{len(abnormal)}** potential hotspot areas with abnormal satellite water gain:\n{body}\n\n*Note: Hotspots represent areas where multiple independent signals agree, not confirmed flooding.*"
        else:
            reply = "✅ **NO ACTIVE FLOOD HOTSPOTS**\n\nNo multi-signal flood hotspots are currently detected in the monitored area. Satellite passes and sensor grids show normal surface extents."
        return ChatResponse(
            reply=reply,
            provider="grounded_engine",
            sources=[_src("Satellite SAR & Sensor fusion", "Hotspot detection", "Current", None, "MODELLED")],
            actions=[ChatAction(label="View risk map", action="open_map", params={"layer": "risk"})]
        )

    # from here on the answer is about the person's surroundings
    located = ctx.get("location_shared")

    # 6. Rainfall
    if _has(q, "rain", "weather", "precipitation", "forecast", "downpour"):
        if not located:
            return _need_location("the rainfall near you")
        w = ctx.get("weather")
        if not w:
            return ChatResponse(reply="🌧️ **WEATHER & RAINFALL MONITORING**\n\nWeather data unavailable for your position: it is outside the monitored grid or the weather service has not responded yet.", provider="grounded_engine")
        fmt = lambda v: "unavailable" if v is None else f"{v:.1f} mm"  # noqa: E731
        heavy = (w["rain_1h_mm"] or 0) >= config.HEAVY_RAIN_THRESHOLD or (w["rain_24h_mm"] or 0) >= 50
        tag = "SIMULATED DRILL" if w["simulated"] else "STALE DATA" if w["stale"] else "current"
        reply = (f"🌧️ **WEATHER & RAINFALL MONITORING**\n\n• Last hour: **{fmt(w['rain_1h_mm'])}**\n• Last 3 h: **{fmt(w['rain_3h_mm'])}** · last 6 h: **{fmt(w['rain_6h_mm'])}**\n"
                 f"• Last 24 h: **{fmt(w['rain_24h_mm'])}**\n• Forecast next 3 h: **{fmt(w['forecast_3h_mm'])}** · next 6 h: **{fmt(w['forecast_6h_mm'])}**\n\n"
                 f"{'Heavy rain is being recorded near you.' if heavy else 'Rain near you is not heavy right now.'} Source: {w['source']}, observed {ago(w['observed_at'])} ({tag}).\n\n"
                 f"Rain alone does not mean flooding: the flood risk also weighs terrain, river, satellite and history.")
        return ChatResponse(reply=reply, provider="grounded_engine", sources=_risk_sources(ctx)[:1], actions=[ChatAction(label="Rainfall on the map", action="open_map", params={"layer": "rain"})])

    # 7. Satellite observations
    if _has(q, "satellite", "image taken", "water change", "ndwi", "nasa"):
        sat = ctx.get("satellite") or {}
        scene = sat.get("latest_scene")
        mine = sat.get("cell_observation")
        lines = ["🛰️ **SATELLITE INTELLIGENCE**", ""]
        if scene:
            lines.append(f"• Latest Sentinel-1 radar pass processed: **{str(scene['acquired_at'])[:16].replace('T', ' ')} UTC** ({ago(scene['acquired_at'])}).")
        else:
            lines.append("• Satellite data unavailable: no Sentinel-1 pass has been processed yet.")
        if mine:
            lines.append(f"• Your area: {'**Water change observed**: ' + str(mine['expansion_area_km2']) + ' km² more open water than earlier passes' if mine['abnormal'] else 'no abnormal water gain compared with earlier passes'} (pass {str(mine['observed_at'])[:10]}).")
        elif not located:
            lines.append("• Share your location to see the observation for your area.")
        abnormal = sat.get("abnormal_cells") or []
        lines.append(f"• Cells with an abnormal water gain across the monitored area: **{len(abnormal)}**.")
        lines += ["", "Water change observed is not a confirmed flood. Sentinel-1 passes every few days, so the image is usually older than today. "
                      "The map's *Today (NASA)*, *NASA flood* and *Radar water* layers show NASA's daily products with their dates."]
        return ChatResponse(reply="\n".join(lines), provider="grounded_engine", sources=[_src("Sentinel-1 SAR", "Satellite water extent", "Periodic", "Microsoft Planetary Computer", "REAL")],
                            actions=[ChatAction(label="Satellite layers", action="open_map", params={"layer": "satellite"})])

    # 8. Evacuation points
    if _has(q, "evacuat", "shelter", "hospital", "assembly", "where to go", "nearest"):
        if not located:
            return _need_location("the nearest designated evacuation point")
        places = ctx.get("places") or []
        if not places:
            return ChatResponse(reply="🏛️ **EVACUATION POINTS**\n\nNo designated evacuation point (shelter, assembly point or hospital) is loaded for this area. "
                                      "Follow instructions from local authorities and call 112 if you are in danger.", provider="grounded_engine")
        rows = "\n".join(f"• **{p['name']}** ({p['kind'].lower()}) · about {p['distance_km']} km{' · ☎ ' + p['phone'] if p.get('phone') else ''}" for p in places[:4])
        return ChatResponse(reply=f"🏛️ **DESIGNATED EVACUATION POINTS**\n\n{rows}\n\nDesignated means listed in the source data (OpenStreetMap or an administrator); it is not verified safe or confirmed open. "
                                  f"Tap below for a lower-risk route to the nearest one.", provider="grounded_engine",
                            sources=[_src("OpenStreetMap / administrator", "Shelters and hospitals", "Current", None, "REAL")], actions=[ChatAction(label="Route to nearest point", action="open_evacuation")])

    # 9. Roads
    if _has(q, "road", "route", "traffic", "blocked", "avoid", "drive", "closed"):
        roads = ctx.get("roads") or {}
        blocked = roads.get("blocked") or []
        pot = roads.get("potentially_affected") or []
        b = "\n".join(f"• 🚫 **{r['name']}** · {r['state'].replace('_', ' ').lower()}{' · ' + r['reasons'][0] if r.get('reasons') else ''}" for r in blocked[:5]) or "• No road is reported or verified blocked right now."
        p = "\n".join(f"• ⚠️ **{r['name']}**{' · ' + r['reasons'][0] if r.get('reasons') else ''}" for r in pot[:4]) or "• None."
        return ChatResponse(reply=f"🛣️ **ROAD RISK**\n\n**Blocked (reported or verified):**\n{b}\n\n**Potentially affected (area flood risk, not an observation of the road):**\n{p}\n\n"
                                  f"Routes in the app avoid blocked roads and prefer lower flood-risk exposure: a lower-risk route based on current available data, never a guaranteed one.",
                            provider="grounded_engine", sources=[_src("Road status", "OpenStreetMap roads + incidents + admin closures", "Current", None, "REAL")],
                            actions=[ChatAction(label="Road risk on the map", action="open_map", params={"layer": "roads"})])

    # 10. Risk trend ("why did it increase")
    if _has(q, "increase", "went up", "change", "trend", "earlier", "decrease", "went down"):
        if not located:
            return _need_location("how your risk changed")
        h = ctx.get("risk_history") or []
        if len(h) < 2:
            return ChatResponse(reply="📈 **RISK TREND**\n\nNot enough history recorded for your zone in the last 12 hours to describe a trend.", provider="grounded_engine")
        a, b = h[0], h[-1]
        d = (b["risk_score"] or 0) - (a["risk_score"] or 0)
        rain_d = (b["rainfall_24h"] or 0) - (a["rainfall_24h"] or 0)
        return ChatResponse(reply=f"📈 **RISK TREND ({ctx['zone']}, last 12 h)**\n\n• {ago(a['at'])}: **{a['risk_level']}** ({a['risk_score']}/100)\n• {ago(b['at'])}: **{b['risk_level']}** ({b['risk_score']}/100)\n\n"
                                  f"The score {'rose' if d > 0 else 'fell' if d < 0 else 'did not change'} by {abs(d)} points while 24-hour rainfall changed by {rain_d:+.1f} mm. "
                                  f"Ask 'why is my risk at this level?' for every contributing signal.", provider="grounded_engine",
                            sources=[_src("Risk history", "Recorded estimates", "Current", None, "MODELLED")])

    # 11. Default: the flood risk where the person is, with every reason
    if not located:
        return _need_location("your flood risk")
    if not asm or asm.get("insufficient"):
        missing = "; ".join(f"{m['label']}: {m['reason']}" for m in (asm or {}).get("missing") or [])
        outside = "" if ctx.get("inside_monitored_area") else " Your position is outside the monitored area."
        return ChatResponse(reply=f"🌧️ **CURRENT FLOOD RISK**\n\nInsufficient data to estimate current flood risk.{outside}"
                                  f"{chr(10) * 2 + '**Missing:** ' + missing if missing else ''}{_drill_note(ctx)}", provider="grounded_engine", sources=_risk_sources(ctx))
    signals = asm.get("signals") or []
    contrib = sorted([s for s in signals if s.get("points", 0) > 0], key=lambda s: -s["points"])
    why = "\n".join(f"• **{s['label']}**: +{s['points']} ({s.get('source') or 'source not stated'}{', ' + ago(s['observed_at']) if s.get('observed_at') else ''}{', STALE' if s.get('stale') else ''})" for s in contrib) \
        or "• No signal is adding to the risk right now: " + "; ".join(f"{s['label'].lower()} ({s['detail']})" for s in signals[:3])
    missing = asm.get("missing") or []
    level = asm["risk_level"]
    near_alerts = [a for a in ctx.get("alerts") or [] if a.get("affected_zone") == ctx.get("zone") and not (a.get("message") or "").startswith("SIMULATED DRILL")]
    reply = (f"🌧️ **CURRENT FLOOD RISK**\n\n• **Risk Level:** {level}\n• **Score:** {asm['risk_score']}/100\n"
             f"• **Probability:** {round(asm['probability'] * 100) if asm.get('probability') is not None else 'n/a'}% (prototype, uncalibrated)\n"
             f"• **Confidence:** {asm.get('confidence') or 'n/a'}\n• **Updated:** {ago(asm.get('computed_at'))}\n\n"
             f"**WHY THIS RISK:**\n{why}\n"
             f"{chr(10) + '**Not available:** ' + '; '.join(m['label'] for m in missing) + chr(10) if missing else ''}"
             f"{chr(10) + '**Active alert for your zone:** ' + near_alerts[0]['message'] + chr(10) if near_alerts else ''}\n"
             f"**RECOMMENDED ACTION:**\n{asm.get('recommended_action') or 'Keep notifications on.'}{_drill_note(ctx)}")
    return ChatResponse(reply=reply, provider="grounded_engine", sources=_risk_sources(ctx),
                        risk_badge=RiskBadge(level=level, score=asm["risk_score"], confidence=asm.get("confidence"), freshness=ago(asm.get("computed_at"))),
                        actions=[ChatAction(label="Risk map", action="open_map", params={"layer": "risk"}), ChatAction(label="Nearest evacuation point", action="open_evacuation"),
                                 ChatAction(label="Report flooding", action="open_report")],
                        suggested_questions=["Why did my risk change?", "Is it raining heavily near me?", "Where is the nearest designated evacuation point?", "Which roads should I avoid?"])


# ----------------------------------------------------------------------------------------------- optional LLM wording
SYSTEM_PROMPT = f"""You are {NAME}, the assistant inside RiskN ResQ, a flood early-warning and community-response app.
Answer ONLY from the JSON context you are given (retrieved from the app's database for this question) and from the draft answer.
Rules:
1. Never invent numbers, places, roads, shelters, weather, satellite observations or dates. If the context does not contain it, say it is unavailable.
2. Label the nature of data: weather and reports are REAL observations; GloFAS river discharge and the risk score are MODELLED; ERA5 is HISTORICAL; anything marked SIMULATED is a drill.
3. A satellite water change is "water change observed", never "flood confirmed". Terrain is susceptibility, not proof of flooding.
4. Never call a route or place safe: say "lower-risk route based on current available data" and "designated evacuation point".
5. You are not an emergency authority. If someone may be in danger, tell them to call 112 first, briefly.
6. Be concise. Keep the draft's facts and numbers exactly; you may only improve the wording."""


async def query_gemini(api_key: str, prompt: str, context: Dict[str, Any], history: List[ChatMessage], draft: str = "") -> Optional[str]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{config.AI_MODEL or 'gemini-2.5-flash'}:generateContent"
    contents = [{"role": "user", "parts": [{"text": f"{SYSTEM_PROMPT}\n\nCONTEXT:\n{json.dumps(context, default=str)}\n\nDRAFT ANSWER:\n{draft}"}]},
                {"role": "model", "parts": [{"text": "Understood."}]}]
    for m in history[-4:]:
        contents.append({"role": "user" if m.role == "user" else "model", "parts": [{"text": m.content}]})
    contents.append({"role": "user", "parts": [{"text": prompt}]})
    async with httpx.AsyncClient(timeout=12.0) as client:
        resp = await client.post(url, json={"contents": contents, "generationConfig": {"temperature": 0.1, "maxOutputTokens": 700}}, headers={"x-goog-api-key": api_key})
    if resp.status_code != 200:
        logger.warning("Gemini returned HTTP %s", resp.status_code)  # the body can echo request details: not logged
        return None
    parts = ((resp.json().get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
    return parts[0].get("text") if parts else None


async def query_openai(api_key: str, prompt: str, context: Dict[str, Any], history: List[ChatMessage], draft: str = "") -> Optional[str]:
    messages = [{"role": "system", "content": f"{SYSTEM_PROMPT}\n\nCONTEXT:\n{json.dumps(context, default=str)}\n\nDRAFT ANSWER:\n{draft}"}]
    messages += [{"role": "assistant" if m.role != "user" else "user", "content": m.content} for m in history[-4:]]
    messages.append({"role": "user", "content": prompt})
    async with httpx.AsyncClient(timeout=12.0) as client:
        resp = await client.post("https://api.openai.com/v1/chat/completions", headers={"Authorization": f"Bearer {api_key}"},
                                 json={"model": config.AI_MODEL or "gpt-4o-mini", "messages": messages, "temperature": 0.1, "max_tokens": 700})
    if resp.status_code != 200:
        logger.warning("OpenAI returned HTTP %s", resp.status_code)
        return None
    choices = resp.json().get("choices") or []
    return choices[0].get("message", {}).get("content") if choices else None


def llm_provider() -> Optional[str]:
    if config.GEMINI_API_KEY and config.AI_PROVIDER in ("auto", "gemini"):
        return "gemini"
    if config.OPENAI_API_KEY and config.AI_PROVIDER in ("auto", "openai"):
        return "openai"
    return None


async def ask_assistant(user: dict, req: ChatRequest) -> ChatResponse:
    lat, lng, located = resolve_coordinates(user, req.latitude, req.longitude)
    with db.session() as c:
        if not located and user.get("role") == "volunteer":  # a volunteer's own last shared position (it is their account's data)
            v = c.execute("SELECT latitude, longitude FROM volunteers WHERE user_id=?", (user["id"],)).fetchone()
            if v and v["latitude"] is not None:
                lat, lng, located = float(v["latitude"]), float(v["longitude"]), True
        ctx = gather_grounded_context(c, user, lat, lng, req.message)
    grounded = build_grounded_response(req.message, ctx, req.history or [])
    grounded.context_summary = {"location_shared": located, "inside_monitored_area": ctx["inside_monitored_area"], "role": ctx["role"]}
    provider = llm_provider()
    if not provider or grounded.emergency:  # emergencies get the fixed, tested wording, never a model's
        return grounded
    try:
        fn = query_gemini if provider == "gemini" else query_openai
        key = config.GEMINI_API_KEY if provider == "gemini" else config.OPENAI_API_KEY
        text = await fn(key, req.message, ctx, req.history or [], grounded.reply)
    except Exception as e:
        logger.warning("%s unavailable: %s", provider, type(e).__name__)
        text = None
    if text:
        grounded.reply = text.strip()
        grounded.provider = provider
    return grounded


def get_suggested_questions_for_role(role: str, risk_level: str = "LOW") -> List[str]:
    if role == "admin":
        return ["Show system-wide flood intelligence and provider status", "How many incidents await verification?", "How is flood risk calculated?", "What does confidence mean?"]
    if role == "volunteer":
        return ["What are my assigned tasks?", "Show nearby open requests", "Which roads should I avoid?", "What is my current flood risk?"]
    if risk_level in ("HIGH", "CRITICAL"):
        return ["Why is my flood risk high?", "Where is the nearest designated evacuation point?", "Which roads should I avoid?", "What should I do during a flood?", "How do I request help?"]
    return ["What is my current flood risk?", "Why is my risk at this level?", "Is it raining heavily near me?", "Where is the nearest designated evacuation point?",
            "Which roads should I avoid?", "When was the satellite image taken?", "How is flood risk calculated?", "What should I do during a flood?"]
