# Satellite flood detection and lower-risk route navigation

## What it does
1. **Satellite flood detection.** Sentinel-1 radar change detection finds *potential newly inundated land*: a recent pass compared with earlier passes from the same orbit track. Results are flood polygons with areas in km², the satellite and baseline dates, a data-quality grade and warnings. They appear on the map as the **Satellite flood (S1)** layer.
2. **Navigate Safely** (lower-risk route planner). You choose a start point (GPS or a searched place) and a destination (search, or a tap on the map). The backend gets candidate routes from the routing service, intersects each route with RiskN ResQ's own hazard layers, then ranks them. The map shows the recommended route, the alternatives, the hazards, directions and how fresh the data is.
3. **Reassessment.** While you follow a route, the app re-checks it every 2 minutes against stored hazards. This never starts a new satellite run. If a new credible hazard is on the route, the app offers a new route, and you choose whether to switch.

A detection is never called an officially confirmed flood, and a route is never called safe.

## Route out of a flood area (`backend/exit_route.py`)
When the app warns you that you are in a flagged flood area (an emergency panel or a HIGH/CRITICAL alert, including an admin **SIMULATED DRILL**), **Show lower-risk route** opens the quickest real road route *out* of that area. It no longer only looks up the nearest evacuation point; that is still available as a separate button.

- **Flagged area:**
  - HIGH/CRITICAL zone alerts: a circle of `ZONE_ALERT_RADIUS_KM` (3.5 km) around the zone centre. The app applies a zone alert only to people inside this circle.
  - HIGH/CRITICAL weather-based risk cells.
  - Fresh satellite detections, plus a 300 m margin.
  - Verified or credible flood reports, plus a 300 m margin.
- **Exit candidates:**
  - Points 500 m beyond the edge of the area in 16 directions from you.
  - Designated shelters and hospitals outside the area.
- **Choosing a route:**
  - One OSRM `table` request gives driving times to all candidates.
  - The quickest four, in distinct directions, are routed with turn-by-turn steps.
  - Each route is checked against the hazard layer. Ranking: no EXCLUDE hazard first, then the time until the route leaves the area, then total time.
- **Statuses:** `EXIT_ROUTE_FOUND`, `ALREADY_OUTSIDE`, `NO_EXIT_FOUND`, `ALL_ROUTES_AFFECTED`.
- **Drills:** the area is simulated and labelled as such; the roads and the route are real. The destination is "a lower-risk area outside the flagged flood zone", never "safe".
- **Endpoint:** `POST /routes/exit` `{origin}` (signed in).

## Satellite method (`backend/flood_analysis.py`)
| Step | Planetary Computer engine (default, no key) | Earth Engine engine (when configured) |
|---|---|---|
| Imagery | `sentinel-1-rtc` (Sentinel-1 GRD, radiometrically terrain-corrected) | `COPERNICUS/S1_GRD`, IW mode, VV |
| After / baseline | Newest pass; up to 3 passes on the same track, 10–60 days earlier (or an admin-chosen pre-event window) | Same rule |
| Speckle reduction | 3 × 3 median filter + median of the baseline passes | 50 m focal median + median baseline |
| New water | VV now < −18 dB, baseline ≥ −18 dB, and a drop of at least `FLOOD_CHANGE_DB` (−3 dB) | Same thresholds |
| Permanent water | JRC Global Surface Water seasonality ≥ 10 months, removed | `JRC/GSW1_4` seasonality ≥ 10, removed |
| Slopes / shadow | Copernicus DEM 30 m; slope > `FLOOD_MAX_SLOPE_DEG` (5°) masked | HydroSHEDS DEM slope mask |
| Built-up areas | ESA WorldCover share reported as a warning (radar misses flooded streets) | ESA WorldCover share |
| Noise filter | Patches < `FLOOD_MIN_AREA_M2` (20 000 m²) dropped | Connected-pixel filter + the same minimum area |
| Area | Shapely, in a local Lambert azimuthal equal-area projection (pyproj) | Same post-processing |

**Statuses:**
- `QUEUED`, `RUNNING`, `COMPLETED`.
- `INSUFFICIENT_DATA`: no pass, no same-track baseline, or too little coverage.
- `UNAVAILABLE`: the imagery service failed.
- `FAILED`.

No result is invented. A pass older than `FLOOD_ANALYSIS_STALE_DAYS` (12 days) is labelled **STALE** and is not used to choose routes.

**Quality grade:**
- **MODERATE** at best, never HIGH: this is a single-sensor threshold method with no ground-truth validation.
- **LOW** when any of these apply: only one baseline pass, coverage below 80%, 40% or more built-up area, no permanent-water mask, or a stale pass.

**When analyses run:**
- **Automatically:** once per new Sentinel-1 pass over the monitored area, at most one automatic attempt every 6 hours.
- **On demand by an admin:** `POST /flood-analysis/run`. Only one analysis runs at a time, and an identical analysis less than 6 hours old is reused.

## Safe-route method (`backend/safe_route.py`)
Hazard classes:

| Class | Hazards | Effect |
|---|---|---|
| EXCLUDE | <ul><li>Satellite detections ≤ 3 days old</li><li>Verified reports</li><li>Credible reports (trust ≥ 45, ≤ 48 h)</li><li>Admin road closures</li></ul> | The route cannot be recommended |
| AVOID | <ul><li>Satellite detections 3–12 days old</li><li>Unverified blocked-road reports</li><li>Lower-trust reports</li></ul> | The route ranks lower by metres exposed (× reliability) |
| CAUTION | Weather-based HIGH/CRITICAL risk cells (~9 km) | Penalty of 0.3 s per metre exposed |

