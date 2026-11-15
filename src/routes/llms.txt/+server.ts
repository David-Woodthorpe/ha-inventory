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
- Adjust stock with POST /items/{id}/stock using {"delta": 1} or {"set": 10}; do not PATCH quantity for routine stock changes. Pass an optional "location_id" to target one stock lot.
- One item can hold stock in several locations. Move part of the quantity with POST /items/{id}/transfer ({"from_location_id","to_location_id","quantity"}). Do not create duplicate items for the same SKU.
- Move whole items between bins in bulk with POST /items/move ({"item_ids":["..."],"to_location_id":"..."}). It consolidates every lot of each item into the destination, keeps totals unchanged, and returns 207 when some items failed.
- Sign a component out to another item with POST /items/{id}/components on the host ({"component_item_id","quantity"}). Stock is removed immediately. Return it with POST /items/{id}/components/{allocationId}/return (omit quantity to return everything).
- Upload photos/manuals with POST /attachments as multipart/form-data (file, item_id or location_id, kind=photo|document, caption).
- Log maintenance with POST /items/{id}/service. Each service record has a date and optional notes, cost and receipt uploads. Service schedules are optional per item.
- Locations are a tree. Create nested locations by passing parent_id. GET /locations?tree=true returns the tree.
- A drawer or tray that is divided into cells is a grid map: set grid_cols and grid_rows on the container, then place its child locations as bins with PUT /locations/{id}/layout. A bin is just a child location, so moving it to another drawer is PATCH /locations/{id} with parent_id — that clears its position, because cells belong to the old grid. Read the current arrangement with GET /locations/{id}/layout before changing it; the call replaces the whole map, so send every bin you want to keep.
- Categories are managed records. Create one with POST /categories, then use its name as the item's "category". Each category can have a built-in icon and an uploaded image; items without a photo expose category_icon and category_image_url as display fallbacks. Renaming a category updates its items.
- Responses are {"data": ...} on success and {"error": {"code","message","details"}} on failure. HTTP status codes are meaningful.
- List endpoints are paginated with limit/offset and return pagination.total + pagination.has_more.

## Endpoints
GET    /health
GET    /meta
GET    /items?q=&category=&tag=&location_id=&low_stock=&limit=&offset=
POST   /items
POST   /items/bulk                      (up to 500 items; partial success -> 207)
POST   /items/move                      ({"item_ids":[...],"to_location_id":"..."}; partial success -> 207)
GET    /items/{id}
PATCH  /items/{id}                      (partial update; changing location_id consolidates stock)
DELETE /items/{id}                      (409 while components are installed)
GET    /items/{id}/stock                (per-location stock lots)
POST   /items/{id}/stock                ({"delta": -2, "reason": "used"} or {"set": 10, "location_id": "..."})
POST   /items/{id}/transfer             ({"from_location_id":"...","to_location_id":"...","quantity":40})
GET    /items/{id}/components           (components installed in this item)
POST   /items/{id}/components           ({"component_item_id":"...","quantity":2})
POST   /items/{id}/components/{allocationId}/return  ({"quantity":2}; omit quantity for all)
GET    /items/{id}/movements
GET    /items/{id}/service              (service history, newest first)
POST   /items/{id}/service              ({"performed_at":"2026-05-12","notes":"..."})
GET    /items/{id}/service/{recordId}
PATCH  /items/{id}/service/{recordId}
DELETE /items/{id}/service/{recordId}
GET    /locations?tree=true
POST   /locations                       ({"name":"Drawer 1a","parent_id":"..."})
GET    /locations/{id}
PATCH  /locations/{id}                  (rename, move, or set grid_cols/grid_rows)
DELETE /locations/{id}
GET    /locations/{id}/layout           (grid size, placed bins, unplaced bins, loose items)
PUT    /locations/{id}/layout           ({"bins":[{"location_id":"...","x":0,"y":0,"w":1,"h":2,"rotation":0}]}; replaces the map)
GET    /categories                        (with item counts, icons and image URLs)
POST   /categories                        ({"name":"Resistors","icon":"cpu"})
GET    /categories/{id}
PATCH  /categories/{id}                   (rename updates every item in the category)
DELETE /categories/{id}                   (items are kept and become uncategorised)
GET    /categories/{id}/image
POST   /categories/{id}/image             (multipart/form-data file=@icon.png)
DELETE /categories/{id}/image
GET    /attachments?item_id={id}&service_record_id={id}
POST   /attachments                     (multipart/form-data; add service_record_id for a service receipt)
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
  "archived": false,
  "ha_enabled": false,
  "service_interval_months": 12,          // optional; every 12 months
  "service_next_due": "2026-05-12",       // optional; YYYY-MM-DD
  "service_notes": "Replace the battery"  // optional
}

