import type { Attachment, Item, Location, ServiceRecord, StockMovement } from '$lib/types';
import { pricingEnabled } from './config';

export type LocationRef = Pick<Location, 'id' | 'name' | 'path' | 'path_ids' | 'path_label'>;

export interface ItemRow {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  category: string | null;
  quantity: number;
  unit: string;
  min_quantity: number;
  location_id: string | null;
  manufacturer: string | null;
  mpn: string | null;
  supplier: string | null;
  supplier_url: string | null;
  price: number | null;
  currency: string;
  datasheet_url: string | null;
  notes: string | null;
  tags: string;
  custom_fields: string;
  archived: number;
  ha_enabled: number;
  service_interval_months: number | null;
  service_next_due: string | null;
  service_notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ItemSummary = Item;

export interface HydrateContext {
  locations: Map<string, Location>;
  attachmentsByItem: Map<string, Attachment[]>;
}

export function toLocationRef(location: Location | undefined): LocationRef | null {
  if (!location) return null;
  return {
    id: location.id,
    name: location.name,
    path: location.path,
    path_ids: location.path_ids,
    path_label: location.path_label
  };
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isServiceDue(nextDue: string | null | undefined): boolean {
  return Boolean(nextDue && nextDue <= todayDate());
}

export function toItem(row: ItemRow, ctx: HydrateContext): ItemSummary {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    tags = [];
  }

  let customFields: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.custom_fields);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) customFields = parsed;
  } catch {
    customFields = {};
  }

  const attachments = ctx.attachmentsByItem.get(row.id) ?? [];
  const photos = attachments.filter((a) => a.kind === 'photo');
  const documents = attachments.filter((a) => a.kind === 'document');
  const location = row.location_id ? ctx.locations.get(row.location_id) : undefined;
  const lowStock = row.min_quantity > 0 && row.quantity <= row.min_quantity;

  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    description: row.description,
    category: row.category,
    quantity: row.quantity,
    unit: row.unit,
    min_quantity: row.min_quantity,
    location_id: row.location_id,
    location: toLocationRef(location),
    manufacturer: row.manufacturer,
    mpn: row.mpn,
    supplier: row.supplier,
    supplier_url: row.supplier_url,
    price: pricingEnabled ? row.price : null,
    currency: row.currency,
    datasheet_url: row.datasheet_url,
    notes: row.notes,
    tags,
    custom_fields: customFields,
    archived: Boolean(row.archived),
    ha_enabled: Boolean(row.ha_enabled),
    low_stock: lowStock,
    total_value: pricingEnabled && row.price !== null ? round2(row.price * row.quantity) : null,
    service_interval_months:
      row.service_interval_months === null || row.service_interval_months === undefined
        ? null
        : Number(row.service_interval_months),
    service_next_due: row.service_next_due ?? null,
    service_notes: row.service_notes ?? null,
    service_due: isServiceDue(row.service_next_due),
    photo: photos[0] ?? null,
    attachment_count: attachments.length,
    photos,
    documents,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function toAttachment(row: Record<string, unknown>): Attachment {
  return {
    id: String(row.id),
    item_id: (row.item_id as string | null) ?? null,
    location_id: (row.location_id as string | null) ?? null,
    service_record_id: (row.service_record_id as string | null) ?? null,
    kind: row.kind as 'photo' | 'document',
    original_name: String(row.original_name),
    mime_type: String(row.mime_type),
    size: Number(row.size),
    caption: (row.caption as string | null) ?? null,
    url: `/media/${String(row.id)}`,
    created_at: String(row.created_at)
  };
}

export function toServiceRecord(
  row: Record<string, unknown>,
  attachments: Attachment[] = []
): ServiceRecord {
  return {
    id: String(row.id),
    item_id: String(row.item_id),
    performed_at: String(row.performed_at),
    notes: (row.notes as string | null) ?? null,
    cost: pricingEnabled && row.cost !== null && row.cost !== undefined ? Number(row.cost) : null,
    currency: (row.currency as string | null) ?? null,
    attachments,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

export function toMovement(row: Record<string, unknown>): StockMovement {
  return {
    id: String(row.id),
    item_id: String(row.item_id),
    delta: Number(row.delta),
    reason: (row.reason as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    created_at: String(row.created_at)
  };
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
