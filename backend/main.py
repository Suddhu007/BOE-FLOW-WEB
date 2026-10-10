from __future__ import annotations

import base64
import logging
import os
from collections import defaultdict, deque
from threading import Lock
from time import monotonic
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

try:
    from .core.parser import process_complete_boe_portal
    from .core.exporter import build_excel
    from .core.icegate_hsn import fetch_icegate_hsn, get_cached_hsn, cache_hsn_result
except ImportError:
    # Supports Render, where main.py is imported as a top-level module.
    from core.parser import process_complete_boe_portal
    from core.exporter import build_excel
    from core.icegate_hsn import fetch_icegate_hsn, get_cached_hsn, cache_hsn_result

app = FastAPI(
    title="BOE FLOW API",
    version="1.0.0",
    description="Backend API for BOE FLOW customs document processing.",
)
logger = logging.getLogger(__name__)
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
RATE_LIMITS = {"boe": (10, 60), "hsn": (60, 60)}
_request_windows = defaultdict(deque)
_rate_limit_lock = Lock()

origins = [
    x.strip()
    for x in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://localhost:4173").split(",")
    if x.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    # This API uses no cookies or browser credentials.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def production_headers(request: Request, call_next):
    """Avoid caching uploaded-document results and add baseline browser protections."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response

def _jsonable(value):
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value


def _enforce_rate_limit(request: Request, scope: str) -> None:
    """Basic per-process throttling; use a shared limiter when scaling out."""
    limit, window_seconds = RATE_LIMITS[scope]
    forwarded_for = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded_for.split(",", 1)[0].strip() or (
        request.client.host if request.client else "unknown"
    )
    key = (scope, client_ip)
    now = monotonic()

    with _rate_limit_lock:
        timestamps = _request_windows[key]
        while timestamps and timestamps[0] <= now - window_seconds:
            timestamps.popleft()
        if len(timestamps) >= limit:
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again shortly.",
                headers={"Retry-After": str(window_seconds)},
            )
        timestamps.append(now)

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "boe-flow-api"}

@app.post("/api/boe/process")
async def process_boe(request: Request, file: UploadFile = File(...)):
    _enforce_rate_limit(request, "boe")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF Bill of Entry.")
    if file.content_type and file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="The uploaded file must be a PDF.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="The uploaded PDF is empty.")
    if len(pdf_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds the 25 MB upload limit.")

    try:
        header, df_items = process_complete_boe_portal(pdf_bytes)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"BOE processing failed: {exc}") from exc

    if header is None or df_items is None:
        raise HTTPException(status_code=422, detail="This PDF was not recognized as a valid Indian Customs Bill of Entry.")

    items = list(df_items)
    groups = {}
    fields = ("Quantity", "Assessable Value (CIF INR)", "GST Taxable Value (for E-Way)", "Calculated IGST")
    for item in items:
        key = (item.get("HSN Code", ""), item.get("UQC", ""))
        record = groups.setdefault(key, {"HSN Code": key[0], "UQC": key[1], **{field: 0 for field in fields}})
        for field in fields:
            record[field] += float(item.get(field, 0) or 0)
    grouped = list(groups.values())
    excel = build_excel(header, grouped, items)
    return {
        "filename": file.filename,
        "header": _jsonable(header),
        "items": _jsonable(items),
        "grouped": _jsonable(grouped),
        "excel_base64": base64.b64encode(excel).decode("ascii"),
    }

@app.get("/api/hsn/{cth}")
def hsn_search(
    request: Request,
    cth: str,
    country: Optional[str] = None,
    refresh: bool = False,
):
    _enforce_rate_limit(request, "hsn")
    try:
        if not refresh:
            cached = get_cached_hsn(cth, country)
            if cached:
                return cached
        result = fetch_icegate_hsn(cth, country)
        try:
            cache_hsn_result(result)
        except OSError:
            # Render/Vercel filesystems can be read-only or ephemeral. A cache
            # failure must not turn an otherwise valid ICEGATE response into 502.
            logger.warning("Unable to persist HSN cache", exc_info=True)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("HSN lookup failed")
        raise HTTPException(
            status_code=502,
            detail="HSN lookup is temporarily unavailable. Please try again.",
        ) from exc
