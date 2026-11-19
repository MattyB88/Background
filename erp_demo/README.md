# ERP Demo: REST API + AI over an ERP export

A working demo of what an API and an AI assistant can do on top of a manufacturing and
distribution ERP. It has the usual modules: customers (debtors), suppliers (creditors),
inventory, sales orders, invoices and AR, purchase orders and work orders. You can load
your own ERP export into it.

The layout and terms follow a typical Australian mid-market ERP such as Accentis.
It is an independent demo, not affiliated with Accentis and not using its branding.

## Run it

```bash
pip install -r erp_demo/requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...        # needed only for the AI Assistant
uvicorn erp_demo.app:app --reload          # run from the repo root
```

Open http://localhost:8000. The first time it starts, it fills the database with
**fictional** sample data so you have something to click through.

| Page | What it shows |
|---|---|
| Dashboard | KPIs, monthly sales, top customers |
| Customers / Inventory / Sales Orders / ... | Searchable, sortable lists. Click a row to see the full record and the raw API JSON. |
| AR Aging, Reorder Report | Reports, each with an "Ask AI" button |
| AI Assistant | Questions in plain English. Each answer lists the API calls the AI made to get it. |
| API Explorer | Try any endpoint and copy the matching `curl` command |
| Import Data | Upload export files from the browser |

Interactive OpenAPI docs are at http://localhost:8000/docs.

## Load your export

Put the CSV or Excel files in one folder, then run:

```bash
python -m erp_demo.importer path/to/export --dry-run   # preview the column mapping
python -m erp_demo.importer path/to/export --reset     # replace the sample data
```

You can also use **Import Data** in the UI.

- **How files are matched.** The importer looks at the file name first ("customer",
  "debtor", "stock", "invoice", "sales order", ...). If that doesn't settle it, it
  looks at the column headers.
- **How columns are matched.** Case and punctuation are ignored, so "Debtor Code",
  "Part No" and "SOH" all match. Columns it doesn't recognise are kept under `extra`
  and shown on the record.
- **Australian formats.** It reads `dd/mm/yyyy` dates and `$1,234.50` amounts.
- **Order lines.** If a sales order export has one row per line, it is split into
  order headers and lines.
- **Fixing the mapping.** If a column maps to the wrong field, add its header to the
  `ENTITIES` alias lists in `importer.py`.
- **Ageing date.** If the export is a few months old, set
  `ERP_DEMO_TODAY=YYYY-MM-DD` to the export date. Otherwise ageing and "overdue"
  figures are worked out from today's date.

The database (`erp_demo/data/erp.db`) and anything else in `erp_demo/data/` is
git-ignored, so real customer data stays on your machine.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/v1/{customers,suppliers,items,sales-orders,invoices,purchase-orders,work-orders}` | `q`, `sort` (`-field` for descending), `limit`, `offset`; any other parameter is an exact-match filter, e.g. `?status=Backorder` |
| GET | `/api/v1/{resource}/{id}` | Detail. Customers, items, sales orders and suppliers include related records. |
| POST | `/api/v1/sales-orders` | `{"customer_code": "...", "lines": [{"item_code": "...", "qty": 2}]}` |
| GET | `/api/v1/dashboard` | KPIs |
| GET | `/api/v1/reports/ar-aging` | Aging buckets by customer |
| GET | `/api/v1/reports/low-stock` | Items below reorder level, with a suggested order quantity |
| GET | `/api/v1/reports/sales-summary?group_by=customer\|item\|category\|month\|sales_rep` | |
| POST | `/api/v1/query` | `{"sql": "SELECT ..."}`: read-only SQL |
| POST | `/api/v1/ai/chat` | `{"message": "...", "session_id": null}` returns `{answer, trace, session_id}` |
| POST | `/api/v1/import` | Multipart upload of export files |

Set `ERP_DEMO_API_KEY` to require an `X-Api-Key` header on every API call.

## How the AI works

`ai.py` gives Claude one tool for each API operation. Claude decides which calls to
make, the server runs them through the same code the REST API uses (`services.py`),
and Claude writes the answer from the results. The `trace` in the response lists
every call, so you can show exactly where each figure came from.

The AI can read anything. The only change it can make is creating a sales order, and
only when asked. Ad-hoc SQL runs on a read-only database connection.

The default model is `claude-opus-5-5`. Set `ERP_DEMO_MODEL` to use another.
