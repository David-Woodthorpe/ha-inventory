import type { CategoryCount, Meta, Stats, TagCount } from '$lib/types';
import { defaultCurrency, pricingEnabled } from './config';
import { db } from './db';
import { itemSummaryCounts } from './items';
import { getLocations } from './locations';

export function getStats(): Stats {
  const counts = itemSummaryCounts();
  const locationRow = db.prepare('SELECT COUNT(*) AS count FROM locations').get() as unknown as {
    count: number;
  };
  const attachmentRow = db.prepare('SELECT COUNT(*) AS count FROM attachments').get() as unknown as {
    count: number;
  };
  const categoryRow = db
    .prepare(
      `SELECT COUNT(DISTINCT category) AS count FROM items
       WHERE archived = 0 AND category IS NOT NULL AND category <> ''`
    )
    .get() as unknown as { count: number };
  return {
    item_count: counts.item_count,
    location_count: Number(locationRow.count),
    low_stock_count: counts.low_stock_count,
    total_units: counts.total_units,
    total_value: counts.total_value,
    attachment_count: Number(attachmentRow.count),
    category_count: Number(categoryRow.count),
    currency: defaultCurrency
  };
}

export function getCategories(): CategoryCount[] {
  const rows = db
    .prepare(
      `SELECT category, COUNT(*) AS count FROM items
       WHERE archived = 0 AND category IS NOT NULL AND category <> ''
       GROUP BY category COLLATE NOCASE
       ORDER BY count DESC, category COLLATE NOCASE ASC`
    )
    .all() as unknown as Array<{ category: string; count: number }>;
  return rows.map((row) => ({ category: row.category, count: Number(row.count) }));
}

export function getTags(): TagCount[] {
  const rows = db
    .prepare(
      `SELECT json_each.value AS tag, COUNT(*) AS count
       FROM items, json_each(items.tags)
       WHERE items.archived = 0
       GROUP BY json_each.value COLLATE NOCASE
       ORDER BY count DESC, tag COLLATE NOCASE ASC`
    )
    .all() as unknown as Array<{ tag: string; count: number }>;
  return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
}

export function getUnits(): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT unit FROM items WHERE archived = 0 AND unit IS NOT NULL AND unit <> ''
       ORDER BY unit COLLATE NOCASE`
    )
    .all() as unknown as Array<{ unit: string }>;
  const defaults = ['pcs', 'pack', 'm', 'cm', 'mm', 'g', 'kg', 'ml', 'l', 'roll', 'sheet'];
  return Array.from(new Set([...defaults, ...rows.map((row) => row.unit)])).sort((a, b) =>
    a.localeCompare(b)
  );
}

export function getCurrencies(): string[] {
  if (!pricingEnabled) return [];
  const rows = db
    .prepare('SELECT DISTINCT currency FROM items WHERE currency IS NOT NULL AND currency <> \'\'')
    .all() as unknown as Array<{ currency: string }>;
  return Array.from(new Set([defaultCurrency, ...rows.map((row) => row.currency)])).sort();
}

export function getMeta(): Meta {
  return {
    stats: getStats(),
    categories: getCategories(),
    tags: getTags(),
    units: getUnits(),
    locations: getLocations(),
    currencies: getCurrencies()
  };
}
