# Claims and limits

What RiskN ResQ is, and is not, claiming. Written to be checked against the code and the tests.

## REAL (observed or executed, not invented)
* **Provider observations:** rainfall and forecast (Open-Meteo), Sentinel-1 radar water extent (Microsoft Planetary Computer), terrain (Copernicus DEM), modelled river discharge (GloFAS), 10-year rainfall extremes (ERA5), roads/hospitals/shelters (OpenStreetMap). Each stored value carries its source and time; a failing provider is shown as unavailable, never replaced.
* **Application data:** accounts, reports, photos, help requests, matches, road status, alerts, audit log, risk history, all in PostgreSQL.
* **Routing:** routes come from OSRM (or Google Routes); blocked-road exclusion and risk cost are computed on those real routes.
* **Authentication and authorisation:** scrypt-hashed passwords, hashed tokens, server-side role checks (every route is checked by an automated test).

## PROTOTYPE (works, but not validated)
* **Flood-risk weights and thresholds** are documented heuristics. They have not been calibrated or validated against real flood outcomes.
* **"Flood probability"** is a logistic mapping of the score, labelled uncalibrated. It is not a measured probability.
* **Satellite water-change detection** uses a backscatter threshold (-16 dB) and a comparison with three earlier passes. Smooth surfaces, radar shadow and wind can be mistaken for water; an "abnormal" cell means *possible* flooding or ponding.
* **Terrain susceptibility** is a formula (height, flatness, depression), not a hydraulic model.
* **Machine learning:** the architecture (features, training, held-out validation, prediction) exists, but the model is **not trained** and no accuracy is claimed. It will train only on this system's own real history (verified flood reports) once there are at least 300 labelled snapshots with 30 of each class.
* **Road risk** is an area-level estimate (~9 km cell), not a road observation; "potentially affected" never means blocked.

## SIMULATED (explicitly labelled)
* **Rainfall drill** (Admin > Control): stored on the zone, labelled SIMULATED DRILL in the app and in alert text, never overwrites a real observation, never sends push/SMS, removed by Reset.
* **Admin road blocking** used in the guided demo is a real admin action on the demo state; Reset restores the roads.
* **Test fixtures** (in tests only): fake providers, a sample place named "(fixture)" in the isolated end-to-end database. The mock data in `src/features/disaster-response/data` belongs to the geospatial module's own unit tests and an unrouted demo screen; production screens never render it.
* **Demo sample data** (`DEMO_DATA=true`, off by default): a sample volunteer roster and one incident for presentations.

## NOT CONNECTED
* River **gauges** (none are available without registration); the river signal is modelled discharge.
* Any official **flood ground-truth** dataset; history is admin-entered records plus verified reports.
* A **replay** of past real events (not built).

## UI and reliability notes (verified by automated tests)
* Every API-driven screen has a loading, empty and error state; duplicate submissions are prevented (one idempotency key per form).
* Dangerous admin actions (reset, block road, broadcast, disable account, reject report) ask for confirmation.
* White text on each risk-coloured card meets WCAG AA contrast (unit-tested). Animations honour the system "reduce motion" setting.
* PostgreSQL has foreign keys (added only when existing data satisfies them; orphaned rows are reported, never deleted).

## NOT VERIFIED ON HARDWARE
Everything below passes automated tests but has **not** been tried on a physical phone (follow [DEVICE_TEST_CHECKLIST.md](DEVICE_TEST_CHECKLIST.md); the app's Account > Device & connection check measures each capability on the phone): native map layers (`react-native-maps`), camera capture, GPS accuracy, push notifications, the Docker image build, a live Render deployment, Cloudinary uploads, SMS/WhatsApp (Twilio) and real email (SMTP) delivery. The browser build is tested end to end (Playwright).

## Other limits
* Risk cells are ~9 km; satellite passes occur every 6-12 days; a satellite observation describes the day of the pass.
* Open-Meteo's free tier has daily request limits (a limit hit is reported as "unavailable: HTTP 429"; cached data is kept and marked stale).
* PostgreSQL has foreign keys; the SQLite fallback has none (SQLite cannot add constraints to existing tables), so there the application keeps references consistent and `scripts/integrity_check.py` verifies it.
* Hindi and Kannada cover the user screens, not the admin and volunteer portals.
* The app is not a substitute for official warnings. It never claims a route is safe or that a flood is certain.
