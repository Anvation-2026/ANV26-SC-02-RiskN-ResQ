"""Rate limiting, request logging and optional Sentry error reporting."""
import logging
import os
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

import config

logger = logging.getLogger("riskn.http")
TRUST_PROXY = os.getenv("TRUST_PROXY", "0").strip() in ("1", "true", "yes")  # set behind Render/Railway/nginx


def client_ip(request) -> str:
    if TRUST_PROXY:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding one-minute window per client IP: a general limit on everything and a tighter one on /auth/*."""

    def __init__(self, app):
        super().__init__(app)
        self.hits = defaultdict(deque)

    def _over(self, key: str, limit: int, now: float) -> bool:
        q = self.hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= limit:
            return True
        q.append(now)
        return False

    async def dispatch(self, request, call_next):
        if config.RATE_LIMIT_ENABLED and request.method != "OPTIONS":
            now, ip = time.monotonic(), client_ip(request)
            auth_path = request.url.path.startswith("/auth/")
            if (auth_path and self._over(f"auth:{ip}", config.AUTH_RATE_LIMIT_PER_MINUTE, now)) or \
               self._over(f"all:{ip}", config.RATE_LIMIT_PER_MINUTE, now):
                return JSONResponse({"detail": "Too many requests. Please slow down and try again in a minute."},
                                    status_code=429, headers={"Retry-After": "60"})
            if len(self.hits) > 5000:  # forget idle clients so memory stays bounded
                for k in [k for k, q in self.hits.items() if not q or now - q[-1] > 60]:
                    del self.hits[k]
        return await call_next(request)


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start = time.monotonic()
        response = await call_next(request)
        logger.info("%s %s -> %s (%d ms)", request.method, request.url.path, response.status_code,
                    (time.monotonic() - start) * 1000)  # path only: query strings can carry coordinates
        return response


def init_sentry() -> bool:
    if not config.SENTRY_DSN:
        return False
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=config.SENTRY_DSN, traces_sample_rate=0.0, send_default_pii=False)
        return True
    except Exception as exc:
        logging.getLogger(__name__).warning("Sentry not started: %s", exc)
        return False
