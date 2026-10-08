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
