# RiskN ResQ

**Hyper-local flood early warning and community action network.**
RiskN ResQ tells people in a neighbourhood how likely a flood is right now, warns them when risk rises, shows which roads are blocked, suggests an alternative route, and connects people who need help with nearby volunteers.

Built for a 2-hour hackathon. The MVP hazard is **flood**.

## What it does

| # | Feature | Where |
|---|---|---|
| 1 | Live **flood risk** per zone (0–100, LOW / MEDIUM / HIGH / CRITICAL) | Home |
| 2 | Automatic **emergency alerts** when risk reaches HIGH or CRITICAL | Alerts |
| 3 | **Blocked roads** and a **recommended alternative route** on a live map | Map |
| 4 | **Report** a flood, blocked road or emergency (with a trust score) | Report |
| 5 | **Request help** (medicine, food, water, first aid, evacuation) and get a **volunteer match** | Help |
| 6 | **Hazard simulation** for demos: rainfall in, risk and alerts out | Demo panel / API |

The app never claims a route is "safe". It says *"Recommended alternative route based on available incident data."*

## Architecture

```
┌──────────────────────┐   REST / JSON    ┌───────────────────────────┐
│  mobile/ (Expo, RN)  │ ───────────────▶ │  backend/ (FastAPI)       │
│  Home Map Report     │ ◀─────────────── │  Risk · Trust · Alerts    │
│  Help Alerts         │   polls every 4s │  Roads · Simulation       │
│  + mock-data fallback│                  │  PostgreSQL (auto-seeded) │
└──────────────────────┘                  └───────────────────────────┘
```

- **Backend:** Python, FastAPI, **PostgreSQL** (SQLite still works for quick local runs), Pydantic. Deterministic rules, no ML. Login with roles.
- **Frontend:** React Native with Expo (JavaScript). If the backend is unreachable the app falls back to built-in demo data and shows *"Unable to connect to live data."*
- **Map:** drawn from real road coordinates without a map SDK, so nothing extra to set up.

## Accounts and roles

Three roles, decided **only by the backend** (the app never sends a role):

| Role | How it is created | Can do |
|---|---|---|
| **user** | Anyone, via *Create Account* | View risk, alerts, map and blocked roads; request routes; report incidents; request help and see the match; manage their own session |
| **volunteer** | **Only a Super Admin** (People → Add Volunteer) | Volunteer dashboard: set availability, see assigned requests and nearby open requests, accept and complete assigned requests |
| **admin** (Super Admin) | From `ADMIN_EMAIL` / `ADMIN_PASSWORD` in the backend environment. There is no sign-up path | Admin dashboard: users, volunteers (add, edit, disable), incidents (verify, reject, resolve), roads (block, unblock), hazard simulation, alerts, help requests, matches, demo reset |

How it works: passwords are hashed with scrypt (never stored in plain text); login returns an opaque bearer token that is stored hashed and expires after 24 hours; logout revokes it; a disabled account is signed out immediately. Registration rejects any `role` field, so a normal user cannot become a volunteer or admin. Login is rate-limited after repeated failures (stored in the database, so a restart does not reset it). Public (no login): `/health`, `/risk`, `/alerts`, `/roads` and `/auth/register`, `/auth/login`. Everything else needs a valid token, and admin-only endpoints return `403` for other roles.

### Create the Super Admin

```bash
cd backend
cp .env.example .env     # .env is git-ignored; set your own ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters)
```

Never commit real credentials, and never put them in the mobile app.

## Quick start

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The admin account is created on startup from `backend/.env` (see *Accounts and roles*).

API docs: <http://localhost:8000/docs>. The database (`resilienturban.db`) is created and seeded on first start. Call `POST /reset` to restore the seed data.

### 2. Mobile app

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go** (phone and computer on the same Wi-Fi), press `i` for the iOS simulator, or press `w` for the browser.

The app finds the backend automatically at `http://<your-computer-IP>:8000`. To point it elsewhere, set `API_URL_OVERRIDE` in [`mobile/src/config/api.js`](mobile/src/config/api.js).

## Demo script

1. Open the app. Risk is **LOW**.
2. On Home, press **Flood Risk** in the *DEMO MODE* panel (or call `POST /simulate-hazard`).
3. Risk becomes **HIGH**, an alert appears, and Road A is marked **BLOCKED**.
4. Open **Map**: the blocked road and the recommended alternative route are shown.
5. Open **Help**, choose *Medicine*, press **Request Help**: a volunteer match appears.
6. Press **Normal** to reset.

