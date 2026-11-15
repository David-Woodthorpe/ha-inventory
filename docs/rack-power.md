# Rack power in the Home Assistant dashboard — design notes

Status: **not started**. These are the decisions gathered while planning live power and
energy for the server cabinet. Written up so the thinking is not lost between bursts of
work.

Date of notes: November 2026, against Inventory 1.14.0.

## Goal

See what the cabinet is drawing, device by device and in total, on the Home Assistant
dashboard — next to a picture of the rack so a hot slot has a name.

**The split of responsibility is deliberate:**

- **Inventory** owns the catalogue: what is in the cabinet, which slot it occupies, what is
  fitted into it. It already does this (`GET /api/v1/locations/{id}/rack`).
- **Home Assistant** owns telemetry: watts, kilowatt-hours, temperatures. It already does
  this well, with history it did not have to write.
- **The dashboard card** joins the two in the browser.

The add-on does **not** poll Home Assistant, store power, or draw graphs. See "Options
considered and rejected".

```
smart plugs / CT clamps ──► HA recorder ──┐
                                          ├──► Lovelace card ──► dashboard
Inventory DB ──► /api/v1/locations/{id}/rack ─┘
```

## Prerequisite: CORS on the API

The card runs on Home Assistant's origin and fetches the inventory API from the browser.
As of 1.14.0 the API sends **no CORS headers**, so that request is blocked before it
leaves the browser. This is the one change the add-on genuinely needs.

- New option `ALLOWED_ORIGINS` (env `ALLOWED_ORIGINS`), comma-separated, default empty.
- Applied to `GET`/`HEAD` on `/api/v1/*` only, never to writes, and never with credentials.
- `*` should be allowed but documented as "any page on your network can read your
  inventory" — fine on a trusted LAN, not otherwise.
- Per `AGENTS.md`, an option means updating `config.yaml` (`options` + `schema`),
  `DOCS.md`, `.env.example`, and the README "Configuration" table in the same commit.

Without this, the only alternatives are mirroring the rack layout into a `rest` sensor
(see rejected options) or putting both services behind one reverse proxy.

## Entity mapping

The card has to know which entity measures which device. **Use item custom fields** — they
already exist, already round-trip through the API, and already have a key/value editor in
the item form. No schema change, no migration:

```json
"custom_fields": {
  "power_entity": "sensor.rack_shelf1_power",
  "energy_entity": "sensor.rack_shelf1_energy_today",
  "display_entity": "sensor.shelf1_temp"
}
```

- `power_entity` — live watts (W). The card shows this on the slot.
- `energy_entity` — optional, today's kWh. Shown when a slot is selected rather than on
  every block, to avoid a wall of numbers.
- `display_entity` — optional extra (temperature, load, fan RPM) shown beside the slot.

Rules worth keeping:

- **Several items may share one entity.** Redundant PSUs on one lead, or a shelf and its
  drives: the card must tolerate duplicates and mark the block as "shared" rather than
  double-counting the rack total.
- **Promotion path.** If this outgrows a hobby, `power_entity` becomes a real column
  (schema v10) and a field in the item form. Doing that later is a migration; doing it now
  is speculative.
- **A naming convention beats configuration.** `sensor.rack_<device>_power` lets the card
  find entities with almost no YAML, and keeps working when the dashboard is rebuilt.

## The card

A single plain-JS file dropped into HA's `www/` and registered as a dashboard resource. No
build step, no bundler, no dependency beyond what HA already loads.

```yaml
type: custom:inventory-rack-card
title: Server cabinet
location: 1d8f0853-7b18-410f-89fe-51b400564c2a   # or a path label
api: http://192.168.1.201:3000
api_key: !secret inventory_api_key               # only if authentication is enabled
total_power: sensor.rack_total_power
total_energy: sensor.rack_energy_today
refresh: 10                                       # seconds between API fetches
```

Rendering rules, matching the app's rack screen:

