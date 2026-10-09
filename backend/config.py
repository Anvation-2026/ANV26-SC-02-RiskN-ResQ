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

# CORS only matters for browser origins (the phone app does not use it). Open ("*") for local development; when deployed behind
# a proxy (TRUST_PROXY=1) it must be set explicitly, otherwise no browser origin is allowed.
_proxied = os.getenv("TRUST_PROXY", "0").strip() in ("1", "true", "yes")
raw_cors = os.getenv("CORS_ORIGINS", "" if _proxied else "*").strip()
if raw_cors == "*":
    CORS_ORIGINS = ["*"]
elif not raw_cors:
    CORS_ORIGINS = ["*"] if not _proxied else []
else:
    # a bare host (as Render's fromService provides) becomes https://host; a full origin is kept as written
    CORS_ORIGINS = [o if o.startswith(("http://", "https://")) else f"https://{o}" for o in (x.strip().rstrip("/") for x in raw_cors.split(",")) if o]


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


# ---- Notifications (all optional; nothing is sent unless configured) ----
APP_URL = os.getenv("APP_URL", "").strip()
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "").strip() or SMTP_USER
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
TWILIO_FROM = os.getenv("TWILIO_FROM", "").strip()  # an SMS-capable number, or "whatsapp:+14155238886" for WhatsApp
PUSH_ENABLED = os.getenv("PUSH_ENABLED", "1").strip() not in ("0", "false", "no")
SMS_MAX_RECIPIENTS = int(os.getenv("SMS_MAX_RECIPIENTS", "200"))  # safety cap per alert so a bug can never send thousands

# ---- Hardening ----
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "1").strip() not in ("0", "false", "no")
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "240"))  # per client IP, all endpoints
AUTH_RATE_LIMIT_PER_MINUTE = int(os.getenv("AUTH_RATE_LIMIT_PER_MINUTE", "20"))  # per client IP, /auth/* only
SENTRY_DSN = os.getenv("SENTRY_DSN", "").strip()
OVERPASS_URL = os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter").strip()


# ---- Flood intelligence (satellite, terrain, river level, history) ----
INTEL_ENABLED = os.getenv("INTEL_ENABLED", "1").strip() not in ("0", "false", "no")
SATELLITE_REFRESH_INTERVAL = max(900, int(os.getenv("SATELLITE_REFRESH_INTERVAL", "21600")))  # 6 h; Sentinel-1 revisits ~every 6-12 days
WATER_LEVEL_REFRESH_INTERVAL = max(900, int(os.getenv("WATER_LEVEL_REFRESH_INTERVAL", "21600")))
SAR_WATER_THRESHOLD_DB = float(os.getenv("SAR_WATER_THRESHOLD_DB", "-16"))  # Sentinel-1 VV backscatter below this is treated as open water
SAT_ABNORMAL_MIN_KM2 = float(os.getenv("SAT_ABNORMAL_MIN_KM2", "0.5"))  # smallest net water gain (per grid cell) called abnormal
SAT_ABNORMAL_MIN_PCT = float(os.getenv("SAT_ABNORMAL_MIN_PCT", "40"))  # and at least this much relative to the baseline scenes
SATELLITE_STALE_DAYS = float(os.getenv("SATELLITE_STALE_DAYS", "14"))
PLANETARY_COMPUTER_URL = os.getenv("PLANETARY_COMPUTER_URL", "https://planetarycomputer.microsoft.com/api").strip()

# ---- AI Assistant (Gemini / OpenAI / Grounded Engine) ----
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip() or None
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip() or None
AI_MODEL = os.getenv("AI_MODEL", "").strip() or None
AI_PROVIDER = os.getenv("AI_PROVIDER", "auto").strip().lower()