The demo panel is a development control. Set `DEMO_CONTROLS = false` in `mobile/src/config/api.js` to hide it.

## Route & Resources (geospatial module)

Added by Vishvanth, in `mobile/src/features/disaster-response/` (docs in `mobile/docs/`). On the **Map** tab, switch to **Route & Resources** to:

1. See the user location, flood-risk zones and the geofence result (inside or outside, risk level).
2. **Block** or **Unblock** a road (5th Cross) and **Reset Demo**.
3. **Request a route**: Dijkstra routing excludes blocked roads and returns the distance, ETA and the reason for the detour.
4. **Request a resource** (Medicine, Food, Water, First Aid, Evacuation): the explainable 100-point matcher returns the best available volunteer, or "No suitable nearby resource found."

Blocking the demo road also blocks Road A on the backend (best effort), and the Help screen uses the same matching engine through `src/integration/volunteerAdapter.ts`.

```bash
cd mobile
npx tsc --noEmit        # type check
npx jest --runInBand    # 16 tests
```

## Real data and demo data

Normal operation uses **real data only**, stored in PostgreSQL: accounts, volunteers, incident reports (and their photos), help requests, matches, road status and alerts. Nothing is created automatically: a fresh database contains just the Super Admin from `.env`, the road network (reference data) and zone baselines. The app has **no built-in sample or mock data and no silent fallback**: if the server cannot be reached it says "Unable to connect to the server." and keeps showing the last data it received.

Demo data is opt-in for presentations: start the backend with `DEMO_DATA=true` to also seed a sample volunteer roster (no login accounts) and one sample incident. Remove it again at any time with `python scripts/remove_demo_data.py` (real accounts and records are never touched). Admin-simulated rainfall is always labelled SIMULATED and its alerts start with "SIMULATED DRILL". The admin *Reset Demo* button clears incidents, help requests, matches and alerts and unblocks roads; accounts are kept.

Anything saved by one device is visible to the others: for example a user registered on a phone shows up in the admin's People list, and an incident reported on a phone shows up in the admin's Incidents list, because every device talks to the same backend and PostgreSQL database.

## Database (PostgreSQL)

The backend uses **PostgreSQL** when `DATABASE_URL` points at it, and a local SQLite file when it does not (quick demos, tests). The tables are created and the demo data seeded automatically on first start.

```bash
# 1. create the database (PostgreSQL must be running)
createdb risknresq

# 2. tell the backend about it, in backend/.env (git-ignored):
#    DATABASE_URL=postgresql://<user>:<password>@localhost:5432/risknresq
#    (on a Mac with Homebrew PostgreSQL the user is your login name and no password is needed)

# 3. install the driver and start the backend
cd backend && pip install -r requirements.txt
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Already have data in the old SQLite file? Copy it once into PostgreSQL (this empties the target tables first):

```bash
cd backend && DATABASE_URL=postgresql://<user>@localhost:5432/risknresq python scripts/migrate_sqlite_to_postgres.py
```

Tests run on a throw-away SQLite file by default. To run the same suite on PostgreSQL (each test gets its own temporary schema), create a test database first:

```bash
createdb risknresq_test
RISKNRESQ_TEST_BACKEND=postgres DATABASE_URL=postgresql://<user>@localhost:5432/risknresq_test python -m pytest -q
```

## Running on a real phone (Expo Go)

1. Phone and computer on the **same Wi-Fi**. Start the backend so it listens on the network: `uvicorn main:app --host 0.0.0.0 --port 8000`.
2. In `mobile/`: `npm install`, then `npx expo start`, and scan the QR code with **Expo Go**.
3. The app finds the backend automatically at `http://<your-computer-IP>:8000` (it reuses the address Expo was started on). To point somewhere else, set an environment variable instead of editing code: `EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 npx expo start` (use an `https://` URL for a deployed backend).
4. Do not use `localhost` on a phone: it means the phone itself.

Permissions are declared in `app.json`: location (when in use), camera and photo library (for incident photos). The app currently uses a fixed demo location (Bengaluru) so the demo is repeatable; set `USE_DEVICE_LOCATION = true` in `mobile/src/config/api.js` to use the phone's GPS.