## Grid maps

A drawer, tray or shelf that is divided into cells gets a map. The container holds the grid
size; each bin is one of its child locations, holding a footprint and a position.

- Set the grid on the container: PATCH /locations/{id} with {"grid_cols":5,"grid_rows":8}.
- Place bins with PUT /locations/{id}/layout. The body is the whole map; anything omitted
  becomes unplaced (still listed in unplaced_bins, still holding its items).
- Coordinates are zero-based cells counted from the front-left corner of the container:
  x grows to the right, y grows away from the front. A 5x8 drawer therefore spans x 0-4 and
  y 0-7.
- w and h are the bin's own footprint in cells. rotation is 0 (portrait) or 90 (landscape);
  landscape swaps the effective footprint, so a 1x2 bin occupies 2 cells across and 1 deep.
  The UI toggles a selected bin between the two.
- Overlaps, footprints outside the grid and locations that are not children of the container
  are rejected (409 or 400). Shrinking a grid that would leave a bin hanging over the edge is
  rejected too.
- One bin may hold several different items. Record the position inside the bin with an item
  custom field ({"slot": 2}) rather than creating a location per compartment.
- Items sitting directly in the container, not in any bin, come back as loose_items. Put one
  away with POST /items/move ({"item_ids":["..."],"to_location_id":"<bin-id>"}); the map screen
  does the same thing with one click per item once a bin is selected.
- Bins are ordinary locations, so they keep their items, photos and history wherever they
  are placed; moving one to another drawer is PATCH /locations/{id} with parent_id.

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

Split stock across locations:
curl -X POST ${base}/items/<id>/transfer \\
  -H 'Content-Type: application/json' \\
  -d '{"from_location_id":"<drawer-a-id>","to_location_id":"<drawer-b-id>","quantity":40}'

Lay out a 5x8 drawer with two bins:
curl -X PATCH ${base}/locations/<drawer-id> \\
  -H 'Content-Type: application/json' \\
  -d '{"grid_cols":5,"grid_rows":8}'
curl -X PUT ${base}/locations/<drawer-id>/layout \\
  -H 'Content-Type: application/json' \\
  -d '{"bins":[{"location_id":"<dimm-bin-id>","x":0,"y":0,"w":2,"h":2},
               {"location_id":"<cap-bin-id>","x":2,"y":0,"w":1,"h":2,"rotation":90}]}'

Install a component in another item, then return it:
curl -X POST ${base}/items/<host-id>/components \\
  -H 'Content-Type: application/json' \\
  -d '{"component_item_id":"<component-id>","quantity":2,"note":"Fitted"}'
curl -X POST ${base}/items/<host-id>/components/<allocation-id>/return \\
  -H 'Content-Type: application/json' \\
  -d '{"quantity":2}'

Upload a manual:
curl -X POST ${base}/attachments \\
  -F 'file=@manual.pdf' -F 'item_id=<id>' -F 'kind=document'

Log a service and attach a receipt:
curl -X POST ${base}/items/<id>/service \\
  -H 'Content-Type: application/json' \\
  -d '{"performed_at":"2026-05-12","notes":"Replaced the probe tips","cost":12.5}'
curl -X POST ${base}/attachments \\
  -F 'file=@receipt.pdf' -F 'service_record_id=<record-id>' -F 'kind=document'

Download and restore a database backup:
curl ${base}/backup -o inventory-backup.db
curl -X POST ${base}/restore -F 'file=@inventory-backup.db'

## Notes
- Quantities are numbers and may be fractional (e.g. 2.5 metres of wire).
- item.quantity is the total across all locations and item.location_id is the primary (largest) lot. GET /items/{id} also returns "stock" (one entry per location) plus "components" (parts installed here) and "assigned_to" (hosts this item is installed in).
- Transfers keep the total unchanged and are recorded in the movement history with the source and destination locations.
- A drawer map is layout only: placing, turning or moving a bin never changes any quantity. Bins hold items through the ordinary location field, so item.location_id is the bin.
- low_stock is true when min_quantity > 0 and quantity <= min_quantity.
- item.category_icon and item.category_image_url are display fallbacks from the managed category. Use category_image_url first, then category_icon, when the item has no photo.
- service_due is true when service_next_due is today or in the past. Logging a service on an item with service_interval_months advances service_next_due from the latest record date.
- When the instance has a Home Assistant calendar configured, the next due date is kept as an all-day calendar event automatically. No extra API call is needed.
- ha_enabled controls whether an item or location is published to Home Assistant with MQTT discovery. New items and locations default to false. Turning off a location hides it and its sublocations, but items published individually stay visible and are grouped with the nearest published location (or the Inventory hub).
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
