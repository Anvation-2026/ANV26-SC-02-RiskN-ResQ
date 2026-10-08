# RiskNResQ Production & Real-Data Setup Guide

This guide details configuration, credential management, and deployment instructions for running RiskNResQ with real-world geospatial, meteorological, routing, and community telemetry.

---

## 1. Google Cloud Platform & Routes API Setup

1. **Create or Select a GCP Project**:
   - Navigate to [Google Cloud Console](https://console.cloud.google.com/).
   - Create a project (e.g. `risknresq-production`) and link a billing account.

2. **Enable Routes API**:
   - Go to **APIs & Services** > **Library**.
   - Search for **Routes API** (Google Maps Platform).
   - Click **Enable**.

3. **Generate & Restrict API Key**:
   - Go to **APIs & Services** > **Credentials**.
   - Click **Create Credentials** > **API Key**.
   - Under **API restrictions**, choose **Restrict key** and select only **Routes API**.
   - Under **Application restrictions**, select **IP addresses** and restrict to your backend server's public IP addresses.
   - **SECURITY RULE**: Never place this key in mobile source code. It must only reside in the backend environment.

4. **Configure Environment Variable**:
   Add to `backend/.env`:
   ```env
   GOOGLE_ROUTES_API_KEY=AIzaSy...YourKey...
   ```
   *Note: If `GOOGLE_ROUTES_API_KEY` is omitted, the backend automatically uses OpenStreetMap (OSRM) as a high-fidelity open routing fallback.*

---

## 2. Meteorological Data Sources

### A. India Meteorological Department (IMD)
1. Official telemetry access through IMD Data Supply portal or IMD Open API Gateway.
2. Configure credentials in `backend/.env`:
   ```env
   IMD_API_KEY=your_imd_api_token
   ```

### B. Open-Meteo (Automatic Production Fallback)
- If official IMD credentials are not provided during development, the backend automatically queries the Open-Meteo High-Resolution Precipitation and Surface Telemetry API.
- Live observations include 24-hour cumulative precipitation, hourly rainfall intensity, relative humidity, and temperature.
- Every response carries `weather_source: "Open-Meteo"` or `weather_source: "IMD"` for transparent attribution.

### C. KSNDMC (Karnataka State Natural Disaster Monitoring Centre)
- Configure official Karnataka state sensor feed credentials in `backend/.env`:
   ```env
   KSNDMC_API_KEY=your_ksndmc_token
   ```

---

## 3. Persistent Database Configuration

By default, the backend operates on SQLite (`resilienturban.db`). For multi-instance production deployments:
1. Provision a PostgreSQL 15+ database instance (e.g., AWS RDS, Supabase, Neon).
2. Set `DATABASE_URL` in `backend/.env`:
   ```env
   DATABASE_URL=postgresql://user:password@hostname:5432/risknresq
   ```

---

## 4. Mobile Application Environment Configuration

1. **Server Base URL**:
   In `mobile/src/config/api.js`:
   - During local device development via Expo Go, the app auto-detects your local machine's IP address.
   - For remote/cloud deployment:
     ```javascript
     const API_URL_OVERRIDE = 'https://api.yourdomain.com';
     ```

2. **iOS Location Permission**:
   Configured in `mobile/app.json`:
   ```json
   "infoPlist": {
     "NSLocationWhenInUseUsageDescription": "RiskNResQ uses your location to show your position, assess nearby disaster risk, calculate routes and connect you with nearby community assistance."
   }
   ```

3. **Android Location Permission**:
   Configured in `mobile/app.json`:
   ```json
   "permissions": [
     "ACCESS_COARSE_LOCATION",
     "ACCESS_FINE_LOCATION"
   ]
   ```

---

## 5. Running the Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run test suite
pytest tests/

# Start production server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
