# Use 1n9 from n8n (and Make, Zapier, scripts)

Your 1n9 node has a small HTTP API. With it, a workflow can **ask your bot a question** and **push live data** (prices, stock, rows from an ERP or a sheet) into a live data source. n8n does the connecting; 1n9 does the answering.

There is no special n8n package needed: the standard **HTTP Request** node is enough.

## 1. Create an API key

In the node admin: **Channels → API & n8n → Create key**.

| Key type | What it can do |
|---|---|
| **chat** | Ask one bot you pick. Cannot read files or change anything. |
| **data** | Send tables to live data sources set to *receive pushed data*. |

The full key (`n9_…`) is shown **once**. Store it in n8n credentials (*Header Auth*, name `Authorization`, value `Bearer n9_…`). Lost it? Delete it and create a new one. You can switch a key off or delete it at any time; it stops working immediately.

## 2. Pick the URL

| URL | Use when |
|---|---|
| **Public URL** — shown on the same page, looks like `https://central.1n9ai.com/v1/relay/<your id>` | n8n runs anywhere else (n8n Cloud, another server). Your node must be running and online; it keeps an outbound connection to our server, so you do **not** open any port. |
| **Direct URL** — `http://<node address>:<port>/api/v1` | n8n runs on the same computer or network as the node. |

Both give the same answers. Below, `BASE` means whichever you use.

## 3. Ask the bot

`POST BASE/chat`

```json
{ "message": "ท่อ PVC 4 หุน สั่ง 60 เส้น รวมเท่าไร",
  "history": [ { "role": "user", "text": "…" }, { "role": "assistant", "text": "…" } ] }
```

`history` is optional (last 6 turns are used). Answer:

```json
{ "reply": "…" }
```

In n8n: HTTP Request → Method `POST` → URL `BASE/chat` → Authentication *Header Auth* → Body *JSON*. Set the request timeout to at least 120 s (answers usually take 10–25 s).

## 4. Push live data

First create a source: **Knowledge → your KB → Live data → Connect live data → “Receive pushed data”**. Its **id** is shown on the source card.

`GET BASE/sources` (data key) lists push sources with their ids.

`PUT BASE/sources/<id>/rows`

```json
{ "rows": [ { "sku": "P-0101", "name": "PVC 4 inch", "price": 95, "stock": 30 } ] }
```

- Send the **whole table every time** (up to 5,000 rows). 1n9 compares it with the previous version: a changed price or stock is patched in place **without re-embedding**; only a brand-new row costs a small embedding call.
- **Safety brake:** if a push loses more than half the rows or columns (or is empty), it is **held** and the bot keeps answering from the previous data, so a cleared sheet cannot wipe the bot. You get `409` with `"status": "held"`. If the change is intended, repeat the same request with `?force=true`.
- In n8n use *Body → JSON* with the expression `{{ { rows: $input.all().map(i => i.json) } }}`.

## 5. Other endpoints

`GET BASE/me` — who this key is (name, type, bot). Handy as a connection test.

## Errors

JSON, always `{ "error": "<code>", "message": "<how to fix>" }`.

| Status | `error` | Meaning |
|---|---|---|
| 401 | `unauthorized` | Key missing, wrong, or switched off. |
| 403 | `wrong_scope` | A chat key was used for data (or the other way round). |
| 404 | `not_found`, `source_not_found` | Wrong path, or not a push source. |
| 409 | `held`, `source_off`, `bot_missing` | See the message. |
| 413 | `payload_too_large` | Chat ≤ 64 KB, pushed rows ≤ 16 MB. |
| 429 | `busy`, `rate_limited` | Too many at once. Retry after a few seconds. |
| 502 | `provider_quota_exhausted`, `credential_invalid`, … | The node's AI key is out of credit or invalid. Fix it in the node admin. |
| 503 | `node_offline` | (Public URL) the node is not running or has no internet. |
| 504 | `node_timeout` | The node did not answer in time. |

Limits: 4 questions at once per node; 120 requests per minute per IP on the public URL.

## Templates

Import from `docs/n8n/` (n8n → Workflows → Import from file), then replace `YOUR_BASE_URL` and `YOUR_API_KEY`:

- `ask-1n9.json` — manual trigger → ask a question → reply.
- `push-rows-1n9.json` — manual trigger → build two sample rows → push to a source.

## What passes where

Your files, knowledge bases and AI keys stay on your side. When you ask a question, the text and the matching passages are processed by our central server **in memory** for that request and sent to the AI provider you chose; our server does not store or log the content. Pushed rows travel the same way (through our server in memory, then into **your** vector database). Using the Direct URL skips our server for the API call itself, but answering still goes through the same processing.
