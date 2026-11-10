import { apiKey, appVersion, pricingEnabled, publicBaseUrl } from '$lib/server/config';
import { wrapApi } from '$lib/server/http';

export const GET = wrapApi(({ url, request }) => {
  const ingressPath = (request.headers.get('x-ingress-path') ?? '').replace(/\/+$/, '');
  const origin = publicBaseUrl || `${url.origin}${ingressPath}`;
  const base = `${origin}/api/v1`;
  const auth = apiKey
    ? `Authentication is ENABLED. Send "Authorization: Bearer $INVENTORY_API_KEY" on every request.`
    : `Authentication is currently disabled. If the owner sets INVENTORY_API_KEY, send "Authorization: Bearer <key>".`;
  const pricingFields = pricingEnabled
    ? `  "price": 0.02,\n  "currency": "GBP",\n`
    : '';
  const pricingNote = pricingEnabled
    ? '- price is per unit; total_value = price * quantity.'
    : '- Pricing and value tracking are disabled on this instance; price and total_value are null.';

  const text = `# Inventory API

Self-hosted inventory of electronics components, electrical items, tools and supplies.
Version: ${appVersion}
Base URL: ${base}
OpenAPI spec: ${base}/openapi.json
Human docs: ${origin}/api

${auth}

## Rules for AI agents
- Call GET /meta first. It returns every location, category, tag, unit and the current stats.
- Use the UUID "id" fields exactly as returned. Never invent IDs.
- Search before creating: GET /items?q=<words>. Items have a unique optional "sku".
- Create items with POST /items and a JSON body. Only "name" is required.
- Adjust stock with POST /items/{id}/stock using {"delta": 1} or {"set": 10}; do not PATCH quantity for routine stock changes.
- Upload photos/manuals with POST /attachments as multipart/form-data (file, item_id or location_id, kind=photo|document, caption).
- Locations are a tree. Create nested locations by passing parent_id. GET /locations?tree=true returns the tree.
- Responses are {"data": ...} on success and {"error": {"code","message","details"}} on failure. HTTP status codes are meaningful.
- List endpoints are paginated with limit/offset and return pagination.total + pagination.has_more.

## Endpoints
GET    /health
GET    /meta
GET    /items?q=&category=&tag=&location_id=&low_stock=&limit=&offset=
POST   /items
POST   /items/bulk                      (up to 500 items; partial success -> 207)
GET    /items/{id}
PATCH  /items/{id}                      (partial update)
DELETE /items/{id}
POST   /items/{id}/stock                ({"delta": -2, "reason": "used"})
GET    /items/{id}/movements
GET    /locations?tree=true
POST   /locations                       ({"name":"Drawer 1a","parent_id":"..."})
GET    /locations/{id}
PATCH  /locations/{id}
DELETE /locations/{id}
GET    /attachments?item_id={id}
POST   /attachments                     (multipart/form-data)
GET    /attachments/{id}
DELETE /attachments/{id}
GET    /attachments/{id}/file
GET    /search?q=
GET    /export
GET    /backup                          (consistent SQLite database snapshot)
POST   /restore                         (multipart/form-data file=@backup.db; destructive)

## Item shape
{
  "name": "10kΩ resistor 0.25W",          // required
  "sku": "RES-10K-025",
  "description": "Carbon film, 5% tolerance",
  "category": "Resistors",
  "quantity": 240,
  "unit": "pcs",
  "min_quantity": 50,
  "location_id": "uuid-of-a-location",
  "manufacturer": "Yageo",
  "mpn": "CFR-25JB-52-10K",
  "supplier": "Mouser",
  "supplier_url": "https://...",
${pricingFields}  "datasheet_url": "https://...",
  "notes": "Bought in 2025",
  "tags": ["through-hole", "10k"],
  "custom_fields": {"tolerance": "5%", "power": "0.25W"},
  "archived": false
}

## Examples

Create a location:
curl -X POST ${base}/locations \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Drawer 1a","parent_id":"<drawer-unit-id>"}'

Create an item:
curl -X POST ${base}/items \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"10k resistor","category":"Resistors","quantity":100,"location_id":"<id>","tags":["through-hole"]}'

Adjust stock:
curl -X POST ${base}/items/<id>/stock \\
  -H 'Content-Type: application/json' \\
  -d '{"delta":-5,"reason":"used","note":"Prototype build"}'

Upload a manual:
curl -X POST ${base}/attachments \\
  -F 'file=@manual.pdf' -F 'item_id=<id>' -F 'kind=document'

Download and restore a database backup:
curl ${base}/backup -o inventory-backup.db
curl -X POST ${base}/restore -F 'file=@inventory-backup.db'

## Notes
- Quantities are numbers and may be fractional (e.g. 2.5 metres of wire).
- low_stock is true when min_quantity > 0 and quantity <= min_quantity.
${pricingNote}
- Deleting a location fails with 409 unless it is empty (no children, items or attachments).
- Uploads are stored in the server's data/uploads directory; max size is controlled by MAX_UPLOAD_MB.
- Database backups contain items, locations, stock history and attachment metadata. Uploaded files are not included; copy the uploads directory separately.
- POST /restore replaces the entire database. It validates the uploaded SQLite file first and rejects backups from a newer schema version.
`;

  return new Response(text, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
  });
});
