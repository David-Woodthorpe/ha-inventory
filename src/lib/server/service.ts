import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { Attachment, ServiceRecord } from '$lib/types';
import { defaultCurrency, pricingEnabled, uploadDir } from './config';
import { db, nowIso, transaction } from './db';
import { notFound } from './errors';
import {
  parseWith,
  serviceRecordCreateSchema,
  serviceRecordUpdateSchema,
  type ServiceRecordInput
} from './schemas';
import { toAttachment, toServiceRecord } from './serialize';
import { requestServiceCalendarSync } from './calendar';

type SqlValue = string | number | null;

interface ServiceItemRow {
  id: string;
  currency: string;
  service_interval_months: number | null;
}

function getServiceItem(itemId: string): ServiceItemRow {
  const row = db
    .prepare('SELECT id, currency, service_interval_months FROM items WHERE id = ?')
    .get(itemId) as unknown as ServiceItemRow | undefined;
  if (!row) throw notFound('Item', itemId);
  return row;
}

function attachmentsForRecords(recordIds: string[]): Map<string, Attachment[]> {
  const byRecord = new Map<string, Attachment[]>();
  if (!recordIds.length) return byRecord;

  const placeholders = recordIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT * FROM attachments
       WHERE service_record_id IN (${placeholders})
       ORDER BY created_at ASC, original_name ASC`
    )
    .all(...recordIds) as unknown as Array<Record<string, unknown>>;

  for (const row of rows) {
    const attachment = toAttachment(row);
    if (!attachment.service_record_id) continue;
    const list = byRecord.get(attachment.service_record_id) ?? [];
    list.push(attachment);
    byRecord.set(attachment.service_record_id, list);
  }
  return byRecord;
}

function hydrateRecord(row: Record<string, unknown>): ServiceRecord {
  const attachments = attachmentsForRecords([String(row.id)]).get(String(row.id)) ?? [];
  return toServiceRecord(row, attachments);
}

export function listServiceRecords(itemId: string): ServiceRecord[] {
  getServiceItem(itemId);
  const rows = db
    .prepare(
      'SELECT * FROM service_records WHERE item_id = ? ORDER BY performed_at DESC, created_at DESC, rowid DESC'
    )
    .all(itemId) as unknown as Array<Record<string, unknown>>;
  const attachments = attachmentsForRecords(rows.map((row) => String(row.id)));
  return rows.map((row) => toServiceRecord(row, attachments.get(String(row.id)) ?? []));
}

export function getServiceRecord(itemId: string, recordId: string): ServiceRecord {
  const row = db
    .prepare('SELECT * FROM service_records WHERE id = ? AND item_id = ?')
    .get(recordId, itemId) as unknown as Record<string, unknown> | undefined;
  if (!row) throw notFound('Service record', recordId);
  return hydrateRecord(row);
}

/**
 * Add months to a date-only string, clamping the day to the target month so
 * 31 January + 1 month becomes 28/29 February instead of rolling into March.
 */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Advance the item's next-due date from its latest service record. This only
 * runs when an interval is configured; an item with no interval keeps whatever
 * next-due date the user entered by hand.
 */
export function syncServiceNextDue(itemId: string): void {
  const item = getServiceItem(itemId);
  const interval = Number(item.service_interval_months ?? 0);
  if (!interval) return;

  const latest = db
    .prepare(
      'SELECT performed_at FROM service_records WHERE item_id = ? ORDER BY performed_at DESC, created_at DESC, rowid DESC LIMIT 1'
    )
    .get(itemId) as unknown as { performed_at: string } | undefined;

  const nextDue = latest ? addMonths(String(latest.performed_at), interval) : null;
  db.prepare('UPDATE items SET service_next_due = ?, updated_at = ? WHERE id = ?').run(
    nextDue,
    nowIso(),
    itemId
  );
}

function withoutPricing(input: unknown): unknown {
  if (pricingEnabled || !input || typeof input !== 'object' || Array.isArray(input)) return input;
  const copy = { ...(input as Record<string, unknown>) };
  delete copy.cost;
  delete copy.currency;
  return copy;
}

export function createServiceRecord(itemId: string, input: unknown): ServiceRecord {
  const item = getServiceItem(itemId);
  const data = parseWith(serviceRecordCreateSchema, withoutPricing(input)) as ServiceRecordInput;

  const id = randomUUID();
  const now = nowIso();
  const cost = data.cost ?? null;
  const currency =
    cost === null ? null : (data.currency || item.currency || defaultCurrency).toUpperCase();

  transaction(() => {
    db.prepare(
      `INSERT INTO service_records
        (id, item_id, performed_at, notes, cost, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, itemId, data.performed_at, data.notes ?? null, cost, currency, now, now);
    syncServiceNextDue(itemId);
  });

  requestServiceCalendarSync(itemId);
  return getServiceRecord(itemId, id);
}

export function updateServiceRecord(
  itemId: string,
  recordId: string,
  input: unknown
): ServiceRecord {
  const item = getServiceItem(itemId);
  const existing = db
    .prepare('SELECT * FROM service_records WHERE id = ? AND item_id = ?')
    .get(recordId, itemId) as unknown as Record<string, unknown> | undefined;
  if (!existing) throw notFound('Service record', recordId);

  const sanitized = withoutPricing(input);
  if (
    !pricingEnabled &&
    sanitized &&
    typeof sanitized === 'object' &&
    !Array.isArray(sanitized) &&
    Object.keys(sanitized).length === 0
  ) {
    return getServiceRecord(itemId, recordId);
  }
  const data = parseWith(serviceRecordUpdateSchema, sanitized) as Record<string, unknown>;

  const fields: string[] = [];
  const values: SqlValue[] = [];

  if ('performed_at' in data) {
    fields.push('performed_at = ?');
    values.push(String(data.performed_at));
  }
  if ('notes' in data) {
    fields.push('notes = ?');
    values.push((data.notes as string | null) ?? null);
  }
  if ('cost' in data || 'currency' in data) {
    const cost = 'cost' in data ? ((data.cost as number | null) ?? null) : (existing.cost as number | null);
    const rawCurrency =
      'currency' in data ? (data.currency as string | null) : (existing.currency as string | null);
    fields.push('cost = ?');
    values.push(cost);
    fields.push('currency = ?');
    values.push(cost === null ? null : (rawCurrency || item.currency || defaultCurrency).toUpperCase());
  }

  if (!fields.length) return getServiceRecord(itemId, recordId);

  fields.push('updated_at = ?');
  values.push(nowIso(), recordId);

  transaction(() => {
    db.prepare(`UPDATE service_records SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    syncServiceNextDue(itemId);
  });

  requestServiceCalendarSync(itemId);
  return getServiceRecord(itemId, recordId);
}

export function deleteServiceRecord(itemId: string, recordId: string): ServiceRecord {
  const record = getServiceRecord(itemId, recordId);
  const files = db
    .prepare('SELECT filename FROM attachments WHERE service_record_id = ?')
    .all(recordId) as unknown as Array<{ filename: string }>;

  transaction(() => {
    db.prepare('DELETE FROM service_records WHERE id = ? AND item_id = ?').run(recordId, itemId);
    syncServiceNextDue(itemId);
  });

  for (const file of files) {
    try {
      rmSync(path.join(uploadDir, file.filename), { force: true });
    } catch {
      // a missing file should not block deleting the record
    }
  }

  requestServiceCalendarSync(itemId);
  return record;
}
