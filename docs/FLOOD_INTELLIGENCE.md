# Flood intelligence: how it works, what it uses, what it does not claim

RiskN ResQ estimates flood risk from environmental data first. Community reports are secondary evidence.
**This is a prototype, rule-based model. Its weights are documented heuristics, not scientifically validated or calibrated.**

```
Open-Meteo weather ─┐
Sentinel-1 satellite ┤
Copernicus DEM terrain ┤ → ingestion jobs → PostgreSQL cache → Flood intelligence engine → risk per grid cell
GloFAS river discharge ┤                                        ├→ hotspots   ├→ road risk → risk-aware routing
ERA5 rainfall history ┤                                         ├→ alerts     └→ map, Home, Admin
Verified reports (capped, secondary) ┘
```
Phones never call these services. The backend fetches on a schedule, stores results with source and timestamp, and the app reads
the processed result (`GET /intelligence/overview`).

## Data sources (all free, no key)
| Signal | Source | Cadence | What it is / is not |
|---|---|---|---|
| Rainfall 1/3/6/24 h, 6 h forecast | Open-Meteo | 15 min | Model-based precipitation on a grid, not a rain gauge |
| Satellite water extent | Sentinel-1 RTC radar via Microsoft Planetary Computer (STAC + statistics API) | checked every 6 h; a new pass every ~6-12 days | Open water where VV backscatter is below a threshold. Radar sees through monsoon cloud. Smooth surfaces and radar shadow can look like water |
| Terrain | Copernicus DEM 90 m via Open-Meteo | once | Elevation, slope, local depression. Susceptibility, **not** evidence of flooding |
| River level | GloFAS river-discharge model via Open-Meteo Flood API | 6 h | **Modelled discharge (m3/s), not a gauge.** No public keyless gauge API covers this area; a gauge provider slot exists and is empty |
| Rainfall history | ERA5 reanalysis, 10 years of daily rainfall via Open-Meteo archive | once | How unusual today's rain is here. **Not a record of past floods** |
| Flood history | Admin-entered records with a mandatory source, plus verified RiskN ResQ reports | as added | No external flood ground-truth dataset is connected |
| Roads, hospitals, shelters | OpenStreetMap (Overpass), admin import | on demand | Sparse for shelters; "designated" means listed, not safe |

## Satellite water change (not "flood detection")
For each ~9 km grid cell the newest Sentinel-1 pass is compared with the median of up to three earlier passes **on the same orbit
track and direction**. `expansion = max(0, current water - baseline water)`. A cell is *abnormal* only when the gain is at least
0.5 km2 **and** 40% over the baseline **and** above every baseline pass, so permanent lakes, rivers and reservoirs (which are in
the baseline) are never flagged. Confidence: LOW with one baseline pass, MEDIUM with two, HIGH with three and a large gain. Optical
Sentinel-2 NDWI (green-NIR water index) is implemented as a fallback for low-cloud scenes. Observed output:
`{area, timestamp, water_area, baseline_water_area, expansion_area, expansion_percentage, confidence, source}`.
A satellite pass older than 14 days is shown as stale and not used.

## Risk score (0-100)
`score = rainfall + forecast + satellite + terrain + river + history + reports`, capped at 100.

| Part | Range | Rule |
|---|---|---|
| Rainfall | 0-100 | existing `rain_score()` of the worst of: 24 h total, 1.5 x 6 h total, 4 x 1 h total |
| Forecast | 0-10 | 3 / 6 / 10 for 8 / 15 / 30 mm expected in 3 h (or 15 / 30 / 50 mm in 6 h) |
| Satellite | 0-20 | abnormal gain, scaled by confidence (1.0 / 0.8 / 0.5), only while the pass is fresh |
| Terrain | 0-12 | 12 x susceptibility, only while it is raining |
| River | 0-15 | modelled discharge 3x normal (15) or 1.5x normal (8) |
| History | 0-10 | 3 per recorded flood within 3 km, +3 / +6 when today's rain exceeds the 10-year p95 / p99; only while raining |
| Reports | 0-15 | trusted community reports (duplicates counted once). On their own they can never lift the score above 49 |

Levels: LOW < 25 <= MEDIUM < 50 <= HIGH < 75 <= CRITICAL. "Probability" is a logistic mapping of the score centred on 55 and is
labelled *prototype, uncalibrated*. Terrain susceptibility = 50% low relative elevation + 30% flatness + 20% local depression.
Signals with no data are listed as unavailable and contribute nothing. If weather data is too old the cell reports
"Insufficient data to estimate current flood risk." instead of a number.

## Hotspots, road risk, routing, alerts
* **Potential flood hotspot:** a HIGH-or-worse cell backed by at least two independent signal families (rainfall, satellite, terrain, history, river). Never "confirmed flooding".
* **Road states:** `OPEN`, `POTENTIALLY_AFFECTED` (the road crosses a HIGH-risk cell, or a MEDIUM one if the road is low-lying), `REPORTED_BLOCKED`, `VERIFIED_BLOCKED` (admin closure or verified incident). High risk alone never blocks a road. The risk is an area estimate, not a road observation.
* **Routing:** candidate routes come from the real street network. Routes through blocked roads or blocking incidents are excluded; the rest are ranked by `time x (1 + 0.6 x mean risk/100) x (1 + 0.1 per potentially-affected road)`. The existing Dijkstra module uses the same cost when roads carry a `riskScore`. Wording is always "recommended ... based on current environmental and incident data".
* **Automatic alerts:** raised when risk is HIGH/CRITICAL, or as a MEDIUM heads-up for abnormal satellite water gain (recent pass, or rain that makes it relevant). Each alert carries severity, area, reason, time, sources, recommended action and probability. Simulated drills are labelled and never notify anyone.

## Machine learning: not trained
`ml_model.py` trains a Random Forest only on this system's own history: risk snapshots labelled by whether an administrator verified
a flood report in the same zone within 6 hours. It needs at least 300 labelled rows with 30 of each class, validates on later
held-out rows, and reports only measured metrics. Until then it is **"not trained"** and no accuracy is claimed
(`GET /admin/ml/status`). Install `requirements-ml.txt` to enable training. Nothing is synthesised.

## API (public read unless noted)
`GET /flood-risk[?latitude&longitude]`, `/flood-risk/{zone}`, `/flood-risk/cells`, `/intelligence/overview`, `/satellite/observations`,
`/satellite/water-expansion`, `/terrain`, `/water-levels`, `/flood-hotspots`, `/risk-history?zone&hours`, `/road-risk`, `/weather/monitoring`,
`/alerts`, `/places`, `GET /evacuation/nearest` (login). Admin: `/admin/providers`, `POST /admin/intelligence/refresh`,
`/admin/historical-events`, `/admin/ml/status`, `POST /admin/ml/train`, `/admin/positioning`, `/admin/resources`.
Every response includes `source`, timestamps and freshness; empty datasets answer `"... unavailable"`.

## Known limitations
* Grid cells are about 9 km (`GRID_SPACING`); risk is hyper-local only to that resolution. A finer grid costs proportionally more satellite requests.
* Sentinel-1 passes the area every 6-12 days; the satellite signal is an observation from the day of the pass.
* No river gauges, no official flood-ground-truth data, and no trained ML model until real labelled history accumulates.
* Weights and thresholds are untuned heuristics. Treat output as a risk estimate, never a prediction of certainty.
