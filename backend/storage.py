"""Cloudinary image storage (REST API, no SDK). The API secret stays on the backend and is only ever read from the
environment: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, or the single CLOUDINARY_URL
(cloudinary://API_KEY:API_SECRET@CLOUD_NAME) that the Cloudinary dashboard shows and the Render blueprint asks for.
When these are not set the backend keeps photos on local disk instead (see main.store_photo)."""
import hashlib
import os
import time
from typing import Optional

import httpx

FOLDER = "risknresq/incidents"
_transport: Optional[httpx.AsyncBaseTransport] = None  # tests inject httpx.MockTransport here


def credentials() -> Optional[tuple]:
    """(cloud name, api key, api secret) from the three variables, else from CLOUDINARY_URL; None when not configured."""
    parts = tuple(os.environ.get(k, "").strip() for k in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"))
    if all(parts):
        return parts
    url = os.environ.get("CLOUDINARY_URL", "").strip()
    if url.startswith("cloudinary://") and "@" in url and ":" in url:
        creds, cloud = url[len("cloudinary://"):].rsplit("@", 1)
        key, _, secret = creds.partition(":")
        if cloud and key and secret:
            return cloud.split("?")[0].strip("/"), key, secret
    return None


def cloud_configured() -> bool:
    return credentials() is not None


def sign(params: dict, api_secret: str) -> str:
    """Cloudinary signed-upload signature: sha1 of the sorted 'k=v' pairs joined with '&', followed by the secret."""
    to_sign = "&".join(f"{k}={params[k]}" for k in sorted(params) if params[k] not in (None, ""))
    return hashlib.sha1((to_sign + api_secret).encode()).hexdigest()


def thumbnail_url(url: str, width: int = 1000) -> str:
    """Ask Cloudinary for a resized, auto-quality version instead of the full-size original."""
    marker = "/upload/"
    return url.replace(marker, f"{marker}c_limit,w_{width},q_auto/", 1) if marker in url else url


async def upload_image(data: bytes, public_id: str, content_type: str = "application/octet-stream") -> str:
    """Upload bytes to Cloudinary and return the secure image URL. Raises RuntimeError on any failure."""
    creds = credentials()
    if not creds:
        raise RuntimeError("Cloudinary is not configured")
    cloud, key, secret = creds
    params = {"folder": FOLDER, "public_id": public_id, "timestamp": str(int(time.time()))}
    form = {**params, "api_key": key, "signature": sign(params, secret)}
    try:
        async with httpx.AsyncClient(transport=_transport, timeout=30) as client:
            res = await client.post(f"https://api.cloudinary.com/v1_1/{cloud}/image/upload", data=form,
                                    files={"file": (public_id, data, content_type)})
        res.raise_for_status()
        url = res.json().get("secure_url")
    except Exception as exc:  # network error, bad credentials, rate limit...
        raise RuntimeError(f"Cloudinary upload failed: {exc}") from exc
    if not url:
        raise RuntimeError("Cloudinary did not return an image URL")
    return url
