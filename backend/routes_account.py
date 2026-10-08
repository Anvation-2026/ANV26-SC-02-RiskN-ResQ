"""Account recovery and preferences: forgot / reset password, email verification, push tokens, notification settings."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

import auth
import db
import notify

router = APIRouter()
MAX_ATTEMPTS = 5


def _hash(user_id: int, code: str) -> str:
    return hashlib.sha256(f"{user_id}:{code}".encode()).hexdigest()


def _iso(dt) -> str:
    return dt.isoformat(timespec="seconds")


def issue_code(c, user_id: int, kind: str, minutes: int) -> str:
    """A fresh 6-digit code (stored hashed). Older unused codes of the same kind stop working."""
    c.execute("DELETE FROM auth_tokens WHERE user_id=? AND kind=?", (user_id, kind))
    code = f"{secrets.randbelow(10 ** 6):06d}"
    now = datetime.now(timezone.utc)
    c.execute("INSERT INTO auth_tokens(user_id, kind, code_hash, created_at, expires_at) VALUES(?,?,?,?,?)",
              (user_id, kind, _hash(user_id, code), _iso(now), _iso(now + timedelta(minutes=minutes))))
    return code


def _consume(c, user_id: int, kind: str, code: str) -> bool:
    """True once for a correct, unexpired code; wrong guesses are counted and the code dies after MAX_ATTEMPTS."""
    row = c.execute("SELECT * FROM auth_tokens WHERE user_id=? AND kind=? AND used_at IS NULL ORDER BY id DESC",
                    (user_id, kind)).fetchone()
    if not row or row["attempts"] >= MAX_ATTEMPTS or row["expires_at"] < _iso(datetime.now(timezone.utc)):
        return False
    if not secrets.compare_digest(row["code_hash"], _hash(user_id, code.strip())):
        c.execute("UPDATE auth_tokens SET attempts=attempts+1 WHERE id=?", (row["id"],))
        return False
    c.execute("UPDATE auth_tokens SET used_at=? WHERE id=?", (db.now(), row["id"]))
    return True


def send_verification(c, user) -> None:
    code = issue_code(c, user["id"], "VERIFY", 60 * 24)
    notify.email(user["email"], "Verify your RiskN ResQ email",
                 f"Hello {user['name']},\n\nYour RiskN ResQ verification code is {code}. It is valid for 24 hours.\n"
                 f"If you did not create this account you can ignore this message.")


class ForgotIn(BaseModel):
    email: str = Field(..., max_length=254)


class ResetIn(BaseModel):
    email: str = Field(..., max_length=254)
    code: str = Field(..., min_length=4, max_length=12)
    new_password: str = Field(..., min_length=8, max_length=128)


class CodeIn(BaseModel):
    code: str = Field(..., min_length=4, max_length=12)


@router.post("/auth/forgot-password")
def forgot_password(body: ForgotIn):
    """Always answers the same way, so it cannot be used to discover which emails have accounts."""
    email = body.email.strip().lower()
    with db.session() as c:
        row = c.execute("SELECT * FROM users WHERE LOWER(email)=? AND is_active=1", (email,)).fetchone()
        if row and row["role"] != auth.ROLE_ADMIN:  # the Super Admin password lives in the server's .env, not here
            code = issue_code(c, row["id"], "RESET", 15)
            notify.email(email, "Reset your RiskN ResQ password",
                         f"Your RiskN ResQ password reset code is {code}. It is valid for 15 minutes.\n"
                         f"If you did not ask for this, ignore this message: your password has not changed.")
    return {"status": "If that email has an account, a reset code has been sent."}


@router.post("/auth/reset-password")
def reset_password(body: ResetIn):
    email = body.email.strip().lower()
    if auth.throttled(email):
        raise HTTPException(429, "Too many failed attempts. Please wait a few minutes and try again.")
    ok = False
    with db.session() as c:
        row = c.execute("SELECT * FROM users WHERE LOWER(email)=? AND is_active=1", (email,)).fetchone()
        if row and row["role"] != auth.ROLE_ADMIN and _consume(c, row["id"], "RESET", body.code):
            c.execute("UPDATE users SET password_hash=? WHERE id=?", (auth.hash_password(body.new_password), row["id"]))
            auth.revoke_user_sessions(c, row["id"])  # anyone using the old password is signed out
            ok = True
    if not ok:  # outside the transaction, so the wrong-guess counter is saved rather than rolled back
        auth.record_failure(email)
        raise HTTPException(400, "That code is invalid or has expired.")
    auth.clear_failures(email)
    return {"status": "Password updated. Please log in with your new password."}


@router.post("/auth/verify-email")
def verify_email(body: CodeIn, user: dict = Depends(auth.current_user)):
    ok = True
    with db.session() as c:
        if not user["email_verified"]:
            ok = _consume(c, user["id"], "VERIFY", body.code)
        if ok:
            c.execute("UPDATE users SET email_verified=1 WHERE id=?", (user["id"],))
    if not ok:
        raise HTTPException(400, "That code is invalid or has expired.")
    return {"email_verified": True}


@router.post("/auth/resend-verification")
def resend_verification(user: dict = Depends(auth.current_user)):
    if user["email_verified"]:
        return {"email_verified": True}
    with db.session() as c:
        send_verification(c, user)
    return {"status": "A new verification code has been sent."}


class PushTokenIn(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)
    platform: Optional[str] = Field(None, max_length=20)

    @field_validator("token")
    @classmethod
    def _expo(cls, v):
        if not (v.startswith("ExponentPushToken[") or v.startswith("ExpoPushToken[")):
            raise ValueError("not an Expo push token")
        return v


@router.post("/me/push-token", status_code=201)
def save_push_token(body: PushTokenIn, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        c.execute("DELETE FROM push_tokens WHERE token=?", (body.token,))  # a device belongs to whoever signed in last
        c.execute("INSERT INTO push_tokens(user_id, token, platform, created_at) VALUES(?,?,?,?)",
                  (user["id"], body.token, body.platform, db.now()))
    return {"status": "registered"}


@router.delete("/me/push-token")
def delete_push_token(body: PushTokenIn, user: dict = Depends(auth.current_user)):
    with db.session() as c:
        c.execute("DELETE FROM push_tokens WHERE token=? AND user_id=?", (body.token, user["id"]))
    return {"status": "removed"}


class PreferencesIn(BaseModel):
    model_config = {"extra": "forbid"}
    notify_sms: Optional[bool] = None
    phone: Optional[str] = Field(None, max_length=20)
    language: Optional[str] = Field(None, pattern="^(en|hi|kn)$")


@router.patch("/me/preferences")
def update_preferences(body: PreferencesIn, user: dict = Depends(auth.current_user)):
    import re
    sets, args = [], []
    data = body.model_dump(exclude_unset=True)
    if "phone" in data:
        phone = (data["phone"] or "").strip()
        if phone and not re.match(r"^\+?[0-9][0-9 \-]{6,17}$", phone):
            raise HTTPException(422, "Enter a valid phone number.")
        sets.append("phone=?"); args.append(phone or None)
    if "notify_sms" in data and data["notify_sms"] is not None:
        sets.append("notify_sms=?"); args.append(1 if data["notify_sms"] else 0)
    if "language" in data:
        sets.append("language=?"); args.append(data["language"])
    with db.session() as c:
        if sets:
            c.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=?", [*args, user["id"]])
        row = c.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        if row["notify_sms"] and not row["phone"]:
            raise HTTPException(422, "Add a phone number to receive SMS alerts.")
        return auth.user_public(row)


class LocationIn(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)


@router.post("/me/location")
def save_location(body: LocationIn, user: dict = Depends(auth.current_user)):
    """The user's last known position, used only to decide who receives an area alert."""
    with db.session() as c:
        c.execute("UPDATE users SET latitude=?, longitude=?, last_seen=? WHERE id=?",
                  (body.latitude, body.longitude, db.now(), user["id"]))
    return {"status": "saved"}
