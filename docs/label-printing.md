# Label printing — design notes

Status: **not started**. These are the decisions and constraints gathered while planning
QR labels for drawers, shelves and items. Written up so the thinking is not lost between
bursts of work.

Date of notes: November 2026, against Inventory 1.5.0.

## Goal

Print durable labels that a phone can scan to jump straight to a location or item:

1. **Drawer label** — `Draw Unit #2 / Drawer B` plus a QR code.
2. **Shelf / cabinet label** — location name plus QR.
3. **Item label** — name, SKU, quantity plus QR (optional; drawers matter more).

Batch printing is the point: labelling 39 drawers must be one job, not 39.

## Hardware

- **Printer:** DYMO LabelWriter 400. USB only — no Ethernet, no Wi-Fi. Vendor-specific
  USB protocol (not the standard USB printer class), 672-dot head, 300 dpi.
- **Driver:** `dymo-cups-drivers` (Dymo's open-source CUPS driver, GPL/LGPL) supports the
  LabelWriter 400. On Debian it is the `printer-driver-dymo` package, which ships the CUPS
  filter and the PPDs — no compiling.
- **Placement:** on a rack shelf next to the laser printer, cabled to the always-on
  TrueNAS machine. Rack position was chosen because:
  - the spool and the lid need to be reachable — the wall box has no room for a printer;
  - TrueNAS is the only machine always on (other servers are powered up on demand for
    power-cost reasons), and it already serves the laser printer;
  - it avoids buying and powering a separate always-on print node.

## Topology

```
HAOS add-on (inventory UI + label PDF)  →  IPP  →  TrueNAS CUPS container  →  USB  →  LW 400
```

- `PRINTER_URI=ipp://truenas.local:631/printers/lw400` is configuration, not code, so the
  printer can move later without touching the app.
- The add-on image gains **only** a client (`cups-client`, for `lp -h truenas.local:631`).
  It does **not** gain CUPS itself, so `config.yaml` needs no `usb: true`.
- **Printing must never block inventory writes.** If TrueNAS is rebooting, saving an item
  must still succeed and the print should fail visibly on its own.

## TrueNAS specifics

- Custom Docker app from a small Debian image:

  ```dockerfile
  FROM debian:bookworm-slim
  RUN apt-get update && apt-get install -y --no-install-recommends \
        cups cups-filters cups-client printer-driver-dymo \
      && rm -rf /var/lib/apt/lists/*
  # cupsd.conf: Listen 0.0.0.0:631 and Allow @LOCAL
  EXPOSE 631
  CMD ["/usr/sbin/cupsd", "-f"]
  ```

- Map the **whole** `/dev/bus/usb` directory, never a pinned `/dev/bus/usb/001/004` path.
  Device numbers change on replug and reboot; pinned paths are the most common cause of
  "printing stopped working".
- Try unprivileged first; add `privileged: true` only if the device cannot be found.
- A wedged device needs a container restart, not a host reboot.
- Major TrueNAS upgrades can drop the `devices:` stanza — re-check printing afterwards.

## Options considered and rejected

| Option | Why not |
| --- | --- |
| USB passthrough into the HAOS VM | Fragile; CUPS on the host plus IPP avoids it entirely. |
| CUPS inside the inventory add-on | Bloats the image and ties the printer to whichever machine runs HAOS. |
| ESP32-C6 as a USB bridge | **Impossible** — the C6 has only a USB Serial/JTAG device controller, no host mode. |
| ESP32-S3 as a USB bridge | Technically possible (USB-OTG host) but means writing the Dymo protocol, a rasteriser and a network transport: weeks of firmware. |
| Pi Zero W | ARMv6, 512 MB, and a single micro-USB OTG port, so power and printer contend for one connector. |
| Pico W | RP2040 *does* support USB host, so it is a real candidate — but still a firmware project. |
| Update 89 mm × 36 mm labels by hand | No. |

## Label rendering plan

- Generate **PDF** server-side: base-14 Helvetica needs no font embedding, and the QR is
  drawn as plain vector rectangles. No image rasterising, no headless browser.
- A template is a small JSON list of elements (text with tokens, QR, rules) plus a label
  size in millimetres. Tokens: `{location.path_label}`, `{location.name}`, `{item.sku}`,
  `{item.quantity}`.
- Live preview at exact pixel dimensions before printing.
- Phased delivery:
  1. `GET /api/v1/locations/{id}/label.pdf` + a print button on the location page.
  2. Designer UI for arbitrary text/tokens.
  3. Item labels and batch print from the item list.

## Prerequisite: a stable QR target

`public_url` is currently empty. Before the first print run it must be set to something
durable — `inventory.local` via mDNS, or a DNS record — **not** an IP address. Any DHCP
change otherwise invalidates every printed label at once. Ingress URLs are unusable in a
QR because they contain a per-installation token.

A ~15 mm QR needs a short URL; longer hostnames force a larger symbol.

## Open questions

- Which label cassettes exist for the LW 400? Templates are defined per physical size
  (28 × 89 mm address versus 54 × 101 mm shipping change the layout grid).
- Should item labels include the quantity, given it changes?
- Do drawer labels encode the location, or the location's item list?
- Is the print bridge part of this add-on's documentation, or its own note once built?

## Verified facts to avoid re-researching

- HA apps support `usb: true` (maps `/dev/bus/usb` with hotplug) and `udev: true`.
- Debian ships `printer-driver-dymo`; the `dymo-cups-drivers` upstream is at
  `github.com/matthiasbock/dymo-cups-drivers` with patches for modern CUPS.
- The LabelWriter 400's USB interface is vendor-specific, so generic USB print servers
  and the standard printer class do not apply.
