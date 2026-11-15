# Changelog

Release notes for the Inventory Home Assistant add-on. Home Assistant shows this
file on the add-on page, so keep entries user-facing: what changed and what it
means for someone using the app, not file names.

## 1.6.0 — 2026-11-15

- **Batch move between locations.** Tick several items on the Items page, choose a
  destination, and move them all at once. Useful when rearranging drawers, shelves
  or bins: quantities are unchanged and every move is recorded in the item's history.
  Also available as `POST /api/v1/items/move`, which reports partial success with
  HTTP 207 when some items could not be moved.
- **Fixed stock consolidation.** Moving an item to a location that already held its
  largest lot used to leave the remaining lots behind. A move now always merges every
  lot into the destination, which also fixes the same case when editing an item's
  location.
- **Documentation for AI assistants.** Added `AGENTS.md`, a checklist of documents
  that must be updated alongside code changes, and `docs/label-printing.md`, design
  notes for QR label printing.

## 1.5.0 — 2026-11-14

- **Managed categories.** Create, rename and delete categories in one place. Each
  category can have a built-in icon or an uploaded image, and items without a photo
  fall back to their category artwork.
- Renaming a category updates every item in it; deleting one keeps the items and
  clears their category.

## 1.4.0 — 2026-11-14

- **Multi-location stock.** One item can hold stock in several locations at once.
  Transfer part of the quantity between locations without changing the total, and
  see per-location stock lots on the item page.
- **Installed components.** Sign a part out to another item, such as RAM fitted to a
  computer. The component's stock is removed immediately and can be returned, wholly
  or partly, to the location it came from.

## 1.3.0 — 2026-11-14

- **Service history.** Log maintenance per item with a date, notes, an optional cost
  and receipt or document uploads.
- **Recurring service schedule.** Set an interval in months and a next due date;
  logging a service advances the due date. An optional Home Assistant local calendar
  can hold the next due date as an all-day event.

## 1.2.0 — 2026-11-12

- **Rapid repeat entry.** **Save and add another** copies the current item, clears and
  focuses the SKU, and keeps the rest of the form ready, so a barcode scanner can fill
  a stack of similar parts without touching the mouse.

## 1.1.1 — 2026-11-12

- Removed the location-level low-stock binary sensor. Item-level low-stock sensors and
  the hub-wide alert remain, which avoids duplicate alerts for the same item.

## 1.1.0 — 2026-11-12

- Item entities are grouped under their nearest published **location** device instead
  of creating one device per item, so a room stays a single device in Home Assistant.

## 1.0.9 — 2026-11-12

- Items published individually stay visible when their location is unpublished, so
  important low-stock items can still be monitored.

## 1.0.8 — 2026-11-12

- Publishing to Home Assistant is opt-in per item and per location. New items and
  locations start unpublished; existing ones stay published.

## 1.0.x — 2026-11-10 to 2026-11-11

- Backup and restore of the SQLite database, with validation and rollback.
- Home Assistant MQTT discovery for locations and items, including contents tables and
  low-stock triggers.
- Location pages list items in their sublocations.
- Fixes for CSRF and origin handling behind Home Assistant ingress.

## 1.0.0 — 2026-11-10

- First release: items, nested locations, categories, tags, custom fields, photos and
  documents, stock movements, search, and a JSON REST API with an `/llms.txt` guide for
  AI assistants.
