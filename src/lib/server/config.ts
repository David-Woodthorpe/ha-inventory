import { readFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';

const root = process.cwd();

/**
 * Home Assistant writes add-on options to /data/options.json. Read them only
 * when running under the Supervisor so a plain Docker install can never pick
 * up an unrelated file.
 */
function readHomeAssistantOptions(): Record<string, unknown> {
  if (!process.env.SUPERVISOR_TOKEN) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync('/data/options.json', 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const haOptions = readHomeAssistantOptions();

function optionText(key: string): string {
  const value = haOptions[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return undefined;
}

function optionBoolean(key: string): boolean | undefined {
  return parseBoolean(haOptions[key]);
}

export const dataDir = env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(root, 'data');
export const uploadDir = path.join(dataDir, 'uploads');
export const databaseFile = path.join(dataDir, 'inventory.db');

const maxUploadMb = env.MAX_UPLOAD_MB || optionText('max_upload_mb') || '50';
export const maxUploadBytes = Math.max(1, Number(maxUploadMb) || 50) * 1024 * 1024;
export const defaultCurrency = (env.DEFAULT_CURRENCY || optionText('default_currency') || 'GBP').toUpperCase();
export const pricingEnabled = parseBoolean(env.ENABLE_PRICING) ?? optionBoolean('enable_pricing') ?? true;
export const apiKey = env.INVENTORY_API_KEY || optionText('api_key');
export const publicBaseUrl = (env.PUBLIC_BASE_URL || optionText('public_url')).replace(/\/+$/, '');

function topicPrefix(value: string, fallback: string): string {
  return (value.trim() || fallback).replace(/^\/+|\/+$/g, '');
}

export const mqttEnabled = parseBoolean(env.MQTT_ENABLED) ?? optionBoolean('enable_mqtt') ?? true;
export const mqttDiscoveryPrefix = topicPrefix(
  env.MQTT_DISCOVERY_PREFIX || optionText('mqtt_discovery_prefix'),
  'homeassistant'
);
export const mqttTopicPrefix = topicPrefix(
  env.MQTT_TOPIC_PREFIX || optionText('mqtt_topic_prefix'),
  'inventory'
);

/**
 * Optional Home Assistant local calendar for service due dates. Setting an
 * entity ID enables the feature; leaving it empty keeps the app fully offline.
 * The add-on talks to Core through the Supervisor proxy, while Docker installs
 * provide HA_URL and HA_TOKEN directly.
 */
export const serviceCalendarEntity = (
  env.HA_CALENDAR_ENTITY ||
  env.SERVICE_CALENDAR_ENTITY ||
  optionText('service_calendar_entity')
).trim();
export const homeAssistantUrl = (env.HA_URL || '').replace(/\/+$/, '');
export const homeAssistantToken = env.HA_TOKEN || process.env.SUPERVISOR_TOKEN || '';
export const serviceCalendarEnabled = Boolean(
  serviceCalendarEntity && homeAssistantToken && (process.env.SUPERVISOR_TOKEN || homeAssistantUrl)
);

export const appVersion = '1.3.0';