**Status:** the iOS and Android bundles compile (`npx expo export`), and the whole app has been exercised in a browser at phone size. Testing on a physical phone is still to be done by the team.

### Native map

On phones the map uses `react-native-maps` (`MapView.js`): flood-risk zones, blocked roads, the recommended route (computed with blocked roads removed), incidents and volunteers. It works in **Expo Go** without a key. A standalone Android/iOS build needs a Google Maps key, supplied through the environment (never committed): `GOOGLE_MAPS_API_KEY=... npx expo start` (read by `mobile/app.config.js`). In the browser the app uses a simple built-in map (`MapView.web.js`) because `react-native-maps` does not run on web.

### Incident photos

On the Report screen, *Choose photo* (and *Take photo* on phones) shows a preview. When the report is submitted the app first saves the incident, then uploads the image to `POST /incidents/{id}/photo`. The app only says "Photo uploaded" after the server confirms it stored the file; if the upload fails it says so, and the report itself is still saved. The backend checks the file's real type (JPEG, PNG or WebP) and size (5 MB), keeps one photo per incident, stores it under `backend/uploads/` (git-ignored, cleared by Reset) and shows it only to the reporter and admins. Local disk storage is for the demo; use object storage for production.

### Password recovery

**Not included in this hackathon scope.** A safe reset flow needs email delivery, which is not set up, so there is no "Forgot password" button. An admin can set a new password for a volunteer from People → Edit.

### HTTPS and deployment

Nothing is deployed, and **HTTPS is not configured**. Local development uses plain HTTP on your Wi-Fi, so only test accounts should be used there. For a real deployment, put the backend behind a host or reverse proxy that provides HTTPS and set `EXPO_PUBLIC_API_URL` to the `https://` address. Admin credentials live only in `backend/.env` on the server and never in the app.

### Data labels

The Home screen shows where the risk comes from (for example the weather provider) and a LIVE or OFFLINE badge for the server connection. Anything an admin sets with the **Simulate hazard** control is stored as `SIMULATED`: the Admin dashboard and risk API say so, and the alerts it creates start with "SIMULATED DRILL (not a real warning)". Simulated rainfall drives the zone alerts and admin views; the Home risk card for a phone's GPS position uses real weather data, so it is not changed by a simulation. This prototype is not an official warning service.

### Logo and symbols

The logo and 15 symbols are in `mobile/assets/symbols/` (SVG sources plus `png/` renders). The logo is the app icon, splash, browser-tab icon and login screen header. Symbols used in the app: pin (Live Map), alternative route (Route), alert wave (Report), lifebuoy (Help), alert bell (Alerts), barricade (Road status), risk gauge (Risk), rain cloud (Hazard simulation). Home, Account, Logout, Admin and Settings have no matching symbol, so they keep the standard icon set.

## How the logic works

