import {
  homeAssistantToken,
  homeAssistantUrl,
  publicBaseUrl,
  serviceCalendarEntity
} from './config';
import { db, nowIso } from './db';
import { getLocations } from './locations';
import type { ItemRow } from './serialize';

/**
 * Optional Home Assistant calendar sync for service due dates.
 *
 * Home Assistant only exposes create through the REST service API, and the
 * REST service call does not return a UID. Update and delete therefore use the
 * WebSocket API, and a freshly created event is read back through the calendar
 * REST endpoint so its UID can be stored for future updates.
 *
 * The feature is off unless a calendar entity is configured and a token is
 * available. Every failure is logged and swallowed so an unavailable Home
 * Assistant never blocks an inventory change.
 */

interface HaEndpoints {
  apiUrl: string;
  wsUrl: string;
  token: string;
}

interface CalendarMapping {
  item_id: string;
  entity_id: string;
  uid: string;
  due_date: string;
}

interface CalendarEventPayload {
  dtstart: string;
  dtend: string;
  summary: string;
  description: string;
  location?: string;
}

const markerPrefix = '[inventory-service:';

function serviceMarker(itemId: string): string {
  return `${markerPrefix}${itemId}]`;
}

function resolveEndpoints(): HaEndpoints | null {
  if (!serviceCalendarEntity || !homeAssistantToken) return null;

  if (process.env.SUPERVISOR_TOKEN) {
    return {
      apiUrl: 'http://supervisor/core/api',
      wsUrl: 'ws://supervisor/core/websocket',
      token: homeAssistantToken
    };
  }

  if (!homeAssistantUrl) return null;
  const url = new URL(homeAssistantUrl);
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = url.pathname.replace(/\/+$/, '');
  return {
    apiUrl: `${homeAssistantUrl}/api`,
    wsUrl: `${wsProtocol}//${url.host}${basePath}/api/websocket`,
    token: homeAssistantToken
  };
}

function openSocket(endpoints: HaEndpoints): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === 'undefined') {
      reject(new Error('This Node.js runtime does not provide a WebSocket client'));
      return;
    }

    const socket = new WebSocket(endpoints.wsUrl);
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Timed out connecting to Home Assistant')), 10_000);

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        try {
          socket.close();
        } catch {
          // ignore close failures while reporting the original error
        }
        reject(error);
      } else {
        resolve(socket);
      }
    }

    socket.addEventListener('message', (event) => {
      let message: { type?: string };
      try {
        message = JSON.parse(String(event.data)) as { type?: string };
      } catch {
        return;
      }
      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: endpoints.token }));
      } else if (message.type === 'auth_ok') {
        finish();
      } else if (message.type === 'auth_invalid') {
        finish(new Error('Home Assistant rejected the access token'));
      }
    });
    socket.addEventListener('error', () => finish(new Error('Could not connect to Home Assistant')));
    socket.addEventListener('close', () => finish(new Error('Home Assistant closed the connection')));
  });
}

interface HaSocket {
  send(command: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

async function connect(endpoints: HaEndpoints): Promise<HaSocket> {
  const socket = await openSocket(endpoints);
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  socket.addEventListener('message', (event) => {
    let message: {
      id?: number;
      type?: string;
      success?: boolean;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(String(event.data)) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id !== 'number') return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.type === 'result' && message.success) entry.resolve(message.result);
    else entry.reject(new Error(message.error?.message ?? 'Home Assistant command failed'));
  });

  socket.addEventListener('close', () => {
    for (const entry of pending.values()) {
      entry.reject(new Error('Home Assistant closed the connection'));
    }
    pending.clear();
  });

  return {
    send(command) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Home Assistant did not respond to the calendar command'));
        }, 15_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          }
        });
        socket.send(JSON.stringify({ id, ...command }));
      });
    },
    close() {
      try {
        socket.close();
      } catch {
        // ignore close failures
      }
    }
  };
}

function isSchemaError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /dtstart|dtend|start|end|required|extra|invalid|unknown/.test(message);
}

function eventForStyle(
  event: CalendarEventPayload,
  style: 'rfc' | 'legacy'
): Record<string, unknown> {
  const { dtstart, dtend, ...rest } = event;
  return style === 'rfc' ? { ...rest, dtstart, dtend } : { ...rest, start: dtstart, end: dtend };
}

