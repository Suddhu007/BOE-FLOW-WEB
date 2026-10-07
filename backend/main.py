from __future__ import annotations

import base64
import io
import json
import os
from typing import Optional

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

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

origins = [
    x.strip()
    for x in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://localhost:4173").split(",")
    if x.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "boe-flow-api"}

@app.post("/api/boe/process")
async def process_boe(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF Bill of Entry.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="The uploaded PDF is empty.")
    if len(pdf_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF exceeds the 25 MB upload limit.")

    try:
        header, df_items = process_complete_boe_portal(pdf_bytes)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"BOE processing failed: {exc}") from exc

    if header is None or df_items is None:
        raise HTTPException(status_code=422, detail="This PDF was not recognized as a valid Indian Customs Bill of Entry.")

    if not isinstance(df_items, pd.DataFrame):
        df_items = pd.DataFrame(df_items)

    items = json.loads(df_items.to_json(orient="records", date_format="iso"))
    if df_items.empty:
        grouped = []
    else:
        grouped_df = (
            df_items.groupby(["HSN Code", "UQC"], dropna=False)
            .agg({
                "Quantity": "sum",
                "Assessable Value (CIF INR)": "sum",
                "GST Taxable Value (for E-Way)": "sum",
                "Calculated IGST": "sum",
            })
            .reset_index()
        )
        grouped = json.loads(grouped_df.to_json(orient="records"))

    grouped_df = pd.DataFrame(grouped)
    excel = build_excel(header, grouped_df, df_items)
    return {
        "filename": file.filename,
        "header": _jsonable(header),
        "items": _jsonable(items),
        "grouped": _jsonable(grouped),
        "excel_base64": base64.b64encode(excel).decode("ascii"),
    }

@app.get("/api/hsn/{cth}")
def hsn_search(cth: str, country: Optional[str] = None, refresh: bool = False):
    try:
        if not refresh:
            cached = get_cached_hsn(cth, country)
            if cached:
                return cached
        result = fetch_icegate_hsn(cth, country)
        cache_hsn_result(result)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
