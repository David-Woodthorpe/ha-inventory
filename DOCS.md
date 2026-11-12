# Inventory Home Assistant add-on

This repository is also a Home Assistant add-on repository. The add-on runs the
same SvelteKit server as the Docker image, stores its SQLite database and
uploads in the add-on's private `/data` directory, and is available from the
Home Assistant sidebar through ingress.

## Installation

1. In Home Assistant, go to **Settings → Add-ons → Add-on store**.
2. Open the three-dot menu, choose **Repositories**, and add the URL of this
   repository (the Git URL or local folder that contains `repository.yaml`).
3. Install **Inventory** and start it.
4. Turn on **Show in sidebar** on the add-on page, or use **Open Web UI**.

The first start creates an empty database. To load the demo workshop, open a
terminal in the add-on container and run:

```sh
INVENTORY_BASE_URL=http://localhost:3000 node scripts/seed.mjs
```

If you have set an API key, add `INVENTORY_API_KEY=<key>` to that command. The
seed script is idempotent, so it is safe to run again.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `api_key` | *(empty)* | Protect `/api/v1/*` with `Authorization: Bearer <key>` or `X-Api-Key: <key>`. The UI, `/media/*` and `/api/v1/health` stay available. |
| `default_currency` | `GBP` | ISO 4217 currency code used for new items. |
| `enable_pricing` | `true` | Set to `false` to hide price, currency and inventory-value fields in the UI and API. Stored prices are kept and reappear if re-enabled. |
| `max_upload_mb` | `50` | Maximum size of a single upload or database restore. |
| `public_url` | *(empty)* | Stable public URL of the app, used in `/llms.txt` and the API docs. Leave empty when using ingress. |
| `enable_mqtt` | `true` | Publish locations and items to Home Assistant with MQTT discovery. |
| `mqtt_discovery_prefix` | `homeassistant` | Home Assistant discovery prefix. |
| `mqtt_topic_prefix` | `inventory` | Prefix for the app's state and availability topics. |

Changing an option restarts the add-on.

## Ingress and direct access

Ingress is enabled by default, so no port is exposed and Home Assistant handles
authentication. The app detects the changing ingress prefix from
`X-Ingress-Path` and keeps links, redirects, uploads and media inside the
ingress session.

If Home Assistant is behind a TLS-terminating reverse proxy, the app reconciles
a missing or incorrect forwarded scheme with the browser's `Origin` header when
the host matches. It checks the forwarded host, the browser's `Host` header and,
for requests arriving through ingress, the browser's `Sec-Fetch-Site:
same-origin` signal. The ingress panel runs in a sandboxed iframe, so form posts
arrive with an opaque `Origin: null`; those are resolved to the forwarded origin
as well. This keeps same-origin form submissions, such as adding an item or
location, working even when a proxy rewrites the host headers. Every form
submission is logged with its response status and the forwarded headers, so a
remaining 403 can be diagnosed from the add-on log.

For API clients that cannot use ingress, enable the optional `3000/tcp` port on
the add-on page. The API is then reachable at
`http://<home-assistant-host>:3000/api/v1`. Set `api_key` before enabling direct
access if the host is reachable by anyone else.

When the app is behind ingress, set `public_url` only if you also publish it at
a stable address. Ingress URLs contain a per-installation token and are not
suitable for `/llms.txt`.

## Home Assistant MQTT discovery

Locations and items can be published to Home Assistant as MQTT devices, so they
appear alongside the rest of your smart-home entities and can be used in
dashboards and automations.

### Setup

1. Install the **Mosquitto broker** add-on.
2. Add the **MQTT** integration under **Settings → Devices & services** (Home
   Assistant usually offers it automatically once Mosquitto is running).
3. Make sure `enable_mqtt` is on (the default) and restart Inventory if you have
   just installed the broker.

The add-on declares `services: [mqtt:want]`, so the Supervisor gives it the
broker address and credentials automatically. Nothing needs to be copied into
the add-on options. If MQTT is not installed, the add-on still starts normally
and discovery stays off.

For a plain Docker install, set `MQTT_HOST` to the broker's LAN address and
optionally `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_SSL` and `MQTT_PORT`. Use the
host's LAN IP rather than `localhost`, because `localhost` inside the container
is the container itself. Set `MQTT_ENABLED=false` to disable discovery.

### Choosing what to publish

Publishing is opt-in. New items and locations start unpublished, while items and
locations that already existed before upgrading stay published. Use the
**Publish this item/location to Home Assistant** checkbox on the edit form, or
the **Publish to Home Assistant** button on the detail page.

- Turning off an item removes only that item.
- Turning off a location removes the location, its sublocations and every item
  inside it. Re-enabling it restores them, subject to their own settings.
