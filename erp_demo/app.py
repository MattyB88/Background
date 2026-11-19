"""REST API + web UI for the ERP demo.

    uvicorn erp_demo.app:app --reload        # then open http://localhost:8000
    Interactive API docs: http://localhost:8000/docs
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import anthropic
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ai, db, importer, services

STATIC = Path(__file__).parent / "static"
RESOURCES = {  # URL name -> table
    "customers": "customers", "suppliers": "suppliers", "items": "items",
    "sales-orders": "sales_orders", "invoices": "invoices",
    "purchase-orders": "purchase_orders", "work-orders": "work_orders",
}


def require_key(x_api_key: str | None = Header(default=None)):
    """If ERP_DEMO_API_KEY is set, every /api call must send it in the X-Api-Key header."""
    expected = os.environ.get("ERP_DEMO_API_KEY")
    if expected and x_api_key != expected:
        raise HTTPException(401, "Missing or invalid X-Api-Key")


app = FastAPI(title="ERP Demo API", version="1.0",
              description="REST + AI API over data imported from an ERP export.")
api = Depends(require_key)


@app.on_event("startup")
def _startup():
    if not db.DB_PATH.exists():
        from . import seed
        seed.build()
    db.init_db()


def _bad(e: Exception):
    raise HTTPException(400, str(e))


# ------------------------------------------------------------------ reports

@app.get("/api/v1/dashboard", dependencies=[api], tags=["reports"])
def dashboard():
    return services.dashboard()


@app.get("/api/v1/reports/ar-aging", dependencies=[api], tags=["reports"])
def ar_aging(customer_code: str | None = None):
    return services.ar_aging(customer_code)


@app.get("/api/v1/reports/low-stock", dependencies=[api], tags=["reports"])
def low_stock():
    return {"data": services.low_stock()}


@app.get("/api/v1/reports/sales-summary", dependencies=[api], tags=["reports"])
def sales_summary(group_by: str = "month", date_from: str | None = None, date_to: str | None = None, limit: int = 24):
    try:
        return {"data": services.sales_summary(group_by, date_from, date_to, limit)}
    except ValueError as e:
        _bad(e)


class Query(BaseModel):
    sql: str


@app.post("/api/v1/query", dependencies=[api], tags=["reports"])
def query(body: Query):
    """Run a single read-only SELECT."""
    try:
        return services.run_sql(body.sql)
    except Exception as e:  # sqlite errors included
        _bad(e)


# ------------------------------------------------------------------ AI

class ChatIn(BaseModel):
    message: str
    session_id: str | None = None


@app.post("/api/v1/ai/chat", dependencies=[api], tags=["ai"])
def ai_chat(body: ChatIn):
    """Ask a question in plain English. Returns the answer plus the API calls the AI made."""
    try:
        return ai.chat(body.message, body.session_id)
    except anthropic.AuthenticationError:
        raise HTTPException(503, "AI unavailable: set ANTHROPIC_API_KEY before starting the server.")
    except anthropic.RateLimitError:
        raise HTTPException(429, "AI rate limited - try again in a moment.")
    except anthropic.APIConnectionError:
        raise HTTPException(503, "AI unavailable: could not reach the Claude API.")
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"AI error: {e.message}")
    except TypeError as e:  # e.g. no credentials configured
        if "api_key" in str(e) or "auth" in str(e).lower():
            raise HTTPException(503, "AI unavailable: set ANTHROPIC_API_KEY before starting the server.")
        raise


@app.delete("/api/v1/ai/chat/{session_id}", dependencies=[api], tags=["ai"])
def ai_reset(session_id: str):
    ai.reset(session_id)
    return {"ok": True}


# ------------------------------------------------------------------ import

@app.post("/api/v1/import", dependencies=[api], tags=["admin"])
async def import_files(files: list[UploadFile] = File(...), reset: bool = False):
    """Upload CSV/XLSX export files. reset=true replaces all existing data."""
    tmp = Path(tempfile.mkdtemp())
    try:
        paths = []
        for f in files:
            p = tmp / Path(f.filename or "upload.csv").name
            with p.open("wb") as out:
                shutil.copyfileobj(f.file, out)
            paths.append(p)
        return {"log": importer.import_paths(paths, reset=reset)}
    except Exception as e:
        _bad(e)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------ records

class LineIn(BaseModel):
    item_code: str
    qty: float = Field(gt=0)
    unit_price: float | None = None


class SalesOrderIn(BaseModel):
    customer_code: str
    lines: list[LineIn]
    customer_ref: str | None = None
    required_date: str | None = None


@app.post("/api/v1/sales-orders", dependencies=[api], tags=["records"], status_code=201)
def create_sales_order(body: SalesOrderIn):
    try:
        return services.create_sales_order(body.customer_code, [l.model_dump() for l in body.lines],
                                           body.customer_ref, body.required_date)
    except ValueError as e:
        _bad(e)


@app.get("/api/v1/{resource}", dependencies=[api], tags=["records"])
def list_resource(resource: str, request: Request, q: str | None = None, sort: str | None = None,
                  limit: int = 50, offset: int = 0):
    """List records. Any other query parameter is an exact-match filter, e.g. ?status=Open&customer_code=X."""
    if resource not in RESOURCES:
        raise HTTPException(404, f"Unknown resource. Use one of: {', '.join(RESOURCES)}")
    filters = {k: v for k, v in request.query_params.items() if k not in ("q", "sort", "limit", "offset")}
    try:
        return services.list_records(RESOURCES[resource], q, filters, sort, limit, offset)
    except ValueError as e:
        _bad(e)


@app.get("/api/v1/{resource}/{key}", dependencies=[api], tags=["records"])
def get_resource(resource: str, key: str):
    if resource not in RESOURCES:
        raise HTTPException(404, "Unknown resource")
    detail = {"customers": services.get_customer, "suppliers": services.get_supplier,
              "items": services.get_item, "sales-orders": services.get_sales_order}.get(resource)
    rec = detail(key) if detail else services.get_record(RESOURCES[resource], key)
    if not rec:
        raise HTTPException(404, f"{key} not found")
    return rec


# ------------------------------------------------------------------ UI

@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
