import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { connect, type MqttClient } from 'mqtt';
import type { Item, Location } from '$lib/types';
import {
  appVersion,
  dataDir,
  mqttDiscoveryPrefix,
  mqttEnabled,
  mqttTopicPrefix,
  publicBaseUrl
} from './config';
import { listItems } from './items';
import { getLocations } from './locations';

/**
 * Home Assistant MQTT Discovery.
 *
 * The app publishes one device per location, not one device per item. Each
 * location device exposes a "Contents" sensor whose attributes contain the item
 * list and a ready-to-use Markdown table, plus a low-stock binary sensor. Item
 * quantity and low-stock entities are grouped onto their nearest published
 * location device, so a room stays a single device instead of a long list of
 * item devices. Items with no published location are grouped onto the hub.
 *
 * Devices are arranged in a hierarchy with via_device:
 *
 *   Inventory (hub)
 *   ├── Office
 *   │   ├── Office / Bookcase
 *   │   └── Office / Drawer unit 1
 *   └── Workshop
 *
 * Discovery and state messages are retained so Home Assistant recovers the
 * entities after a restart. A retained LWT marks every entity unavailable when
 * the app stops.
 */

interface BrokerSettings {
  url: string;
  username?: string;
  password?: string;
  protocolVersion: 3 | 4;
  rejectUnauthorized: boolean;
}

interface PersistedTopics {
  configs: string[];
  states: string[];
}

const STATUS_TOPIC = `${mqttTopicPrefix}/status`;
const SUMMARY_STATE_TOPIC = `${mqttTopicPrefix}/summary/state`;
const TOPICS_FILE = path.join(dataDir, 'mqtt-discovery-topics.json');

let started = false;
let client: MqttClient | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;
let syncAgain = false;
let lastConnectionError = '';

const publishedConfigs = new Map<string, string>();
const publishedStates = new Map<string, string>();
let knownConfigTopics = new Set<string>();
let knownStateTopics = new Set<string>();

function envText(key: string): string {
  return (process.env[key] ?? '').trim();
}

function envBoolean(key: string): boolean | undefined {
  const value = envText(key).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return undefined;
}

function loadKnownTopics(): void {
  try {
    const parsed = JSON.parse(readFileSync(TOPICS_FILE, 'utf8')) as Partial<PersistedTopics>;
    knownConfigTopics = new Set(
      Array.isArray(parsed.configs) ? parsed.configs.filter((topic) => typeof topic === 'string') : []
    );
    knownStateTopics = new Set(
      Array.isArray(parsed.states) ? parsed.states.filter((topic) => typeof topic === 'string') : []
    );
  } catch {
    knownConfigTopics = new Set();
    knownStateTopics = new Set();
  }
}