- A child location stays hidden while any parent location is unpublished.
- The hub totals, low-stock counts and Contents tables only include published
  items.

### Entities

| Device | Entities | Details |
| --- | --- | --- |
| **Inventory** (hub) | **Items** sensor, **Low stock items** sensor, **Low stock alert** binary sensor | Totals across the published inventory. The alert sensor is `problem` when anything published is low. |
| Each **location** | **Contents** sensor, **Low stock** binary sensor | The sensor state is the number of published items in the location *and its sublocations*. Its attributes contain the item list and a Markdown table. The binary sensor is `problem` when any published item below it is low. |
| Each **item** | **Quantity** sensor, **Low stock** binary sensor | The quantity sensor uses the item's unit and includes SKU, category, location and threshold as attributes. The low-stock binary sensor is `problem` when `quantity <= min_quantity` and `min_quantity > 0`. |

Locations and items are linked with MQTT `via_device`, so the device page shows
which shelf or drawer an item belongs to. The top-level location name is used as
`suggested_area`: Home Assistant suggests that area when it first creates a
device. This gives you room association without any extra configuration, while
still letting you move devices between areas manually.

The **Contents** sensor attributes are:

- `item_count`, `direct_item_count`, `total_quantity`, `low_stock`
- `child_locations` — `[{ id, name }]`
- `items` — `[{ name, sku, category, quantity, unit, min_quantity, low_stock, location, location_id, updated_at }]`
- `contents` — a Markdown table ready for a Markdown card

Example dashboard card:

```yaml
type: markdown
title: Workshop / Shelf A
content: >-
  {{ state_attr('sensor.workshop_shelf_a_contents', 'contents') }}
```

Example automation trigger:

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.10k_resistor_low_stock
    to: "on"
actions:
  - action: notify.notify
    data:
      message: >-
        10k resistor is low:
        {{ states('sensor.10k_resistor_quantity') }} left.
```

Entity IDs come from the device and entity names. Search for `contents`,
`quantity` or `low_stock` under **Developer tools → States** if a name differs.

### Behaviour and cleanup

- Discovery configs and state are published with the MQTT retain flag, so Home
  Assistant restores entities after a restart.
- A retained last-will message (`inventory/status` → `offline`) marks all
  entities unavailable when the add-on stops.
- Deleting an item or location clears its retained discovery config and state,
  including after an app restart. The list of published topics is kept in
  `/data/mqtt-discovery-topics.json`.
- MQTT discovery must be enabled in the Home Assistant MQTT integration (it is
  by default). If you use a non-default discovery prefix, set
  `mqtt_discovery_prefix` to match.
- Renaming a device or entity in Home Assistant only changes the Home Assistant
  side; the next sync keeps the app's names.
- If you change the broker or install MQTT after Inventory has started, restart
  the add-on so it can read the new service details.

## Data, backups and restore

Everything persistent lives in `/data`:

```
/data/
├── inventory.db      # SQLite database (plus -wal / -shm while running)
├── uploads/          # attachment files
└── options.json      # written by the Supervisor
```

The add-on uses `backup: cold`, so Home Assistant stops it before taking a
backup. This makes the SQLite copy consistent. Restore through the normal
Home Assistant backup flow; no separate export is needed.

For an independent database snapshot, use **System → Backup & restore** in the
sidebar or the API:

```sh
# Download a consistent SQLite snapshot
curl -H "Authorization: Bearer $INVENTORY_API_KEY" \
  http://<host>:3000/api/v1/backup -o inventory-backup.db

# Restore it (destructive)
curl -X POST -H "Authorization: Bearer $INVENTORY_API_KEY" \
  -F 'file=@inventory-backup.db' \
  http://<host>:3000/api/v1/restore
```

Restore validates the file with SQLite integrity, schema-version and foreign-key
checks, and keeps the previous database if the new one cannot be opened.
Backups from a newer add-on version are rejected.

Database backups contain items, locations, attachment metadata and stock
history. Uploaded files are **not** included, so also copy `/data/uploads` if
you need them. The JSON export endpoint (`/api/v1/export`) is a separate
human-readable export and does not include binary files either.

## API

Base URL with ingress: use the ingress URL shown by Home Assistant. With the
optional direct port: `http://<home-assistant-host>:3000/api/v1`.

- `/api` — interactive API documentation.
- `/api/v1/openapi.json` — OpenAPI schema.
- `/llms.txt` — compact guide for AI assistants.
- `/api/v1/health` — liveness check, always unauthenticated.
- `/api/v1/backup` and `/api/v1/restore` — database snapshot and restore.

See the main [README](README.md) for the full endpoint list and examples.
