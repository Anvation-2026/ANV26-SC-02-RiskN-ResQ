"""Outgoing notifications: Expo push, SMS/WhatsApp (Twilio) and email (SMTP).

Every channel is optional and failure-tolerant: a missing key or a provider outage is logged and never breaks the request
that triggered it. Sends run on a small thread pool so API calls are not slowed down (tests set INLINE = True)."""
import logging
import smtplib
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage

import httpx

import config
import db

logger = logging.getLogger(__name__)
INLINE = False  # tests run sends in-line so they can assert on them
_last_sent = {}  # (user id, kind, channel) -> time, so a burst of related alerts does not text the same person repeatedly
COOLDOWN_SECONDS = {"push": 600, "sms": 1800}
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="notify")
EXPO_URL = "https://exp.host/--/api/v2/push/send"


def _post(url: str, **kw):
    """Single choke point for outgoing HTTP so tests can replace it."""
    return httpx.post(url, timeout=10.0, **kw)


def _run(fn, *args):
    if INLINE:
        try:
            fn(*args)
        except Exception as exc:  # never let a notification break the caller
            logger.warning("notification failed: %s", exc)
        return
    def safe():
        try:
            fn(*args)
        except Exception as exc:
            logger.warning("notification failed: %s", exc)
    _pool.submit(safe)


# ---- channels -------------------------------------------------------------------------------------------------------
def _send_push(tokens: list, title: str, body: str, data: dict):
    if not tokens or not config.PUSH_ENABLED:
        return
    for i in range(0, len(tokens), 100):  # Expo accepts up to 100 messages per request
        msgs = [{"to": t, "title": title, "body": body, "data": data or {}, "sound": "default", "priority": "high"}
                for t in tokens[i:i + 100]]
        resp = _post(EXPO_URL, json=msgs)
        resp.raise_for_status()


def sms_configured() -> bool:
    return bool(config.TWILIO_ACCOUNT_SID and config.TWILIO_AUTH_TOKEN and config.TWILIO_FROM)


def _send_sms(phone: str, text: str):
    if not sms_configured():
        return
    to = phone if phone.startswith(("+", "whatsapp:")) else f"+91{phone}" if phone.isdigit() and len(phone) == 10 else phone
    sender = config.TWILIO_FROM
    if sender.startswith("whatsapp:") and not to.startswith("whatsapp:"):
        to = f"whatsapp:{to}"
    url = f"https://api.twilio.com/2010-04-01/Accounts/{config.TWILIO_ACCOUNT_SID}/Messages.json"
    resp = _post(url, data={"To": to, "From": sender, "Body": text[:600]}, auth=(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN))
    resp.raise_for_status()


def email_configured() -> bool:
    return bool(config.SMTP_HOST and config.SMTP_FROM)


def _send_email(to: str, subject: str, body: str):
    if not email_configured():
        # Development fallback: the operator sees the message in the server log. Never used when SMTP is configured.
        logger.warning("EMAIL not sent (SMTP not configured). To: %s | %s | %s", to, subject, body)
        return
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = config.SMTP_FROM, to, subject
    msg.set_content(body)
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as smtp:
        smtp.starttls()
        if config.SMTP_USER:
            smtp.login(config.SMTP_USER, config.SMTP_PASSWORD)
        smtp.send_message(msg)


# ---- public helpers (called from the API) ----------------------------------------------------------------------------
def email(to: str, subject: str, body: str):
    _run(_send_email, to, subject, body)


def tokens_for(c, user_ids) -> list:
    ids = list({i for i in user_ids if i is not None})
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    return [r["token"] for r in c.execute(f"SELECT token FROM push_tokens WHERE user_id IN ({marks})", ids).fetchall()]


def _cool(ids, kind: str, channel: str) -> list:
    """Drop users already notified of this kind on this channel recently; remember the rest."""
    import time
    now, keep = time.monotonic(), []
    for i in ids:
        key = (i, kind, channel)
        if now - _last_sent.get(key, -1e9) >= COOLDOWN_SECONDS[channel]:
            _last_sent[key] = now
            keep.append(i)
    return keep


def notify_users(c, user_ids, title: str, body: str, data: dict | None = None, sms: bool = False, cooldown: str | None = None) -> dict:
    """Push to these users' devices; also SMS/WhatsApp those who opted in when sms=True. `cooldown` names a kind of
    notification (e.g. "alert") that is sent to the same person at most once per cooldown period. Returns counts."""
    ids = list({i for i in user_ids if i is not None})
    push_ids = _cool(ids, cooldown, "push") if cooldown else ids
    tokens = tokens_for(c, push_ids)
    if tokens:
        _run(_send_push, tokens, title, body, data or {})
    texted = 0
    sms_ids = _cool(ids, cooldown, "sms") if cooldown else ids
    if sms and sms_configured() and sms_ids:
        marks = ",".join("?" * len(sms_ids))
        rows = c.execute(f"SELECT phone FROM users WHERE id IN ({marks}) AND notify_sms=1 AND phone IS NOT NULL AND phone!='' "
                         f"AND is_active=1", sms_ids).fetchall()
        for r in rows[:config.SMS_MAX_RECIPIENTS]:
            _run(_send_sms, r["phone"], f"{title}: {body}")
            texted += 1
    return {"push_devices": len(tokens), "sms": texted}


def users_near(c, latitude: float, longitude: float, km: float, roles=("user",)) -> list:
    """Ids of active users whose last known position is within km (users who never shared a position are not guessed at)."""
    from engine import haversine_meters
    marks = ",".join("?" * len(roles))
    rows = c.execute(f"SELECT id, latitude, longitude FROM users WHERE is_active=1 AND role IN ({marks}) "
                     f"AND latitude IS NOT NULL AND longitude IS NOT NULL", list(roles)).fetchall()
    return [r["id"] for r in rows if haversine_meters(latitude, longitude, r["latitude"], r["longitude"]) <= km * 1000]