function saveKnownTopics(): void {
  try {
    const temporary = `${TOPICS_FILE}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({
        configs: Array.from(knownConfigTopics).sort(),
        states: Array.from(knownStateTopics).sort()
      })
    );
    renameSync(temporary, TOPICS_FILE);
  } catch (error) {
    console.warn('[mqtt] Could not save the list of published topics', error);
  }
}

async function supervisorBroker(): Promise<BrokerSettings | null> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return null;

  try {
    // The Supervisor exposes the MQTT broker configured in Home Assistant.
    // The add-on requests access with `services: [mqtt:want]` in config.yaml.
    const response = await fetch('http://supervisor/services/mqtt', {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      console.info(`[mqtt] Home Assistant MQTT service is not available (HTTP ${response.status})`);
      return null;
    }

    const payload = (await response.json()) as {
      data?: {
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        ssl?: boolean;
        protocol?: string;
      };
    };
    const service = payload.data;
    if (!service?.host) {
      console.info('[mqtt] Home Assistant did not return an MQTT broker address');
      return null;
    }

    const ssl = Boolean(service.ssl);
    return {
      url: `${ssl ? 'mqtts' : 'mqtt'}://${service.host}:${Number(service.port) || (ssl ? 8883 : 1883)}`,
      username: service.username || undefined,
      password: service.password || undefined,
      protocolVersion: service.protocol === '3.1' ? 3 : 4,
      rejectUnauthorized: true
    };
  } catch (error) {
    console.info(
      '[mqtt] Could not read the Home Assistant MQTT service:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

async function resolveBroker(): Promise<BrokerSettings | null> {
  const host = envText('MQTT_HOST');
  if (host) {
    const ssl = envBoolean('MQTT_SSL') ?? false;
    return {
      url: `${ssl ? 'mqtts' : 'mqtt'}://${host}:${envText('MQTT_PORT') || (ssl ? '8883' : '1883')}`,
      username: envText('MQTT_USERNAME') || undefined,
      password: envText('MQTT_PASSWORD') || undefined,
      protocolVersion: envText('MQTT_PROTOCOL') === '3.1' ? 3 : 4,
      rejectUnauthorized: envBoolean('MQTT_TLS_REJECT_UNAUTHORIZED') ?? true
    };
  }
  return supervisorBroker();
}

export function ensureMqttStarted(): void {
  if (started) return;
  started = true;
  if (!mqttEnabled) {
    console.info('[mqtt] Home Assistant discovery is disabled');
    return;
  }
  void start();
}

async function start(): Promise<void> {
  const broker = await resolveBroker();
  if (!broker) {
    console.info('[mqtt] No MQTT broker configured; Home Assistant discovery is off');
    return;
  }

  loadKnownTopics();
  console.info(`[mqtt] Connecting to ${broker.url} for Home Assistant discovery`);

  client = connect(broker.url, {
    clientId: `inventory_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    clean: true,
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
    protocolVersion: broker.protocolVersion,
    username: broker.username,
    password: broker.password,
    rejectUnauthorized: broker.rejectUnauthorized,
    will: {
      topic: STATUS_TOPIC,
      payload: Buffer.from('offline'),
      qos: 1,
      retain: true
    }
  });

  client.on('connect', () => {
    lastConnectionError = '';
    console.info('[mqtt] Connected; publishing Home Assistant discovery');
    // Republish everything after a reconnect: the broker may have restarted
    // without retained-message persistence.
    publishedConfigs.clear();
    publishedStates.clear();
    client?.publish(STATUS_TOPIC, 'online', { qos: 1, retain: true });
    requestMqttSync(0);
  });

  client.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastConnectionError) {
      lastConnectionError = message;
      console.warn(`[mqtt] ${message}`);
    }
  });
}

/**
 * Ask for a discovery/state refresh. Mutating requests call this so a single
 * debounced sync covers a burst of changes (for example a bulk import).
 */
export function requestMqttSync(delayMs = 750): void {
  if (!started || !client?.connected) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void runSync();
  }, delayMs);
}

function discoveryTopic(component: string, objectId: string): string {
  return `${mqttDiscoveryPrefix}/${component}/inventory/${objectId}/config`;
}

function locationIdentifier(id: string): string {
  return `inventory_location_${id}`;
}

function appUrl(): string | null {
  return /^https?:\/\//i.test(publicBaseUrl) ? publicBaseUrl : null;
}

function hubDevice(): Record<string, unknown> {
  const device: Record<string, unknown> = {
    identifiers: ['inventory_app'],
    name: 'Inventory',
    manufacturer: 'Inventory',
    model: 'Self-hosted inventory',
    sw_version: appVersion
  };
  const url = appUrl();
  if (url) device.configuration_url = url;
  return device;
}

function locationDevice(
  location: Location,
  locationsById: Map<string, Location>
): Record<string, unknown> {
  const topLevel = locationsById.get(location.path_ids[0]) ?? location;
  const device: Record<string, unknown> = {
    identifiers: [locationIdentifier(location.id)],
    name: location.path_label,
    manufacturer: 'Inventory',
    model: location.code ? `Location (${location.code})` : 'Location',
    sw_version: appVersion,
    suggested_area: topLevel.name,
    via_device: location.parent_id
      ? locationIdentifier(location.parent_id)
      : 'inventory_app'
  };
  const url = appUrl();
  if (url) device.configuration_url = url;
  return device;
}

function itemLabel(item: Item): string {
  return item.sku ? `${item.name} (${item.sku})` : item.name;
}

/**
 * The device that item entities should be grouped under. Walk up the item's
 * location path and use the closest location that is actually published, so an
 * item in a hidden sublocation still appears on its published room device.
 */
function itemGroupingLocation(
  item: Item,
  locationsById: Map<string, Location>
): Location | undefined {
  if (!item.location) return undefined;
  for (let index = item.location.path_ids.length - 1; index >= 0; index--) {
    const location = locationsById.get(item.location.path_ids[index]);
    if (location) return location;
  }
  return undefined;
}

function availability() {
  return {
    availability_topic: STATUS_TOPIC,
    payload_available: 'online',
    payload_not_available: 'offline'
  };
}

function relativeLocation(item: Item, base: Location | null): string {
  if (!item.location) return 'Unassigned';
  if (!base) return item.location.path_label;
  const ids = item.location.path_ids;
  const baseIds = base.path_ids;
  let start = 0;
  while (start < baseIds.length && ids[start] === baseIds[start]) start += 1;
  const names = item.location.path.slice(start);
  return names.length ? names.join(' / ') : 'Here';
}

function markdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function markdownTable(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return 'No items.';
  const lines = ['| Item | Qty | Location |', '|:--|--:|:--|'];
  for (const row of rows) {
    const low = row.low_stock ? ' (low)' : '';
    lines.push(
      `| ${markdownCell(String(row.name ?? ''))}${low} | ${String(row.quantity ?? '')} ${markdownCell(
        String(row.unit ?? '')
      )} | ${markdownCell(String(row.location ?? ''))} |`
    );
  }
  return lines.join('\n');
}

function itemAttributes(item: Item, base: Location | null): Record<string, unknown> {
  return {
    name: item.name,
    sku: item.sku,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit,
    min_quantity: item.min_quantity,
    low_stock: item.low_stock,
    location: relativeLocation(item, base),
    location_id: item.location_id,
    updated_at: item.updated_at
  };
}

function origin(): Record<string, unknown> {
  const details: Record<string, unknown> = { name: 'Inventory', sw_version: appVersion };
  const url = appUrl();
  if (url) details.support_url = url;
  return details;
}

function addConfig(
  configs: Map<string, string>,
  component: string,
  objectId: string,
  payload: Record<string, unknown>
): void {
  configs.set(discoveryTopic(component, objectId), JSON.stringify({ ...payload, origin: origin() }));
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

function buildDiscovery(allLocations: Location[], allItems: Item[]) {
  const configs = new Map<string, string>();
  const states = new Map<string, string>();
  const allLocationsById = new Map(allLocations.map((location) => [location.id, location]));

  // A location is published only when it and every ancestor are enabled, so
  // turning off a room also hides its sublocations.
  const locations = allLocations.filter(
    (location) =>
      location.ha_enabled &&
      location.path_ids.every((id) => allLocationsById.get(id)?.ha_enabled)
  );
  // Items are independently opt-in. An explicitly published item stays visible
  // even when its location is hidden, so vital low-stock items can still be
  // monitored. Those items attach to the hub instead of the hidden location.
  const items = allItems.filter((item) => item.ha_enabled);

  const locationsById = new Map(locations.map((location) => [location.id, location]));
  const itemsByLocation = new Map<string, Item[]>();

  for (const item of items) {
    if (!item.location) continue;
    for (const ancestorId of item.location.path_ids) {
      const list = itemsByLocation.get(ancestorId) ?? [];
      list.push(item);
      itemsByLocation.set(ancestorId, list);
    }
  }

  // ---- Inventory hub -------------------------------------------------------
  const lowStockItems = items.filter((item) => item.low_stock);
  const summaryState = {
    item_count: items.length,
    total_units: roundQuantity(items.reduce((sum, item) => sum + item.quantity, 0)),
    low_stock: lowStockItems.length,
    location_count: locations.length,
    low_stock_items: lowStockItems.map((item) => itemAttributes(item, null))
  };
  states.set(SUMMARY_STATE_TOPIC, JSON.stringify(summaryState));

  addConfig(configs, 'sensor', 'summary_items', {
    name: 'Items',
    unique_id: 'inventory_summary_items',
    state_topic: SUMMARY_STATE_TOPIC,
    value_template: '{{ value_json.item_count }}',
    json_attributes_topic: SUMMARY_STATE_TOPIC,
    icon: 'mdi:package-variant-closed',
    ...availability(),
    device: hubDevice()
  });

  addConfig(configs, 'sensor', 'summary_low_stock', {
    name: 'Low stock items',
    unique_id: 'inventory_summary_low_stock',
    state_topic: SUMMARY_STATE_TOPIC,
    value_template: '{{ value_json.low_stock }}',
    json_attributes_topic: SUMMARY_STATE_TOPIC,
    icon: 'mdi:alert-outline',
    ...availability(),
    device: hubDevice()
  });

  addConfig(configs, 'binary_sensor', 'summary_low_stock_alert', {
    name: 'Low stock alert',
    unique_id: 'inventory_summary_low_stock_alert',
    state_topic: SUMMARY_STATE_TOPIC,
    value_template: "{{ 'ON' if value_json.low_stock > 0 else 'OFF' }}",
    json_attributes_topic: SUMMARY_STATE_TOPIC,
    device_class: 'problem',
    icon: 'mdi:alert',
    ...availability(),
    device: hubDevice()
  });

  // ---- Locations -----------------------------------------------------------
  for (const location of locations) {
    const contents = (itemsByLocation.get(location.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
    const rows = contents.map((item) => itemAttributes(item, location));
    const lowStock = rows.filter((row) => row.low_stock).length;
    const totalQuantity = contents.reduce((sum, item) => sum + item.quantity, 0);
    const directItemCount = contents.filter((item) => item.location_id === location.id).length;
    const childLocations = locations
      .filter((entry) => entry.parent_id === location.id)
      .map((entry) => ({ id: entry.id, name: entry.name }));

    const stateTopic = `${mqttTopicPrefix}/location/${location.id}/state`;
    states.set(
      stateTopic,
      JSON.stringify({
        item_count: contents.length,
        direct_item_count: directItemCount,
        total_quantity: roundQuantity(totalQuantity),
        low_stock: lowStock,
        child_locations: childLocations,
        items: rows,
        contents: markdownTable(rows)
      })
    );

    const objectBase = `location_${location.id}`;
    addConfig(configs, 'sensor', `${objectBase}_contents`, {
      name: 'Contents',
      unique_id: `inventory_location_${location.id}_contents`,
      state_topic: stateTopic,
      value_template: '{{ value_json.item_count }}',
      json_attributes_topic: stateTopic,
      icon: 'mdi:package-variant-closed',
      ...availability(),
      device: locationDevice(location, locationsById)
    });

    addConfig(configs, 'binary_sensor', `${objectBase}_low_stock`, {
      name: 'Low stock',
      unique_id: `inventory_location_${location.id}_low_stock`,
      state_topic: stateTopic,
      value_template: "{{ 'ON' if value_json.low_stock > 0 else 'OFF' }}",
      json_attributes_topic: stateTopic,
      device_class: 'problem',
      icon: 'mdi:alert',
      ...availability(),
      device: locationDevice(location, locationsById)
    });
  }

  // ---- Items ---------------------------------------------------------------
  for (const item of items) {
    const stateTopic = `${mqttTopicPrefix}/item/${item.id}/state`;
    states.set(
      stateTopic,
      JSON.stringify({
        quantity: item.quantity,
        unit: item.unit,
        min_quantity: item.min_quantity,
        low_stock: item.low_stock,
        name: item.name,
        sku: item.sku,
        category: item.category,
        location: item.location?.path_label ?? null,
        location_id: item.location_id,
        updated_at: item.updated_at
      })
    );

    const groupingLocation = itemGroupingLocation(item, locationsById);
    const device = groupingLocation
      ? locationDevice(groupingLocation, locationsById)
      : hubDevice();
    const label = itemLabel(item);
    const objectBase = `item_${item.id}`;

    addConfig(configs, 'sensor', `${objectBase}_quantity`, {
      name: label,
      unique_id: `inventory_item_${item.id}_quantity`,
      state_topic: stateTopic,
      value_template: '{{ value_json.quantity }}',
      json_attributes_topic: stateTopic,
      unit_of_measurement: item.unit,
      icon: 'mdi:counter',
      ...availability(),
      device
    });

    addConfig(configs, 'binary_sensor', `${objectBase}_low_stock`, {
      name: `${label} low stock`,
      unique_id: `inventory_item_${item.id}_low_stock`,
      state_topic: stateTopic,
      value_template: "{{ 'ON' if value_json.low_stock else 'OFF' }}",
      json_attributes_topic: stateTopic,
      device_class: 'problem',
      icon: 'mdi:alert',
      ...availability(),
      device
    });
  }

  return { configs, states };
}

function publishAll(configs: Map<string, string>, states: Map<string, string>): void {
  const connection = client;
  if (!connection?.connected) return;

  for (const [topic, payload] of configs) {
    if (publishedConfigs.get(topic) === payload) continue;
    connection.publish(topic, payload, { qos: 1, retain: true });
    publishedConfigs.set(topic, payload);
  }
  for (const [topic, payload] of states) {
    if (publishedStates.get(topic) === payload) continue;
    connection.publish(topic, payload, { qos: 1, retain: true });
    publishedStates.set(topic, payload);
  }

  // Remove entities that no longer exist. Retained discovery configs would
  // otherwise leave stale devices in Home Assistant forever.
  for (const topic of Array.from(knownConfigTopics)) {
    if (configs.has(topic)) continue;
    connection.publish(topic, '', { qos: 1, retain: true });
    knownConfigTopics.delete(topic);
    publishedConfigs.delete(topic);
  }
  for (const topic of Array.from(knownStateTopics)) {
    if (states.has(topic)) continue;
    connection.publish(topic, '', { qos: 1, retain: true });
    knownStateTopics.delete(topic);
    publishedStates.delete(topic);
  }

  for (const topic of configs.keys()) knownConfigTopics.add(topic);
  for (const topic of states.keys()) knownStateTopics.add(topic);
  saveKnownTopics();
}

async function runSync(): Promise<void> {
  if (!client?.connected) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    const locations = getLocations();
    const items = listItems({ include_archived: false, limit: 100_000, sort: 'name' }).items;
    const { configs, states } = buildDiscovery(locations, items);
    publishAll(configs, states);
  } catch (error) {
    console.error('[mqtt] Could not publish Home Assistant discovery', error);
  } finally {
    syncing = false;
    if (syncAgain) {
      syncAgain = false;
      requestMqttSync(250);
    }
  }
}