async function sendEventCommand(
  entityId: string,
  command: 'create' | 'update' | 'delete',
  event: CalendarEventPayload | null,
  uid?: string
): Promise<void> {
  const endpoints = resolveEndpoints();
  if (!endpoints) return;

  const socket = await connect(endpoints);
  try {
    const base = {
      type: `calendar/event/${command}`,
      entity_id: entityId,
      ...(uid ? { uid } : {})
    };
    if (!event) {
      await socket.send(base);
      return;
    }

    try {
      await socket.send({ ...base, event: eventForStyle(event, 'rfc') });
    } catch (error) {
      // Home Assistant versions before the RFC 5545 field rename used
      // start/end. Retry once with those names when the payload was rejected.
      if (!isSchemaError(error)) throw error;
      await socket.send({ ...base, event: eventForStyle(event, 'legacy') });
    }
  } finally {
    socket.close();
  }
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function listCalendarEvents(
  endpoints: HaEndpoints,
  dueDate: string
): Promise<Array<{ uid?: string; description?: string }>> {
  const start = `${shiftDate(dueDate, -400)}T00:00:00Z`;
  const end = `${shiftDate(dueDate, 400)}T23:59:59Z`;
  const url =
    `${endpoints.apiUrl}/calendars/${encodeURIComponent(serviceCalendarEntity)}` +
    `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${endpoints.token}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`Home Assistant calendar request failed (HTTP ${response.status})`);
  }
  const payload: unknown = await response.json();
  return Array.isArray(payload)
    ? (payload as Array<{ uid?: string; description?: string }>)
    : [];
}

function findEventUid(
  events: Array<{ uid?: string; description?: string }>,
  itemId: string
): string | null {
  const marker = serviceMarker(itemId);
  for (const event of events) {
    if (typeof event.uid !== 'string') continue;
    if (typeof event.description === 'string' && event.description.includes(marker)) {
      return event.uid;
    }
  }
  return null;
}

function getMapping(itemId: string): CalendarMapping | null {
  const row = db
    .prepare('SELECT * FROM service_calendar_events WHERE item_id = ?')
    .get(itemId) as unknown as CalendarMapping | undefined;
  return row ?? null;
}

function saveMapping(itemId: string, uid: string, dueDate: string): void {
  db.prepare(
    `INSERT INTO service_calendar_events (item_id, entity_id, uid, due_date, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       entity_id = excluded.entity_id,
       uid = excluded.uid,
       due_date = excluded.due_date,
       updated_at = excluded.updated_at`
  ).run(itemId, serviceCalendarEntity, uid, dueDate, nowIso());
}

function removeMapping(itemId: string): void {
  db.prepare('DELETE FROM service_calendar_events WHERE item_id = ?').run(itemId);
}

function buildEvent(item: ItemRow, dueDate: string): CalendarEventPayload {
  const summary = `Service: ${item.name}${item.sku ? ` (${item.sku})` : ''}`;
  const lines = [`Service due for ${item.name}.`];
  if (item.service_notes) lines.push('', item.service_notes);
  if (publicBaseUrl) lines.push('', `${publicBaseUrl}/items/${item.id}`);
  lines.push('', serviceMarker(item.id));

  const location = item.location_id
    ? getLocations().find((entry) => entry.id === item.location_id)?.path_label
    : undefined;

  return {
    dtstart: dueDate,
    dtend: shiftDate(dueDate, 1),
    summary: summary.slice(0, 255),
    description: lines.join('\n').slice(0, 5000),
    ...(location ? { location } : {})
  };
}

function getItemRow(itemId: string): ItemRow | null {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as unknown as
    | ItemRow
    | undefined;
  return row ?? null;
}

/**
 * Create, update or remove the all-day calendar event for an item's next due
 * date. Safe to call repeatedly: the event is updated in place when possible,
 * and an existing event is found by its description marker before creating a
 * new one.
 */
export async function syncServiceCalendar(itemId: string): Promise<void> {
  const endpoints = resolveEndpoints();
  if (!endpoints) return;

  const item = getItemRow(itemId);
  if (!item) return;

  const dueDate = item.service_next_due;
  let mapping = getMapping(itemId);

  if (!dueDate) {
    if (mapping) {
      removeMapping(itemId);
      await sendEventCommand(serviceCalendarEntity, 'delete', null, mapping.uid).catch((error) => {
        console.warn('[calendar] Could not remove the service event', error);
      });
    }
    return;
  }

  // The calendar entity may have changed since the event was created.
  if (mapping && mapping.entity_id !== serviceCalendarEntity) {
    removeMapping(itemId);
    await sendEventCommand(mapping.entity_id, 'delete', null, mapping.uid).catch((error) => {
      console.warn('[calendar] Could not remove the old service event', error);
    });
    mapping = null;
  }

  const event = buildEvent(item, dueDate);

  if (mapping) {
    try {
      await sendEventCommand(serviceCalendarEntity, 'update', event, mapping.uid);
      saveMapping(itemId, mapping.uid, dueDate);
      return;
    } catch (error) {
      console.warn('[calendar] Could not update the service event; recreating it', error);
      removeMapping(itemId);
    }
  }

  // Find an event from an earlier run before creating a duplicate. This also
  // recovers when the app created the event but could not read its UID back.
  try {
    const events = await listCalendarEvents(endpoints, dueDate);
    const existingUid = findEventUid(events, itemId);
    if (existingUid) {
      try {
        await sendEventCommand(serviceCalendarEntity, 'update', event, existingUid);
      } catch (error) {
        console.warn('[calendar] Could not update the existing service event', error);
      }
      saveMapping(itemId, existingUid, dueDate);
      return;
    }
  } catch (error) {
    console.warn('[calendar] Could not inspect the service calendar before creating an event', error);
  }

  await sendEventCommand(serviceCalendarEntity, 'create', event);

  try {
    const events = await listCalendarEvents(endpoints, dueDate);
    const uid = findEventUid(events, itemId);
    if (uid) saveMapping(itemId, uid, dueDate);
    else console.warn('[calendar] Created a service event but could not find its UID');
  } catch (error) {
    console.warn('[calendar] Created a service event but could not read it back', error);
  }
}

/** Fire-and-forget sync used by item and service-record mutations. */
export function requestServiceCalendarSync(itemId: string): void {
  if (!serviceCalendarEntity) return;
  void syncServiceCalendar(itemId).catch((error) => {
    console.warn('[calendar] Could not sync the service calendar', error);
  });
}

/**
 * Remove an item's calendar event before the item row (and its mapping) is
 * deleted. The mapping is read synchronously so the background request still
 * has the UID after the cascade delete.
 */
export function deleteServiceCalendarEvent(itemId: string): void {
  const mapping = getMapping(itemId);
  if (!mapping) return;
  removeMapping(itemId);
  void sendEventCommand(mapping.entity_id, 'delete', null, mapping.uid).catch((error) => {
    console.warn('[calendar] Could not remove the service event', error);
  });
}