**Candidates:**
- The routing service's alternatives.
- When only one route comes back, two corridor detours.
- When routes cross hazards, detours forced around them with via waypoints.
- Detours more than 1.8× slower than the fastest route are dropped.

**Ranking order:** EXCLUDE exposure, then AVOID exposure (in 25 m steps), then travel time plus the CAUTION penalty, then distance.

**Statuses:**
- `RECOMMENDED`.
- `ALL_ROUTES_AFFECTED`: no route is recommended. The least-exposed route is listed with a warning.
- `NOT_CHECKED`: neither the satellite layer nor the weather layer covers the trip.

Turn-by-turn steps come from OSRM (`steps=true`). The Google Routes provider gives no steps; the app says so.

## Endpoints
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/flood-analysis/run` | admin | Start an analysis (`bbox`, `after_date`, `baseline_start`/`baseline_end`, `force`) |
| GET | `/flood-analysis/status/{id}` | signed in | Status and message |
| GET | `/flood-analysis/results/{id}` | signed in | GeoJSON polygons, km², dates, quality, warnings, limitations |
| GET | `/flood-analysis/latest` | signed in | Newest completed analysis (the map layer) |
| GET | `/flood-analysis/engine` | admin | Which engine is active / how to configure Earth Engine |
| POST | `/routes/safe-route` | signed in | `{origin, destination}` → ranked routes, hazards, coverage, warnings (12/min per user) |
| POST | `/routes/reassess` | signed in | `{geometry, known_hazard_ids, current_position?, destination?}` → new hazards + optional new plan (30/min per user) |

The existing `/routes/compute` endpoint is unchanged. The volunteer map and the response flow still use it.

## Configuration
None of these are required. Without Earth Engine, the keyless Planetary Computer engine runs.

| Variable | Default | Meaning |
|---|---|---|
| `FLOOD_ANALYSIS_ENGINE` | `auto` | `auto` (Earth Engine if configured, else Planetary Computer), `gee`, or `planetary` |
| `GEE_SERVICE_ACCOUNT_JSON` | – | **Secret.** Earth Engine service-account key JSON, or base64 of it. Never commit it. |
| `GEE_PROJECT` | – | Google Cloud project registered for Earth Engine |
| `FLOOD_CHANGE_DB` | `-3` | Backscatter drop that marks new water |
| `FLOOD_MIN_AREA_M2` | `20000` | Smallest flood patch kept |
| `FLOOD_MAX_SLOPE_DEG` | `5` | Steeper ground is masked |
| `FLOOD_ANALYSIS_PIXELS` | `640` | Raster width for Planetary Computer (128–1024) |
| `FLOOD_AUTO_ANALYSIS` | `1` | Analyse each new pass automatically |
| `FLOOD_ANALYSIS_STALE_DAYS` | `12` | Older passes are labelled STALE and not used to choose routes |

### Setting up Google Earth Engine (optional)
1. Register a Google Cloud project for Earth Engine at https://code.earthengine.google.com/register. Noncommercial use can be free; check the current terms.
2. In that project, enable the **Earth Engine API**.
3. Create a service account (IAM → Service accounts), give it the *Earth Engine Resource Viewer* role (or *Service Usage Consumer* plus Earth Engine access), and create a JSON key.
4. In Render → `riskn-resq-api` → Environment:
   - Set `GEE_PROJECT` to the project ID.
   - Paste the key file's contents into `GEE_SERVICE_ACCOUNT_JSON`. Base64 is also accepted.
5. Redeploy. `GET /flood-analysis/engine` (as admin) should report `"selected": "earth-engine"`.
6. Run an analysis from the admin API, then check its status and results.

The Earth Engine code path has **not been run against a live account** in this project. Verify it after setup.

## Testing
- `backend/tests/test_flood_routing.py`, 36 tests, with mocked imagery and routing:
  - detection rules and slope masking
  - speckle filter and vectorised area accuracy
  - permanent-water removal and minimum patch size
  - quality grade
  - same-track baselines and explicit statuses for missing or stale imagery
  - Earth Engine configuration and failure handling
  - API permissions, one-at-a-time runs and reuse
  - routes through and around satellite polygons, ranking and all routes affected
  - missing hazard data and stale satellite data
  - verified reports, invalid input, provider failures and HTTP 429, rate limits, sign-in
  - reassessment and OSRM directions
- `mobile/__tests__/safe-route.test.ts`: GeoJSON rings and map layers for a plan.
- `mobile/e2e/safe-route.spec.ts`, real web app with the isolated backend and real OSRM:
  - destination picked on the map, ranking
  - a verified report added on the route triggers reassessment
  - the hazard overlay is drawn, and the hazard route is shown as not recommended

Live checks run during development, outside the test suite:
- The Planetary Computer engine analysed the real 27 Sep 2026 pass over Bengaluru against three baseline passes (22 Aug, 3 Sep, 15 Sep). It found about 0.2 km² of potential new water in 3 patches and removed about 3.3 km² of permanent water. Built-up share was 43%, so the grade was LOW.
- OSRM returned real routes, and the planner avoided a verified test report.

## Limitations
- Radar misses flooding between buildings and under dense vegetation. Shadows can look like water. Bengaluru is about 43% built-up.
- Sentinel-1 passes every 6–12 days, so a detection is days old: **not live**. A long flood can already be in the baseline.
- Thresholds are standard values and have not been calibrated against local ground truth.
- The routing service does not know about floods. Hazard coverage is only as good as the satellite pass, the reports and the closures, so "no known hazard" is not "safe".
- Free tiers apply:
  - Planetary Computer and the public OSRM server are shared and can be slow or rate-limited.
  - One analysis took between 45 s and about 7 minutes during testing.
  - The Render free instance sleeps when idle.
- Nothing here has been tested on a physical phone.
