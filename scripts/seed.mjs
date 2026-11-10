#!/usr/bin/env node
/**
 * Populate a running Inventory instance with a realistic demo workshop.
 *
 * Usage:
 *   npm run dev            # in one terminal
 *   npm run seed           # in another
 *
 * Environment:
 *   INVENTORY_BASE_URL   default http://localhost:5173
 *   INVENTORY_API_KEY    only needed when the server has INVENTORY_API_KEY set
 *
 * The script is idempotent: locations are matched by full path, items by SKU,
 * and attachments are only uploaded when an item has none.
 */

const origin = (process.env.INVENTORY_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const base = `${origin}/api/v1`;
const apiKey = process.env.INVENTORY_API_KEY || '';

let requests = 0;
let currency = 'GBP';

async function api(path, options = {}) {
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers['content-type'] = 'application/json';
  }

  requests += 1;
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const text = await response.text();

  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${options.method || 'GET'} ${path} returned non-JSON (${response.status})`);
  }

  if (!response.ok) {
    const error = payload?.error;
    const detail = error
      ? `${error.code}: ${error.message}${
          error.details ? ` (${JSON.stringify(error.details)})` : ''
        }`
      : text;
    throw new Error(`${options.method || 'GET'} ${path} -> ${response.status} ${detail}`);
  }

  return payload;
}

const log = (symbol, message) => console.log(`  ${symbol} ${message}`);

// ── Locations ────────────────────────────────────────────────────────────────

const locationSpec = [
  { path: 'Office', description: 'Main office and electronics bench' },
  { path: 'Office / Drawer unit 1', description: 'Component drawers under the desk' },
  { path: 'Office / Drawer unit 1 / Drawer 1a', code: 'D1A' },
  { path: 'Office / Drawer unit 1 / Drawer 1b', code: 'D1B' },
  { path: 'Office / Bookcase', description: 'Boards, cables and reference books' },
  { path: 'Workshop', description: 'Soldering and assembly area' },
  { path: 'Workshop / Shelf A', description: 'Tools and consumables' },
  { path: 'Workshop / Shelf A / Bin A1', code: 'A1' },
  { path: 'Workshop / Shelf A / Bin A2', code: 'A2' },
  { path: 'Workshop / Parts cabinet' },
  { path: 'Workshop / Parts cabinet / Drawer C1', code: 'C1' },
  { path: 'Storage', description: 'Overflow storage' },
  { path: 'Storage / Box 1' }
];

async function loadLocations() {
  const { data } = await api('/locations');
  return new Map(data.map((location) => [location.path_label, location]));
}

async function ensureLocations() {
  const byPath = await loadLocations();

  for (const spec of locationSpec) {
    if (byPath.has(spec.path)) continue;

    const segments = spec.path.split(' / ');
    const name = segments.pop();
    const parentPath = segments.join(' / ');
    const parent = parentPath ? byPath.get(parentPath) : null;

    if (parentPath && !parent) {
      throw new Error(`Parent location "${parentPath}" was not created`);
    }

    const { data } = await api('/locations', {
      method: 'POST',
      body: JSON.stringify({
        name,
        parent_id: parent?.id ?? null,
        ...(spec.description ? { description: spec.description } : {}),
        ...(spec.code ? { code: spec.code } : {})
      })
    });

    byPath.set(data.path_label, data);
    log('+', `location ${data.path_label}`);
  }

  return byPath;
}

// ── Items ────────────────────────────────────────────────────────────────────

const itemSpec = [
  {
    name: '10kΩ resistor 0.25W',
    sku: 'RES-10K-025',
    category: 'Resistors',
    description: 'Carbon film, 5% tolerance, through-hole.',
    quantity: 240,
    unit: 'pcs',
    min_quantity: 50,
    location: 'Office / Drawer unit 1 / Drawer 1a',
    manufacturer: 'Yageo',
    mpn: 'CFR-25JB-52-10K',
    supplier: 'Mouser',
    price: 0.02,
    tags: ['through-hole', '10k'],
    custom_fields: { tolerance: '5%', power: '0.25W' },
    movement: { delta: -10, reason: 'used', note: 'Prototype build' }
  },
  {
    name: '100nF ceramic capacitor',
    sku: 'CAP-100N-50',
    category: 'Capacitors',
    description: '50V X7R ceramic, 2.54mm pitch.',
    quantity: 180,
    unit: 'pcs',
    min_quantity: 40,
    location: 'Office / Drawer unit 1 / Drawer 1a',
    manufacturer: 'Murata',
    mpn: 'RDE5C1H104J0P1H03B',
    supplier: 'Farnell',
    price: 0.03,
    tags: ['through-hole', 'decoupling'],
    custom_fields: { voltage: '50V', dielectric: 'X7R' }
  },
  {
    name: '1N4148 signal diode',
    sku: 'DIO-1N4148',
    category: 'Diodes',
    description: 'Small-signal switching diode, DO-35.',
    quantity: 95,
    unit: 'pcs',
    min_quantity: 25,
    location: 'Office / Drawer unit 1 / Drawer 1b',
    manufacturer: 'Vishay',
    mpn: '1N4148',
    supplier: 'Mouser',
    price: 0.04,
    tags: ['through-hole']
  },
  {
    name: 'ATmega328P-PU',
    sku: 'MCU-ATMEGA328P',
    category: 'Microcontrollers',
    description: '8-bit AVR, 28-pin DIP. Arduino-compatible.',
    quantity: 6,
    unit: 'pcs',
    min_quantity: 3,
    location: 'Office / Drawer unit 1 / Drawer 1b',
    manufacturer: 'Microchip',
    mpn: 'ATmega328P-PU',
    supplier: 'Mouser',
    price: 2.1,
    tags: ['avr', 'dip-28'],
    custom_fields: { flash: '32KB', clock: '20MHz' }
  },
  {
    name: 'LM7805 voltage regulator',
    sku: 'REG-LM7805',
    category: 'Power',
    description: '5V linear regulator, TO-220.',
    quantity: 14,
    unit: 'pcs',
    min_quantity: 5,
    location: 'Office / Drawer unit 1 / Drawer 1b',
    manufacturer: 'STMicroelectronics',
    mpn: 'L7805CV',
    supplier: 'Farnell',
    price: 0.32,
    tags: ['to-220', '5v']
  },
  {
    name: 'ESP32 dev board',
    sku: 'MCU-ESP32-DEV',
    category: 'Microcontrollers',
    description: 'ESP32-WROOM-32 development board with USB-C.',
    quantity: 5,
    unit: 'pcs',
    min_quantity: 2,
    location: 'Office / Drawer unit 1 / Drawer 1b',
    manufacturer: 'Espressif',
    mpn: 'ESP32-DEVKITC-32D',
    supplier: 'AliExpress',
    price: 6.5,
    tags: ['wifi', 'bluetooth', 'usb-c'],
    custom_fields: { cores: '2', flash: '4MB' }
  },
  {
    name: 'Raspberry Pi Pico',
    sku: 'MCU-PICO',
    category: 'Microcontrollers',
    description: 'RP2040 board with castellated edges.',
    quantity: 2,
    unit: 'pcs',
    min_quantity: 2,
    location: 'Office / Bookcase',
    manufacturer: 'Raspberry Pi',
    mpn: 'SC0915',
    supplier: 'The Pi Hut',
    price: 3.9,
    tags: ['rp2040', 'micropython'],
    movement: { delta: 2, reason: 'purchase', note: 'Order #4821' }
  },
  {
    name: 'USB-C cable 1m',
    sku: 'CABLE-USBC-1M',
    category: 'Cables',
    description: 'USB 2.0 data and power cable.',
    quantity: 7,
    unit: 'pcs',
    min_quantity: 3,
    location: 'Office / Bookcase',
    supplier: 'Anker',
    price: 4.2,
    tags: ['usb-c']
  },
  {
    name: '28 AWG hook-up wire, black',
    sku: 'WIRE-28-BLK',
    category: 'Wire',
    description: 'Silicone insulated, flexible, 28 AWG.',
    quantity: 12.5,
    unit: 'm',
    min_quantity: 5,
    location: 'Workshop / Shelf A / Bin A1',
    manufacturer: 'Alpha Wire',
    mpn: '2842/1 BK005',
    supplier: 'RS Components',
    price: 0.85,
    tags: ['silicone', 'flexible'],
    custom_fields: { gauge: '28 AWG', colour: 'Black' }
  },
  {
    name: '28 AWG hook-up wire, red',
    sku: 'WIRE-28-RED',
    category: 'Wire',
    description: 'Silicone insulated, flexible, 28 AWG.',
    quantity: 9,
    unit: 'm',
    min_quantity: 5,
    location: 'Workshop / Shelf A / Bin A1',
    manufacturer: 'Alpha Wire',
    mpn: '2842/1 RD005',
    supplier: 'RS Components',
    price: 0.85,
    tags: ['silicone', 'flexible'],
    custom_fields: { gauge: '28 AWG', colour: 'Red' },
    movement: { delta: -6, reason: 'used', note: 'Rewired test rig' }
  },
  {
    name: 'Solder 0.7mm lead-free',
    sku: 'SOLD-07-LF',
    category: 'Consumables',
    description: 'SAC305 no-clean solder, 100g reel.',
    quantity: 1,
    unit: 'roll',
    min_quantity: 1,
    location: 'Workshop / Shelf A / Bin A2',
    manufacturer: 'Multicore',
    mpn: 'SAC305-0.7-100G',
    supplier: 'Farnell',
    price: 18.5,
    tags: ['soldering', 'lead-free'],
    custom_fields: { diameter: '0.7mm', weight: '100g' }
  },
  {
    name: 'Flux pen',
    sku: 'FLUX-PEN',
    category: 'Consumables',
    description: 'No-clean flux dispensing pen.',
    quantity: 3,
    unit: 'pcs',
    min_quantity: 2,
    location: 'Workshop / Shelf A / Bin A2',
    supplier: 'Amazon',
    price: 6.0,
    tags: ['soldering', 'flux']
  },
  {
    name: 'M3 hex standoff 10mm',
    sku: 'HW-M3-10',
    category: 'Hardware',
    description: 'Brass M3 female-female hex standoff.',
    quantity: 120,
    unit: 'pcs',
    min_quantity: 30,
    location: 'Workshop / Parts cabinet / Drawer C1',
    supplier: 'AliExpress',
    price: 0.08,
    tags: ['m3', 'standoff'],
    custom_fields: { length: '10mm', material: 'Brass' }
  },
  {
    name: 'M3 machine screw 8mm',
    sku: 'HW-M3-SCREW-8',
    category: 'Hardware',
    description: 'Stainless steel pan-head M3 screw.',
    quantity: 200,
    unit: 'pcs',
    min_quantity: 50,
    location: 'Workshop / Parts cabinet / Drawer C1',
    supplier: 'AliExpress',
    price: 0.03,
    tags: ['m3', 'screw']
  },
  {
    name: 'Assorted heat-shrink tubing',
    sku: 'HW-HEATSHRINK',
    category: 'Hardware',
    description: 'Mixed sizes and colours, 2:1 shrink ratio.',
    quantity: 1,
    unit: 'pack',
    min_quantity: 1,
    location: 'Workshop / Parts cabinet / Drawer C1',
    supplier: 'Amazon',
    price: 8.5,
    tags: ['heat-shrink'],
    custom_fields: { ratio: '2:1', sizes: '1.5–10mm' }
  },
  {
    name: 'Silicone soldering mat',
    sku: 'TOOL-MAT',
    category: 'Tools',
    description: 'Heat-resistant work mat with screw trays.',
    quantity: 1,
    unit: 'pcs',
    min_quantity: 1,
    location: 'Workshop / Shelf A',
    supplier: 'Amazon',
    price: 14.0,
    tags: ['soldering', 'bench']
  },
  {
    name: 'Digital multimeter',
    sku: 'TOOL-DMM',
    category: 'Tools',
    description: 'True-RMS handheld multimeter with continuity beeper.',
    quantity: 1,
    unit: 'pcs',
    min_quantity: 1,
    location: 'Workshop / Shelf A',
    manufacturer: 'UNI-T',
    mpn: 'UT61E+',
    supplier: 'AliExpress',
    price: 62.0,
    tags: ['test-equipment', 'true-rms']
  },
  {
    name: 'Thermal paste',
    sku: 'CONS-THERMAL',
    category: 'Consumables',
    description: 'High-conductivity CPU thermal compound, 4g.',
    quantity: 1,
    unit: 'pcs',
    min_quantity: 1,
    location: 'Storage / Box 1',
    manufacturer: 'Arctic',
    mpn: 'MX-4-4G',
    supplier: 'Amazon',
    price: 7.5,
    tags: ['thermal'],
    movement: { delta: -1, reason: 'used', note: 'Repasted laptop' }
  }
];

async function loadItems() {
  const { data } = await api('/items?limit=200&include_archived=1');
  return new Map(data.filter((item) => item.sku).map((item) => [item.sku, item]));
}

async function ensureItems(locations) {
  const existing = await loadItems();
  let created = 0;

  for (const spec of itemSpec) {
    if (spec.sku && existing.has(spec.sku)) continue;

    const location = locations.get(spec.location);
    if (!location) throw new Error(`Missing location "${spec.location}"`);

    const { movement, location: _location, ...fields } = spec;
    const { data: item } = await api('/items', {
      method: 'POST',
      body: JSON.stringify({
        ...fields,
        location_id: location.id,
        currency
      })
    });

    existing.set(item.sku, item);
    created += 1;
    log('+', `item ${item.name} (${item.quantity} ${item.unit})`);

    if (movement) {
      await api(`/items/${item.id}/stock`, {
        method: 'POST',
        body: JSON.stringify(movement)
      });
      log('~', `stock ${movement.delta > 0 ? '+' : ''}${movement.delta} ${item.name}`);
    }
  }

  return created;
}

// ── Attachments ──────────────────────────────────────────────────────────────

function resistorSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240">
  <rect width="480" height="240" fill="#e8e3d5"/>
  <g fill="none" stroke="#8a6d3b" stroke-width="5">
    <path d="M40 120h90M350 120h90"/>
    <rect x="130" y="88" width="220" height="64" rx="14" fill="#d9c9a3"/>
  </g>
  <g fill="#5b4630">
    <rect x="168" y="88" width="14" height="64"/>
    <rect x="198" y="88" width="10" height="64"/>
    <rect x="222" y="88" width="22" height="64"/>
    <rect x="262" y="88" width="12" height="64"/>
  </g>
  <text x="240" y="200" font-family="monospace" font-size="22" text-anchor="middle" fill="#5b4630">10kΩ · 5% · 0.25W</text>
</svg>`;
}

function multimeterSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480">
  <rect width="360" height="480" fill="#f0ede4"/>
  <rect x="70" y="30" width="220" height="420" rx="26" fill="#d8a022"/>
  <rect x="95" y="55" width="170" height="110" rx="10" fill="#20302a"/>
  <text x="180" y="125" font-family="monospace" font-size="46" text-anchor="middle" fill="#9be8c8">4.98</text>
  <circle cx="180" cy="250" r="58" fill="#2c2c2c"/>
  <rect x="168" y="198" width="24" height="20" rx="4" fill="#e8e8e8"/>
  <g fill="#2c2c2c">
    <circle cx="130" cy="400" r="16"/><circle cx="180" cy="400" r="16"/><circle cx="230" cy="400" r="16"/>
  </g>
  <text x="130" y="406" font-family="monospace" font-size="12" text-anchor="middle" fill="#d8a022">COM</text>
  <text x="180" y="406" font-family="monospace" font-size="12" text-anchor="middle" fill="#d8a022">V</text>
  <text x="230" y="406" font-family="monospace" font-size="12" text-anchor="middle" fill="#d8a022">mA</text>
</svg>`;
}

function notesFile(title, lines) {
  return `${title}\n${'='.repeat(title.length)}\n\n${lines.join('\n')}\n`;
}

const attachmentSpec = [
  {
    sku: 'RES-10K-025',
    kind: 'photo',
    caption: 'Resistor colour bands',
    file: { name: 'resistor-10k.svg', type: 'image/svg+xml', body: resistorSvg() }
  },
  {
    sku: 'TOOL-DMM',
    kind: 'photo',
    caption: 'Front panel',
    file: { name: 'multimeter.svg', type: 'image/svg+xml', body: multimeterSvg() }
  },
  {
    sku: 'MCU-ATMEGA328P',
    kind: 'document',
    caption: 'Pinout quick reference',
    file: {
      name: 'atmega328p-pinout.txt',
      type: 'text/plain',
      body: notesFile('ATmega328P-PU pinout', [
        'Pin 1  PC6 / RESET',
        'Pin 2  PD0 / RXD',
        'Pin 3  PD1 / TXD',
        'Pin 7  VCC',
        'Pin 8  GND',
        'Pin 9  PB6 / XTAL1',
        'Pin 10 PB7 / XTAL2',
        'Pin 14 PB0 / ICP1',
        '',
        'Decouple VCC with 100nF close to the package.'
      ])
    }
  },
  {
    sku: 'MCU-ESP32-DEV',
    kind: 'document',
    caption: 'Board notes',
    file: {
      name: 'esp32-devkit-notes.txt',
      type: 'text/plain',
      body: notesFile('ESP32 DevKitC notes', [
        'Module: ESP32-WROOM-32',
        'USB bridge: CP2102',
        'Hold BOOT while resetting to enter download mode.',
        '3V3 logic only — do not feed 5V into GPIO.'
      ])
    }
  }
];

async function ensureAttachments(items) {
  let created = 0;

  for (const spec of attachmentSpec) {
    const item = items.get(spec.sku);
    if (!item) continue;

    const { data: existing } = await api(`/attachments?item_id=${encodeURIComponent(item.id)}`);
    if (existing.length > 0) continue;

    const form = new FormData();
    form.append('file', new Blob([spec.file.body], { type: spec.file.type }), spec.file.name);
    form.append('item_id', item.id);
    form.append('kind', spec.kind);
    form.append('caption', spec.caption);

    await api('/attachments', { method: 'POST', body: form });
    created += 1;
    log('+', `${spec.kind} for ${item.name}`);
  }

  return created;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nSeeding ${base}\n`);

  try {
    await api('/health');
  } catch (error) {
    console.error(`Cannot reach the Inventory API at ${base}.`);
    console.error('Start the app first with "npm run dev" (or point INVENTORY_BASE_URL at a running server).');
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }

  const { data: meta } = await api('/meta');
  currency = meta.stats.currency || currency;

  const locations = await ensureLocations();
  const createdItems = await ensureItems(locations);
  const items = await loadItems();
  const createdAttachments = await ensureAttachments(items);
  const { data: stats } = await api('/meta');

  console.log('\nDone.');
  log('·', `${requests} API requests`);
  log('·', `${createdItems} new items, ${createdAttachments} new attachments`);
  log(
    '·',
    `${stats.stats.item_count} items across ${stats.stats.location_count} locations (${stats.stats.low_stock_count} low on stock)`
  );
  console.log(`\nOpen ${origin} to browse the inventory.\n`);
}

main().catch((error) => {
  console.error(`\nSeed failed: ${error.message}\n`);
  process.exit(1);
});
