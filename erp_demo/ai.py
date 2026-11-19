"""AI assistant: Claude answers questions by calling the same operations the REST API exposes.

Each tool maps 1:1 to a REST endpoint, and every call is returned in a trace so the demo
can show exactly which API requests the AI made to reach its answer.
"""
from __future__ import annotations

import json
import os
import uuid

import anthropic

from . import services

MODEL = os.environ.get("ERP_DEMO_MODEL", "claude-opus-5-5")

SYSTEM = """You are the AI assistant built into an ERP system for an Australian manufacturing and \
distribution business. You answer questions from staff (sales, accounts, purchasing, production, \
management) using the ERP's API, exposed to you as tools.

- Always get figures from the tools; never invent customers, items, orders or amounts.
- Currency is AUD. Sales figures are ex GST unless stated; invoice totals and balances are inc GST.
- Be concise and businesslike. Use short markdown tables for lists of records. Lead with the answer.
- Mention record codes (customer code, order no, item code) so staff can look them up.
- If a question needs data the tools can't provide, say what's missing.
- Only create a sales order when the user clearly asks you to; confirm what you created.
- When drafting emails or letters, write them ready to send, based on the real records."""

TOOLS = [
    {"name": "search_records",
     "description": "List/search records of one resource (GET /api/v1/{resource}). Free-text q matches codes, names, "
                    "descriptions, status. filters are exact-match on a field, e.g. {\"status\": \"Backorder\"} or "
                    "{\"customer_code\": \"APEXEN01\"}. sort is a field name, prefix '-' for descending.",
     "input_schema": {"type": "object", "properties": {
         "resource": {"type": "string", "enum": list(services.SEARCH_COLUMNS)},
         "q": {"type": "string"},
         "filters": {"type": "object", "additionalProperties": {"type": "string"}},
         "sort": {"type": "string"},
         "limit": {"type": "integer", "default": 25}},
         "required": ["resource"]}},
    {"name": "get_customer",
     "description": "Customer detail with balance, overdue amount, credit available, YTD sales, recent orders and open invoices "
                    "(GET /api/v1/customers/{code}).",
     "input_schema": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}},
    {"name": "get_supplier",
     "description": "Supplier detail with open purchase orders and items supplied (GET /api/v1/suppliers/{code}).",
     "input_schema": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}},
    {"name": "get_item",
     "description": "Inventory item detail: stock on hand, allocated, available, on order, margin, recent sales, open work "
                    "orders (GET /api/v1/items/{code}).",
     "input_schema": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}},
    {"name": "get_sales_order",
     "description": "Sales order with lines, customer and invoices (GET /api/v1/sales-orders/{order_no}).",
     "input_schema": {"type": "object", "properties": {"order_no": {"type": "string"}}, "required": ["order_no"]}},
    {"name": "ar_aging",
     "description": "Accounts receivable aging by customer in buckets current/1-30/31-60/61-90/90+ days overdue "
                    "(GET /api/v1/reports/ar-aging).",
     "input_schema": {"type": "object", "properties": {"customer_code": {"type": "string"}}}},
    {"name": "low_stock",
     "description": "Stock items whose projected stock (on hand - allocated + on order) is below reorder level, with "
                    "suggested order quantity and supplier (GET /api/v1/reports/low-stock).",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "sales_summary",
     "description": "Sales ex GST from sales orders grouped by customer, item, category, month or sales_rep, optionally "
                    "within a date range (YYYY-MM-DD) (GET /api/v1/reports/sales-summary).",
     "input_schema": {"type": "object", "properties": {
         "group_by": {"type": "string", "enum": list(services.SUMMARY_GROUPS)},
         "date_from": {"type": "string"}, "date_to": {"type": "string"},
         "limit": {"type": "integer", "default": 20}}, "required": ["group_by"]}},
    {"name": "dashboard",
     "description": "Headline KPIs: sales MTD/YTD, open orders, AR outstanding/overdue, low stock count, open work and "
                    "purchase orders, top customers, monthly sales (GET /api/v1/dashboard).",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "run_sql",
     "description": "Run one read-only SQLite SELECT for questions the other tools can't answer (POST /api/v1/query). "
                    "Tables: customers(code,name,contact,email,phone,address,city,state,postcode,terms_days,credit_limit,"
                    "sales_rep,status), suppliers(code,name,...,terms_days,status), items(code,description,category,uom,"
                    "cost_price,sell_price,on_hand,allocated,on_order,reorder_level,warehouse,supplier_code,item_type), "
                    "sales_orders(order_no,customer_code,order_date,required_date,status,customer_ref,sales_rep,total_ex,"
                    "total_inc), sales_order_lines(order_no,line_no,item_code,description,qty,qty_shipped,unit_price,"
                    "line_total), invoices(invoice_no,customer_code,order_no,invoice_date,due_date,total_inc,paid,balance,"
                    "status), purchase_orders(po_no,supplier_code,order_date,due_date,status,total_ex), "
                    "work_orders(wo_no,item_code,qty,qty_completed,start_date,due_date,status,order_no). "
                    "Dates are ISO text. Every table also has an 'extra' JSON text column of unmapped export fields.",
     "input_schema": {"type": "object", "properties": {"sql": {"type": "string"}}, "required": ["sql"]}},
    {"name": "create_sales_order",
     "description": "Create a new sales order (POST /api/v1/sales-orders). Price defaults to the item's sell price. "
                    "Only use when the user explicitly asks to create/enter an order.",
     "input_schema": {"type": "object", "properties": {
         "customer_code": {"type": "string"},
         "customer_ref": {"type": "string"},
         "required_date": {"type": "string"},
         "lines": {"type": "array", "items": {"type": "object", "properties": {
             "item_code": {"type": "string"}, "qty": {"type": "number"}, "unit_price": {"type": "number"}},
             "required": ["item_code", "qty"]}}},
         "required": ["customer_code", "lines"]}},
]


