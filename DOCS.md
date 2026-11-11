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