- Elevation counted **from the bottom up** (U1 at the foot), blocks sized in U, a U gutter.
- Each block: device name (or its short code at 1U), live W right-aligned.
- Header: total W and today's kWh, plus the free-space count.
- Slots with no measurement show an em dash, never `0 W` — an absent sensor is not zero.
- `unavailable` and `unknown` states are treated as absent, not as zero.
- Colour by load, subtly: a block is normal, warm, or highlighted past a configurable
  threshold. No traffic-light theatrics.

Behaviour that matters more than the visuals:

- **The rack renders even when nothing else works.** Fetch the layout once, cache it in
  `localStorage`, and show stale data with an age indicator rather than an empty card.
- **Do not rebuild on every state update.** HA fires `hass` on every entity change; redraw
  on a timer or on a change to the relevant entities only.
- **Reconcile the two views.** The sum of device watts will be below the rack total by
  5–15% (PSU losses, fans, switches). Show the difference rather than pretending they
  match, and flag a sudden widening — usually a plug that has dropped off.

## Metering plan

The intended hardware is a metering smart plug or current clamp on every power lead, plus
one for the whole cabinet.

- **One plug per shelf covers twelve bays**, so a four-shelf cabinet is roughly: rack total,
  four shelves, the server, and a few small devices — around 8–10 entities.
- **Check inrush ratings.** A 2U server idles near 200 W and pulls 400–600 W loaded, but a
  shelf of twelve drives starting together is the case that trips a marginal 10 A plug.
- **Whole-cabinet metering is not redundant.** It is the figure that stays true when a
  device plug drops off, and it is the one worth putting on the energy dashboard.
- **Daily energy via `utility_meter`.** One helper per rack (and optionally per device)
  turns a power sensor into "today's kWh" as a single state the card can read.
- **Accuracy.** Smart plugs are typically ±1–2%; that is ample for "is this shelf hot?" and
  not enough to bill against.
- **Coverage will be partial.** Some devices share a lead by design; the card must express
  "this block is powered via the shelf's meter" rather than inventing a per-device number.

## Options considered and rejected

| Option | Why not |
| --- | --- |
| Add-on polls HA's REST API and stores power | Duplicates the recorder, needs a long-lived token in the add-on, and adds a poll loop plus failure states for numbers HA already has. |
| Publish power back through MQTT | HA owns the state; round-tripping it through the add-on adds lies to the model. |
| Mirror the rack layout into a `rest` sensor and read its attributes | Dumps a JSON document into sensor attributes, is unreadable in the UI, and polls the API from HA rather than from the viewer. |
| Put power inside the inventory UI | Same token problem, and splits attention from the dashboard where the rest of the house lives. |
| A full HA integration (custom component) | Justified only if this becomes something other people install; a card covers one cabinet. |

## Open questions

- Rack total as its own meter, or summed from device meters with a correction factor?
- Does the card need per-device **energy** (kWh) at all, or is live W plus a rack total
  enough in practice?
- Where does the card live: an example file in this repo, or its own repository with a HACS
  release? It is one file either way.
- Should a slot's detail panel show the *item* (fitted drives, notes) or stay purely
  electrical? The item page already answers the first.
- UPS data — load percentage, runtime on battery — is arguably more useful than watts in a
  power cut. Worth a header line if the UPS is integrated.
- If `power_entity` is promoted to a real column, does it belong on the item, the rack slot,
  or both?

## Verified facts to avoid re-researching

- `GET /api/v1/locations/{id}/rack` returns `units`, `mounts[]` (with `name`, `u_start`,
  `u_height`, `type`, `stored_here`, `fitted_units`) and `used_units`/`free_units`.
- `GET /api/v1/items/{id}` returns `custom_fields`, so an entity id can be stored and read
  without new schema.
- The API sends no CORS headers as of 1.14.0; `src/hooks.server.ts` handles authentication
  and would be the natural place for the allowlist.
- A Lovelace custom card can be a plain `HTMLElement` subclass with a `set hass()` setter;
  no build step is required.
- `recorder/statistics_during_period` is available over the **WebSocket** API only, not
  REST — relevant if daily energy is ever read from statistics rather than a
  `utility_meter`.
