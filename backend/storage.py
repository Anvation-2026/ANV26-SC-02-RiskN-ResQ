"""Cloudinary image storage (REST API, no SDK). The API secret stays on the backend and is only ever read from the
environment: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
When these are not set the backend keeps photos on local disk instead (see main.store_photo)."""
import hashlib
import os
import time
from typing import Optional

import httpx

FOLDER = "risknresq/incidents"
_transport: Optional[httpx.AsyncBaseTransport] = None  # tests inject httpx.MockTransport here


def cloud_configured() -> bool:
    return all(os.environ.get(k, "").strip() for k in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"))


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
    cloud = os.environ["CLOUDINARY_CLOUD_NAME"].strip()
    key = os.environ["CLOUDINARY_API_KEY"].strip()
    secret = os.environ["CLOUDINARY_API_SECRET"].strip()
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
