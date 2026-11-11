# Inventory

A self-hosted inventory for electronics components, electrical parts, tools and workshop supplies.

Built with **SvelteKit 2 / Svelte 5**, **SQLite** (via Node's built-in `node:sqlite`) and no native
dependencies. It has a responsive light/dark UI, nested locations, stock history, photo and document
uploads, and a REST API designed to be used by AI assistants as easily as by scripts.

```
Office
└── Drawer unit 1
    ├── Drawer 1a   → 10kΩ resistors, 100nF capacitors
    └── Drawer 1b   → ATmega328P, LM7805, ESP32 boards
Workshop
├── Shelf A
│   ├── Bin A1    → hook-up wire
│   └── Bin A2    → solder, flux
└── Parts cabinet
    └── Drawer C1 → M3 hardware, heat-shrink
```

## Features

- **Arbitrarily nested locations** — rooms, shelves, drawers, bins; move a branch without breaking it.
- **Items** with quantity, unit, low-stock threshold, SKU, category, tags, supplier, optional price,
  manufacturer, part number, datasheet URL, notes and arbitrary custom fields.
- **Stock movements** — every change is recorded with a reason and note; quick +/- buttons and manual
  adjustments. Quantities may be fractional (metres of wire, grams of paste).
- **Photos and documents** — upload images, datasheets, manuals and receipts to items or locations.
- **Search and filters** — full-text search, category, tag, location (including descendants), low stock.
- **Backup and restore** — download a consistent SQLite snapshot from the UI or API, and restore it with validation and automatic rollback on failure.
- **Home Assistant MQTT discovery** — optional location and item devices with stock levels, contents tables and low-stock triggers.
- **AI-ready REST API** — JSON envelope, UUIDs, pagination, OpenAPI schema and a dedicated `/llms.txt`
  guide written for language models.
- **No build-time database** — one SQLite file plus an uploads directory. Back up by copying `data/`.
- **No login by default** — intended for a trusted LAN; optionally protect the API with a key.

## Requirements

- **Node.js 22.13 or newer** (for the unflagged `node:sqlite` module). Tested with Node 24.
- npm (or another package manager).

For the Docker and Home Assistant add-on workflows below you only need Docker
(or Podman with the Docker CLI) or Home Assistant itself; Node is installed
inside the image.

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The database and uploads directory are created automatically under
`data/`.

To load a realistic demo workshop (18 parts, 13 nested locations, photos and documents):

```bash
# with the dev server still running in another terminal
npm run seed
```

The seed script is idempotent — running it again only adds anything that is missing.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server on port 5173. |
| `npm run build` | Build the production server into `build/`. |
| `npm start` | Run the production build with the runtime wrapper (`node server.js`). |
| `npm run check` | Run `svelte-check` and TypeScript checks. |
| `npm run seed` | Populate a running instance with demo data via the API. |
| `npm run ingress-proxy` | Simulate Home Assistant ingress against the dev server on port 8099. |

## Configuration

Environment variables are read at runtime by the server. During development they can be placed in a
`.env` file (see `.env.example`). **The production server does not load `.env` automatically** — export
the variables in your shell, service manager or container instead.

| Variable | Default | Description |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Directory for `inventory.db` and `uploads/`. |
| `PORT` | `3000` | Port for the production server (`npm start`). |
| `INVENTORY_API_KEY` | *(unset)* | When set, every `/api/v1/*` request needs `Authorization: Bearer <key>` or `X-Api-Key: <key>`. |
| `MAX_UPLOAD_MB` | `50` | Maximum size of a single uploaded file or database restore. |
| `DEFAULT_CURRENCY` | `GBP` | ISO 4217 code used for new items and value totals. |
| `ENABLE_PRICING` | `true` | Set to `false` to hide price, currency and inventory-value fields in the UI and API. Stored prices are kept. |
| `PUBLIC_BASE_URL` | *(unset)* | Stable public URL used in `/llms.txt` and the API docs, for example `https://inventory.example.com`. Do not include `/api/v1`. |
| `ORIGIN` | *(unset)* | Force the public origin (`scheme://host[:port]`) used by SvelteKit. Usually unnecessary because the runtime wrapper derives it from forwarding headers. |
| `MQTT_ENABLED` | *(auto)* | Set to `false` to disable Home Assistant MQTT discovery. When unset, discovery is enabled if a broker is configured. |
| `MQTT_HOST` | *(unset)* | MQTT broker hostname or IP. Setting this enables discovery for plain Docker installs. |
| `MQTT_PORT` | `1883` / `8883` | Broker port. Defaults to `8883` when `MQTT_SSL=true`. |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | *(unset)* | Broker credentials. |
| `MQTT_SSL` | `false` | Connect with TLS (`mqtts://`). |
| `MQTT_DISCOVERY_PREFIX` | `homeassistant` | Home Assistant discovery prefix. |
| `MQTT_TOPIC_PREFIX` | `inventory` | Prefix for the app's state and availability topics. |

`server.js` also sets adapter-node's `BODY_SIZE_LIMIT` from `MAX_UPLOAD_MB`, so
uploads larger than adapter-node's 512 KB default work out of the box. Set
`BODY_SIZE_LIMIT` yourself if you need a different limit.

`INVENTORY_API_KEY` protects the API only. The web UI, `/llms.txt` and `/media/*` remain open so that
images load in the browser. Put the app behind a reverse proxy with authentication if it is exposed to
the internet.

Set `ENABLE_PRICING=false` to run the inventory without money tracking. The UI hides unit price,
currency, the value column, the value sort option and the inventory-value total; the API returns `null`
for `price` and `total_value` and ignores `price`/`currency` on writes. Existing prices remain in the
database and reappear if you set it back to `true`.

## Production deployment

The production build uses `server.js`, a small wrapper around adapter-node. It
sets adapter-node's body limit from `MAX_UPLOAD_MB` and derives the request
origin from `X-Forwarded-Proto`/`X-Forwarded-Host`, so same-origin form posts
work both directly and behind Home Assistant ingress or a reverse proxy. If a
proxy terminates TLS without forwarding the original scheme, the wrapper takes
the scheme from the browser's `Origin` header when the host matches, preventing
false 403 CSRF failures on form submissions.

### Manual / systemd

```bash
npm ci
npm run build

DATA_DIR=/var/lib/inventory \
PORT=3000 \
INVENTORY_API_KEY='a-long-random-string' \
npm start
```

A minimal systemd unit:

```ini
[Unit]
Description=Inventory
After=network.target

[Service]
Type=simple
User=inventory
WorkingDirectory=/opt/inventory
Environment=DATA_DIR=/var/lib/inventory
Environment=PORT=3000
Environment=INVENTORY_API_KEY=replace-me
ExecStart=/usr/bin/node /opt/inventory/server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

If you put nginx, Caddy or Traefik in front, proxy to `127.0.0.1:3000`, set the
upload body limit to at least `MAX_UPLOAD_MB`, and pass
`X-Forwarded-Proto`/`X-Forwarded-Host` (most proxies do this by default). When
TLS terminates at the proxy, make sure `X-Forwarded-Proto` is `https`; the app
also falls back to the browser's `Origin` when the host matches. Set
`PUBLIC_BASE_URL` so `/llms.txt` and the API docs advertise the public address.

### Docker

Build and start with Compose:

```bash
docker compose up -d --build
```

Open <http://localhost:3000>. Data is stored in the `inventory-data` named
volume, so rebuilding or recreating the container keeps the database and
uploads.

Without Compose:

```bash
docker build -t inventory .
docker run -d --name inventory --restart unless-stopped \
  -p 3000:3000 -v inventory-data:/data inventory
```

Add `-e INVENTORY_API_KEY=...`, `-e MAX_UPLOAD_MB=...` and similar flags to pass
configuration.

Configuration is read from the environment; create a `.env` file next to
`compose.yaml` (start from `.env.example`) or export variables before
`docker compose up`:

```dotenv
INVENTORY_API_KEY=replace-with-a-long-random-string
MAX_UPLOAD_MB=100
DEFAULT_CURRENCY=GBP
ENABLE_PRICING=true
PUBLIC_BASE_URL=https://inventory.example.com
# Optional Home Assistant MQTT discovery
MQTT_HOST=192.168.1.10
MQTT_USERNAME=inventory
MQTT_PASSWORD=replace-me
```

Useful commands:

```bash
docker compose logs -f
# load the demo workshop (uses port 3000 inside the container)
docker compose exec -e INVENTORY_BASE_URL=http://localhost:3000 \
  inventory node scripts/seed.mjs
docker compose down                                    # keep data
docker compose down -v                                 # delete data too
```

If you set `INVENTORY_API_KEY`, pass it to the seed command too:
`-e INVENTORY_API_KEY=<key>`.

To use a host directory instead of the named volume, replace the volume line in
`compose.yaml`:

```yaml
volumes:
  - ./data:/data
```

The container starts as root only to make `/data` writable, then runs the
server as the unprivileged `node` user.

### Home Assistant add-on

The repository root is also a Home Assistant add-on repository (`repository.yaml`
and `config.yaml`). The add-on builds the same `Dockerfile`, stores everything
in `/data`, and is reachable through ingress in the sidebar.

1. **Settings → Add-ons → Add-on store → ⋮ → Repositories**, add this
   repository's URL.
2. Install **Inventory**, then start it.
3. Enable **Show in sidebar** or use **Open Web UI**.

Add-on options:

| Option | Default | Description |
| --- | --- | --- |
| `api_key` | *(empty)* | Require `Authorization: Bearer <key>` (or `X-Api-Key`) on `/api/v1/*`. |
| `default_currency` | `GBP` | Default ISO 4217 currency for new items. |
| `enable_pricing` | `true` | Set to `false` to hide price, currency and inventory-value fields. Stored prices are kept. |
| `max_upload_mb` | `50` | Maximum size of a single upload. |
| `public_url` | *(empty)* | Stable public URL used in `/llms.txt` and the API docs. Leave empty for ingress. |
| `enable_mqtt` | `true` | Publish locations and items to Home Assistant with MQTT discovery. Requires the Mosquitto broker add-on and the MQTT integration. |
| `mqtt_discovery_prefix` | `homeassistant` | Discovery prefix. Change only if your Home Assistant MQTT integration uses a custom prefix. |
| `mqtt_topic_prefix` | `inventory` | Prefix for the app's state and availability topics. |

Ingress needs no exposed port and Home Assistant handles authentication. For
API clients that cannot use ingress, enable the optional `3000/tcp` port on the
add-on page; the API is then at `http://<home-assistant-host>:3000/api/v1`. Set
`api_key` before exposing it.

#### Home Assistant MQTT discovery

Inventory can expose its locations and items as Home Assistant devices. Install
the **Mosquitto broker** add-on and add the **MQTT** integration under
**Settings → Devices & services** first. The Inventory add-on requests access to
the Supervisor's MQTT service, so no broker address or credentials are needed.

What appears in Home Assistant:

- An **Inventory** hub device with the total item count, total units, low-stock
  count and a **Low stock alert** binary sensor.
- One device per **location**, named with its full path (for example
  `Workshop / Shelf A`). Its **Contents** sensor state is the number of items in
  that location and all sublocations. Attributes include `items` (a list of
  name, quantity, unit, SKU, location and low-stock flag), `contents` (a
  ready-made Markdown table) and `child_locations`. A **Low stock** binary
  sensor turns on when any item below it needs restocking.
- One device per **item**, with a **Quantity** sensor and a **Low stock** binary
  sensor (`device_class: problem`) that can trigger automations.
- Devices are connected in a hierarchy with `via_device`, and the top-level
  location name is used as `suggested_area`. Home Assistant suggests that room
  when the device is first created; you can then move devices between areas
  freely.

Show a location's contents in a dashboard with a Markdown card:

```yaml
type: markdown
title: Workshop / Shelf A
content: >-
  {{ state_attr('sensor.workshop_shelf_a_contents', 'contents') }}
```

The exact entity ID is derived from the device name; check
**Developer tools → States** and search for `contents` or `low_stock`.

For plain Docker, set `MQTT_HOST` (and `MQTT_USERNAME`/`MQTT_PASSWORD` if
needed) in `.env`; the app connects on startup. Use the broker's LAN address,
not `localhost`, because the container cannot reach the host loopback. Set
`MQTT_ENABLED=false` to turn discovery off.

Discovery messages and state are retained, so entities survive restarts, and
the app publishes an MQTT last-will message that marks them unavailable when it
stops. Deleting an item or location removes its retained discovery config.
If you install or reconfigure the MQTT broker after starting the add-on, restart
Inventory so it can read the new service details.

Home Assistant snapshots stop the add-on first (`backup: cold`) so the SQLite
database is copied consistently. See [DOCS.md](DOCS.md) for add-on-specific
details.

### Backups

Open **System → Backup & restore** in the sidebar (or `/backup`) to download a consistent snapshot of the
SQLite database and to restore one. The download uses SQLite's `VACUUM INTO`, so it is safe while the app
is running.

The same operations are available over the API:

```bash
# Download a snapshot
curl -H "Authorization: Bearer $INVENTORY_API_KEY" \
  http://localhost:3000/api/v1/backup -o inventory-backup.db

# Replace the database with a snapshot (destructive)
curl -X POST -H "Authorization: Bearer $INVENTORY_API_KEY" \
  -F 'file=@inventory-backup.db' \
  http://localhost:3000/api/v1/restore
```

Restore validates the uploaded file with SQLite integrity, schema-version and foreign-key checks. If the
new database cannot be opened, the previous database is restored automatically. Backups from a newer
schema version are rejected.

Database backups contain items, locations, attachment metadata and stock history. Uploaded files live
in `data/uploads` and are **not** included, so copy that directory separately.

Everything lives in `DATA_DIR`:

```
data/
├── inventory.db      # SQLite database (plus -wal / -shm while running)
└── uploads/          # attachment files
```

You can also stop the service and copy the whole directory, or use SQLite's online backup:

```bash
sqlite3 data/inventory.db ".backup '/backups/inventory-$(date +%F).db'"
rsync -a data/uploads/ /backups/uploads/
```

With Docker, stop the container before copying the volume so the SQLite files
are consistent:

```bash
docker compose stop
docker compose cp inventory:/data "./backups/data-$(date +%F)"
docker compose start
```

Home Assistant backups include `/data` automatically and stop the add-on first.

## REST API

Base URL: `http://<host>:<port>/api/v1`

Interactive documentation is built into the app at **`/api`**. The machine-readable schema is at
`/api/v1/openapi.json`, and `/llms.txt` is a compact guide intended to be pasted into an AI assistant's
context.

### Authentication

When `INVENTORY_API_KEY` is set, send one of:

```http
Authorization: Bearer <key>
X-Api-Key: <key>
```

Requests without a valid key receive `401` with a JSON error body.

### Response envelope

```json
// success
{ "data": { "id": "…", "name": "10k resistor" } }

// list
{
  "data": [ … ],
  "pagination": { "total": 42, "limit": 50, "offset": 0, "has_more": false }
}

// failure
{
  "error": {
    "code": "validation_error",
    "message": "Some fields are invalid",
    "details": [{ "field": "name", "message": "Required" }]
  }
}
```

Status codes are meaningful: `200`/`201` success, `204` deleted, `207` partial bulk success, `400`
validation, `401` unauthorized, `404` missing, `409` conflict, `413` too large.

When `ENABLE_PRICING=false`, item responses set `price` and `total_value` to `null`, `/meta` returns an
empty `currencies` list, and `price`/`currency` fields on create or update requests are ignored.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness check. |
| `GET` | `/meta` | Stats, locations, categories, tags, units, currencies. |
| `GET` | `/items` | List/search. Query: `q`, `category`, `tag`, `location_id`, `include_descendants`, `low_stock`, `include_archived`, `sort`, `order`, `limit`, `offset`. |
| `POST` | `/items` | Create an item. Only `name` is required. |
| `POST` | `/items/bulk` | Create up to 500 items; partial success returns `207`. |
| `GET` | `/items/{id}` | Item detail, including attachments and location. |
| `PATCH` | `/items/{id}` | Partial update. |
| `DELETE` | `/items/{id}` | Delete an item, its movements and files. |
| `POST` | `/items/{id}/stock` | Adjust stock with `{"delta": -2}` or `{"set": 10}`, plus optional `reason`/`note`. |
| `GET` | `/items/{id}/movements` | Stock movement history. |
| `GET` | `/locations` | Flat list; add `?tree=true` for a nested tree. |
| `POST` | `/locations` | Create a location, optionally with `parent_id`. |
| `GET` | `/locations/{id}` | Location, children and breadcrumb. |
| `PATCH` | `/locations/{id}` | Rename or move a location. |
| `DELETE` | `/locations/{id}` | Delete only when empty (`409` otherwise). |
| `GET` | `/attachments` | Filter with `item_id` or `location_id`. |
| `POST` | `/attachments` | `multipart/form-data` upload. |
| `GET` | `/attachments/{id}` | Attachment metadata. |
| `GET` | `/attachments/{id}/file` | View/download the file. |
| `DELETE` | `/attachments/{id}` | Delete metadata and file. |
| `GET` | `/search?q=` | Search items and locations together. |
| `GET` | `/export` | Download the entire inventory as JSON. |
| `GET` | `/backup` | Download a consistent SQLite database snapshot. |
| `POST` | `/restore` | Replace the database from a snapshot (`multipart/form-data`, `file` field). Destructive. |

### Examples

```bash
BASE=http://localhost:3000/api/v1

# Inspect the existing taxonomy and locations
curl "$BASE/meta"

# Create a nested location
curl -X POST "$BASE/locations" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Drawer 1a","parent_id":"<drawer-unit-id>"}'

# Add a component
curl -X POST "$BASE/items" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "10kΩ resistor 0.25W",
    "sku": "RES-10K-025",
    "category": "Resistors",
    "quantity": 240,
    "unit": "pcs",
    "min_quantity": 50,
    "location_id": "<drawer-1a-id>",
    "tags": ["through-hole", "10k"],
    "custom_fields": { "tolerance": "5%" }
  }'

# Adjust stock
curl -X POST "$BASE/items/<item-id>/stock" \
  -H 'Content-Type: application/json' \
  -d '{"delta":-5,"reason":"used","note":"Prototype build"}'

# Upload a datasheet
curl -X POST "$BASE/attachments" \
  -F 'file=@datasheet.pdf' \
  -F 'item_id=<item-id>' \
  -F 'kind=document' \
  -F 'caption=Manufacturer datasheet'
```

### Using it with an AI assistant

Give the assistant the API base URL and the contents of `/llms.txt`. A useful prompt:

> You are managing my electronics inventory at `http://localhost:3000/api/v1`. Read `/llms.txt` first,
> then call `GET /meta` before creating anything. Use existing locations, categories and tags where
> possible, and adjust stock through `/items/{id}/stock` rather than editing quantities directly.

The API is deliberately predictable: stable UUIDs, `{ "data": … }` envelopes, pagination metadata and
validation errors that name the offending field.

## Project layout

```
src/
├── app.css                    Design system, themes and responsive layout
├── hooks.server.ts            API-key auth, security headers and MQTT startup
├── lib/
│   ├── components/            Icon, forms, location picker, upload form
│   ├── server/                SQLite, services, validation, OpenAPI spec
│   └── types.ts               Shared item/location/attachment types
└── routes/
    ├── +page.*                Dashboard
    ├── items/                 List, detail, create, edit
    ├── locations/             Tree, detail, create, edit
    ├── api/                   Human/AI developer documentation
    ├── api/v1/                REST endpoints
    ├── backup/                Backup and restore UI
    ├── media/[id]/            UI-facing attachment stream
    └── llms.txt/              AI-oriented API guide
scripts/seed.mjs               Demo data loader (uses the public API)
scripts/ingress-proxy.mjs      Local Home Assistant ingress simulator
server.js                      Production runtime wrapper around adapter-node
Dockerfile                     Multi-stage image for Docker and the HA add-on
compose.yaml                   Docker Compose service with a persistent volume
docker-entrypoint.sh           Prepares /data and drops to the node user
repository.yaml, config.yaml   Home Assistant add-on repository metadata
DOCS.md                        Home Assistant add-on documentation
data/                          SQLite database and uploads (gitignored)
```

The database schema is migrated automatically on startup from `src/lib/server/db.ts`. New migrations
are appended to the `migrations` array; applied versions are tracked in `schema_migrations`.

## Development notes

```bash
npm run check    # type-check Svelte components and TypeScript
npm run build    # verify the production build
```

To test the Home Assistant ingress behaviour locally, run the dev server and the
proxy in separate terminals:

```bash
npm run dev
npm run ingress-proxy
# open http://localhost:8099/api/hassio_ingress/local-test/
```

Set `TARGET=http://127.0.0.1:3000` to point the proxy at a production build
instead of the dev server. Set `INGRESS_FORWARDED_PROTO=https` to simulate a
TLS-terminating reverse proxy that reports the request as `http`, and
`INGRESS_FORWARDED_HOST=inventory:3000` to simulate an internal forwarded host.

The UI is intentionally dependency-free: hand-written CSS in `src/app.css`, inline SVG icons, Svelte 5
runes and progressive-enhancement form actions. The API and the UI share the same server services, so a
change in `src/lib/server/items.ts` affects both.

## License

Private project. Add a licence of your choice before distributing.
