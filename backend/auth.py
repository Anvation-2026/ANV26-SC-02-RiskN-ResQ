"""Authentication: scrypt password hashing, opaque bearer tokens stored hashed in SQLite, role checks.
The role always comes from the database row of the authenticated user, never from the client."""
import hashlib
import hmac
import logging
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException

import db

log = logging.getLogger("risknresq.auth")

ROLE_USER, ROLE_VOLUNTEER, ROLE_ADMIN = "user", "volunteer", "admin"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
TOKEN_TTL_HOURS = float(os.environ.get("TOKEN_TTL_HOURS", "24"))
MAX_FAILED_LOGINS, LOCKOUT_SECONDS = 5, 300

# ---------- passwords ----------

_N, _R, _P = 2 ** 14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, maxmem=64 * 1024 * 1024)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: Optional[str]) -> bool:
    try:
        scheme, salt_hex, digest_hex = (stored or "").split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=_N, r=_R, p=_P, maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(digest, bytes.fromhex(digest_hex))
    except (ValueError, TypeError):
        return False


_DUMMY_HASH = hash_password("timing-equaliser")  # unknown emails still cost one hash, so timing doesn't reveal them

# ---------- login throttling (stored in SQLite, so a backend restart does not clear it) ----------

def reset_login_throttle() -> None:
    try:
        with db.session() as c:
            c.execute("DELETE FROM login_failures")
    except Exception:  # table not created yet
        pass


def throttled(email: str) -> bool:
    with db.session() as c:
        c.execute("DELETE FROM login_failures WHERE at < ?", (time.time() - LOCKOUT_SECONDS,))
        n = c.execute("SELECT COUNT(*) FROM login_failures WHERE email=?", (email,)).fetchone()[0]
    return n >= MAX_FAILED_LOGINS


def record_failure(email: str) -> None:
    with db.session() as c:
        c.execute("INSERT INTO login_failures(email, at) VALUES(?,?)", (email, time.time()))


def clear_failures(email: str) -> None:
    with db.session() as c:
        c.execute("DELETE FROM login_failures WHERE email=?", (email,))


# ---------- sessions ----------

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(c, user_id: int) -> tuple:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=TOKEN_TTL_HOURS)
    c.execute("DELETE FROM sessions WHERE expires_at < ?", (now.isoformat(timespec="seconds"),))
    c.execute("INSERT INTO sessions(user_id, token_hash, created_at, expires_at) VALUES(?,?,?,?)",
              (user_id, _hash_token(token), now.isoformat(timespec="seconds"), expires.isoformat(timespec="seconds")))
    return token, expires.isoformat(timespec="seconds")


def revoke_token(c, token: str) -> None:
    c.execute("DELETE FROM sessions WHERE token_hash=?", (_hash_token(token),))


def revoke_user_sessions(c, user_id: int) -> None:
    c.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))


def _bearer(authorization: Optional[str]) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    return token.strip()


def user_public(row) -> dict:
    k = row.keys() if hasattr(row, "keys") else row
    get = lambda name, default=None: row[name] if name in k else default  # noqa: E731
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"], "phone": row["phone"],
            "email_verified": bool(get("email_verified", 0)), "notify_sms": bool(get("notify_sms", 0)),
            "language": get("language")}


def current_token(authorization: Optional[str] = Header(None)) -> str:
    return _bearer(authorization)


def current_user(token: str = Depends(current_token)) -> dict:
    with db.session() as c:
        row = c.execute(
            "SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=?",
            (_hash_token(token),)).fetchone()
        invalid = HTTPException(401, "Session expired or invalid. Please log in again.", headers={"WWW-Authenticate": "Bearer"})
        if not row:
            raise invalid
        if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
            revoke_token(c, token)
            c.commit()
            raise invalid
        if not row["is_active"]:
            raise invalid
        return dict(row)


def optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    if not authorization:
        return None
    try:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            return None
        with db.session() as c:
            row = c.execute(
                "SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=?",
                (_hash_token(token.strip()),)).fetchone()
            if not row:
                return None
            if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
                return None
            if not row["is_active"]:
                return None
            return dict(row)
    except Exception:
        return None


def require_roles(*roles: str):
    def dependency(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "You do not have permission to do that.")
        return user
    return dependency


require_admin = require_roles(ROLE_ADMIN)
require_volunteer = require_roles(ROLE_VOLUNTEER)

# ---------- initial Super Admin (from environment only; nothing is hard-coded) ----------


def ensure_admin() -> None:
    email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD") or ""
    if not email or not password:
        log.warning("ADMIN_EMAIL / ADMIN_PASSWORD not set: no Super Admin account will be created.")
        return
    if not EMAIL_RE.match(email) or len(password) < 8:
        log.error("ADMIN_EMAIL must be a valid email and ADMIN_PASSWORD at least 8 characters. Admin not created.")
        return
    with db.session() as c:
        row = c.execute("SELECT id, role FROM users WHERE email=?", (email,)).fetchone()
        if row:
            if row["role"] != ROLE_ADMIN:
                log.error("ADMIN_EMAIL belongs to an existing non-admin account; refusing to promote it.")
            return  # an existing admin keeps its password
        c.execute("INSERT INTO users(name, role, email, password_hash, created_at, is_active, email_verified) VALUES(?,?,?,?,?,1,1)",
                  (os.environ.get("ADMIN_NAME", "Super Admin"), ROLE_ADMIN, email, hash_password(password), db.now()))
        log.info("Super Admin account created for %s", email)