def _api_path(name: str, args: dict) -> str:
    paths = {
        "search_records": lambda a: f"GET /api/v1/{a.get('resource', '').replace('_', '-')}",
        "get_customer": lambda a: f"GET /api/v1/customers/{a.get('code')}",
        "get_supplier": lambda a: f"GET /api/v1/suppliers/{a.get('code')}",
        "get_item": lambda a: f"GET /api/v1/items/{a.get('code')}",
        "get_sales_order": lambda a: f"GET /api/v1/sales-orders/{a.get('order_no')}",
        "ar_aging": lambda a: "GET /api/v1/reports/ar-aging",
        "low_stock": lambda a: "GET /api/v1/reports/low-stock",
        "sales_summary": lambda a: f"GET /api/v1/reports/sales-summary?group_by={a.get('group_by')}",
        "dashboard": lambda a: "GET /api/v1/dashboard",
        "run_sql": lambda a: "POST /api/v1/query",
        "create_sales_order": lambda a: "POST /api/v1/sales-orders",
    }
    return paths.get(name, lambda a: name)(args)


def execute_tool(name: str, args: dict):
    if name == "search_records":
        return services.list_records(args["resource"], args.get("q"), args.get("filters"), args.get("sort"),
                                     args.get("limit", 25))
    if name in ("get_customer", "get_supplier", "get_item"):
        fn = getattr(services, name)
        return fn(args["code"]) or {"error": f"{args['code']} not found"}
    if name == "get_sales_order":
        return services.get_sales_order(args["order_no"]) or {"error": f"{args['order_no']} not found"}
    if name == "ar_aging":
        return services.ar_aging(args.get("customer_code"))
    if name == "low_stock":
        return services.low_stock()
    if name == "sales_summary":
        return services.sales_summary(args["group_by"], args.get("date_from"), args.get("date_to"), args.get("limit", 20))
    if name == "dashboard":
        return services.dashboard()
    if name == "run_sql":
        return services.run_sql(args["sql"])
    if name == "create_sales_order":
        return services.create_sales_order(args["customer_code"], args["lines"], args.get("customer_ref"),
                                           args.get("required_date"))
    raise ValueError(f"Unknown tool {name}")


# In-memory conversations: session id -> full message history (assistant content kept verbatim,
# including thinking blocks, which must be passed back unchanged on the next request).
_SESSIONS: dict[str, list] = {}
_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def chat(message: str, session_id: str | None = None, max_steps: int = 12) -> dict:
    session_id = session_id or uuid.uuid4().hex
    messages = _SESSIONS.setdefault(session_id, [])
    start_len = len(messages)
    messages.append({"role": "user", "content": message})
    system = SYSTEM + f"\n\nToday's business date is {services.today().isoformat()}."
    trace = []
    try:
        for _ in range(max_steps):
            response = _get_client().beta.messages.create(
                model=MODEL,
                max_tokens=16000,
                system=system,
                tools=TOOLS,
                messages=messages,
                output_config={"effort": "medium"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
            messages.append({"role": "assistant", "content": response.content})
            if response.stop_reason == "refusal":
                return {"session_id": session_id, "answer": "Sorry, I can't help with that request.", "trace": trace}
            if response.stop_reason == "pause_turn":
                continue
            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if response.stop_reason != "tool_use" or not tool_uses:
                answer = "\n".join(b.text for b in response.content if b.type == "text").strip()
                if response.stop_reason == "max_tokens":
                    answer += "\n\n_(answer truncated)_"
                return {"session_id": session_id, "answer": answer, "trace": trace}
            results = []
            for tu in tool_uses:
                entry = {"tool": tu.name, "api": _api_path(tu.name, tu.input), "input": tu.input}
                try:
                    out = execute_tool(tu.name, tu.input)
                    content, is_error = json.dumps(out, default=str)[:60000], False
                    entry["rows"] = (len(out) if isinstance(out, list) else
                                     len(out.get("data", out.get("rows", []))) if isinstance(out, dict) else None)
                except Exception as e:  # tool errors go back to Claude so it can correct itself
                    content, is_error = f"Error: {e}", True
                    entry["error"] = str(e)
                trace.append(entry)
                results.append({"type": "tool_result", "tool_use_id": tu.id, "content": content, "is_error": is_error})
            messages.append({"role": "user", "content": results})
        return {"session_id": session_id, "answer": "I hit the step limit before finishing - try a narrower question.",
                "trace": trace}
    except Exception:
        del messages[start_len:]  # keep history valid for the next turn
        raise


def reset(session_id: str) -> None:
    _SESSIONS.pop(session_id, None)