- **Risk score:** rainfall below 20 mm is LOW, 20–60 MEDIUM, 60–100 HIGH, above 100 CRITICAL. Verified (or credible) flood and blocked-road reports in the zone add up to 25 points. Score thresholds: 25 / 50 / 75.
- **Trust score:** starts at 50, +15 if a similar report (same type, within 500 m and 3 h) exists, +25 when an admin verifies it, −5 per hour after 6 h, 0 if rejected.
- **Alerts:** created or upgraded when a zone is HIGH or CRITICAL, and deactivated when it drops back.
- **Routing:** blocked roads come from `GET /roads`. The recommended alternative is the shortest road that is still available.
- **Volunteer matching:** skill match counts most, distance breaks ties; the app picks the best available volunteer and saves it with `POST /matches`.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{"status":"ok","database":"ok"}` (503 if the database is unavailable) |
| POST | `/reset` | **Admin.** Atomic reset to the demo state: LOW risk, all roads AVAILABLE, no alerts. Accounts and the volunteer roster are kept |
| GET | `/risk` | `{overall, zones[]}`; `?zone=Zone A` for one zone |
| POST | `/simulate-hazard` | `{"hazard":"FLOOD","rainfall":120,"zone":"Zone A"?}` returns `before`, `after`, `active_alerts` |
| GET / POST | `/alerts` | `?active_only=true` |
| GET / POST | `/incidents` | types `FLOOD`, `BLOCKED_ROAD`, `EMERGENCY`; filters `?status=` `?type=` |
| GET | `/incidents/{id}` | |
| POST | `/incidents/{id}/verify`, `/reject`, `/resolve` | admin actions |
| GET | `/roads`, `/roads/{id}` | `?status=BLOCKED` |
| POST | `/roads/{id}/block`, `/unblock` | |
| POST | `/help-request` | returns `request_id` |
| GET | `/help-requests`, `/volunteers`, `/matches` | |
| POST | `/matches` | `{"help_request_id":1,"volunteer_id":2}` |

Zones are `Zone A`, `Zone B`, `Zone C`; incidents are assigned to the nearest one. CORS is open to all origins.

### Auth and role endpoints

| Method | Path | Who |
|---|---|---|
| POST | `/auth/register` | public (creates a `user`) |
| POST | `/auth/login`, `/auth/logout` · GET `/auth/me` | login public; others need a token |
| POST / PUT / DELETE | `/volunteers`, `/volunteers/{id}` | admin (DELETE disables the account and releases open assignments) |
| GET / PATCH | `/volunteers/me`, `/volunteers/me/requests` | volunteer |
| POST | `/matches/{id}/accept`, `/matches/{id}/complete` | the assigned volunteer (or admin) |
| GET | `/admin/summary`, `/admin/users` · PATCH `/admin/users/{id}` | admin |
| POST | `/simulate-hazard`, `/roads/{id}/block`, `/roads/{id}/unblock`, `/alerts`, `/incidents/{id}/verify\|reject\|resolve` | admin |
| POST | `/incidents`, `/help-request` | any signed-in user (the owner is taken from the token) |
| POST / GET | `/incidents/{id}/photo` | the reporter or an admin (raw image body, JPEG/PNG/WebP, max 5 MB) |

## Backend reliability

- **Validation:** bad requests return `422` with a readable message (`{"detail": "Invalid request: ..."}`); unknown ids, zones and users return `404`; a second match for the same request returns `409`. Nothing is saved when a request fails.
- **Database errors:** return a JSON `500` ("Nothing was saved; please retry") and the server keeps running. Each request is one transaction, rolled back on error.
- **Help types:** `MEDICINE`, `FOOD`, `WATER`, `FIRST_AID`, `EVACUATION` (also accepts "First Aid" or "Evacuation Assistance"); priorities `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
- **Alerts:** one engine alert per zone (created or upgraded at HIGH/CRITICAL, deactivated when risk drops). Each has `reason`, `risk_score`, `affected_road` (blocked roads in that zone), `created_at` and `updated_at`. Manual alerts from `POST /alerts` are never cleared by the engine.
- **Data transparency:** risk responses carry `data_source` (`DEMO_SEED` or `SIMULATED`) and a notice that this is demo data, not a real-time forecast or official warning.
- **Config:** the database is chosen by `DATABASE_URL` (see *Database* below). Older database files are upgraded automatically.

### Backend tests

```bash
cd backend
pip install -r requirements-dev.txt
python -m compileall -q .
python -m pytest -q        # 147 tests (API, authentication, photo upload), each on a temporary database
```

## Project structure

```
backend/
  main.py          FastAPI routes
  engine.py        risk, trust score, alert logic
  db.py            schema, migrations, seed data; PostgreSQL and SQLite
  scripts/         migrate_sqlite_to_postgres.py (one-time data copy)
  tests/           pytest API, auth and photo tests
  uploads/         incident photos (git-ignored)
mobile/
  App.js
  src/
    screens/       Home, Map, Report, Help, Alerts
    components/    RiskCard, AlertCard, MapView, MatchCard, DemoPanel, ...
    services/      api.js (live + fallback), accountApi.js (auth/admin/volunteer), session.js, mockData.js, geo.js
    screens/       user app screens, auth/ (login, register), volunteer/, admin/
    navigation/    RootNavigator (role gate), AppNavigator (user), AdminNavigator
    features/disaster-response/   geofencing, routing, matching (TypeScript module)
    integration/   adapter between backend data and the module
    context/       DataContext.js (polling)
    navigation/    AppNavigator.js (bottom tabs)
    config/        api.js (API URL, demo switches)
```

## Out of scope for the MVP

Login, user profiles, chat, payments, other disaster types, machine learning, an admin dashboard, and real photo upload (the photo button is visual only).
