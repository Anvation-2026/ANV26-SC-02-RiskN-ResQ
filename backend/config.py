import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from backend root
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

GOOGLE_ROUTES_API_KEY = os.getenv("GOOGLE_ROUTES_API_KEY", "").strip() or None
IMD_API_KEY = os.getenv("IMD_API_KEY", "").strip() or None
KSNDMC_API_KEY = os.getenv("KSNDMC_API_KEY", "").strip() or None
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./resilienturban.db").strip()

raw_cors = os.getenv("CORS_ORIGINS", "*").strip()
if raw_cors == "*" or not raw_cors:
    CORS_ORIGINS = ["*"]
else:
    CORS_ORIGINS = [origin.strip() for origin in raw_cors.split(",") if origin.strip()]


# ---- Weather monitoring grid (backend polls the weather provider; clients only read the cached result) ----
def _floats(name: str, default: str, n: int) -> tuple:
    try:
        vals = tuple(float(v) for v in os.getenv(name, default).split(","))
        if len(vals) == n:
            return vals
    except ValueError:
        pass
    return tuple(float(v) for v in default.split(","))


# south,west,north,east. Default covers Bengaluru; change it to monitor another city.
MONITORING_BOUNDS = _floats("MONITORING_BOUNDS", "12.83,77.45,13.15,77.79", 4)
GRID_SPACING = float(os.getenv("GRID_SPACING", "0.08"))  # degrees (about 9 km): 5 x 5 = 25 points for the default bounds
WEATHER_REFRESH_INTERVAL = max(60, int(os.getenv("WEATHER_REFRESH_INTERVAL", "900")))  # seconds; Open-Meteo updates ~15 min
# Rain-rate classes in mm per hour (tunable): below MODERATE = LOW.
RAIN_MODERATE_THRESHOLD = float(os.getenv("RAIN_MODERATE_THRESHOLD", "2.5"))
HEAVY_RAIN_THRESHOLD = float(os.getenv("HEAVY_RAIN_THRESHOLD", "7.5"))
RAIN_VERY_HEAVY_THRESHOLD = float(os.getenv("RAIN_VERY_HEAVY_THRESHOLD", "15"))
WEATHER_MONITOR_ENABLED = os.getenv("WEATHER_MONITOR_ENABLED", "1").strip() not in ("0", "false", "no")
