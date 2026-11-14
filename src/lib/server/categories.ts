import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, rmSync } from 'node:fs';
import { stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { isIconName } from '$lib/icons';
import type { Category, CategoryCount } from '$lib/types';
import { maxUploadBytes, uploadDir } from './config';
import { db, nowIso, transaction } from './db';
import { ApiError, badRequest, conflict, notFound } from './errors';
import { categoryCreateSchema, categoryUpdateSchema, parseWith } from './schemas';

interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  image_filename: string | null;
  image_mime_type: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const categoryImageExtensions: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico'
};

function imageUrl(id: string | null, filename: string | null, updatedAt: string | null): string | null {
  if (!id || !filename) return null;
  return `/categories/${id}/image?v=${encodeURIComponent(updatedAt ?? '')}`;
}

function toCategory(row: CategoryRow, itemCount = 0): Category {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    image_url: imageUrl(row.id, row.image_filename, row.updated_at),
    image_mime_type: row.image_mime_type,
    sort_order: Number(row.sort_order),
    item_count: Number(itemCount),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/** All managed categories with the number of items assigned to each. */
export function listCategories(): Category[] {
  const rows = db
    .prepare(
      `SELECT c.*, COUNT(i.id) AS item_count
       FROM categories c
       LEFT JOIN items i ON i.category = c.name COLLATE NOCASE
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC`
    )
    .all() as unknown as Array<CategoryRow & { item_count: number }>;
  return rows.map((row) => toCategory(row, row.item_count));
}

export function getCategory(id: string): Category {
  const row = db
    .prepare(
      `SELECT c.*, (
         SELECT COUNT(*) FROM items i
         WHERE i.category = c.name COLLATE NOCASE
       ) AS item_count
       FROM categories c WHERE c.id = ?`
    )
    .get(id) as unknown as (CategoryRow & { item_count: number }) | undefined;
  if (!row) throw notFound('Category', id);
  return toCategory(row, row.item_count);
}

/** Case-insensitive lookup used when decorating items with category icons/images. */
export function categoryLookup(): Map<string, Category> {
  const rows = db.prepare('SELECT * FROM categories').all() as unknown as CategoryRow[];
  return new Map(rows.map((row) => [row.name.toLowerCase(), toCategory(row)]));
}

/**
 * Category names and active item counts. Orphan names are included so data
 * written by an older version or an external tool is never hidden.
 */
export function listCategoryCounts(): CategoryCount[] {
  const rows = db
    .prepare(
      `SELECT c.id AS id, c.name AS category, c.icon AS icon,
              c.image_filename AS image_filename, c.updated_at AS updated_at,
              COUNT(i.id) AS count
       FROM categories c
       LEFT JOIN items i ON i.category = c.name COLLATE NOCASE AND i.archived = 0
       GROUP BY c.id
       UNION ALL
       SELECT NULL AS id, MIN(i.category) AS category, NULL AS icon,
              NULL AS image_filename, MAX(i.updated_at) AS updated_at,
              COUNT(*) AS count
       FROM items i
       WHERE i.archived = 0 AND i.category IS NOT NULL AND i.category <> ''
         AND NOT EXISTS (
           SELECT 1 FROM categories c WHERE c.name = i.category COLLATE NOCASE
         )
       GROUP BY i.category COLLATE NOCASE
       ORDER BY count DESC, category COLLATE NOCASE ASC`
    )
    .all() as unknown as Array<{
    id: string | null;
    category: string;
    icon: string | null;
    image_filename: string | null;
    updated_at: string | null;
    count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    count: Number(row.count),
    icon: row.icon,
    image_url: imageUrl(row.id, row.image_filename, row.updated_at)
  }));
}

function ensureNameAvailable(name: string, excludeId = ''): void {
  const row = db
    .prepare('SELECT id, name FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?')
    .get(name, excludeId) as unknown as { id: string; name: string } | undefined;
  if (row) {
    throw conflict(`A category named "${row.name}" already exists`, { category_id: row.id });
  }
}

function normalizeIcon(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!isIconName(value)) {
    throw badRequest('Unknown icon name. Choose one of the built-in category icons.');
  }
  return value;
}

/**
 * Return a canonical category name for an item. New names are added to the
 * categories table so an item created through the API immediately gains a
 * managed category with an icon/image fallback.
 */
export function ensureCategory(name: string | null | undefined): string | null {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return null;
  const existing = db
    .prepare('SELECT name FROM categories WHERE name = ? COLLATE NOCASE')
    .get(trimmed) as unknown as { name: string } | undefined;
  if (existing) return existing.name;

  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    'INSERT INTO categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
  ).run(id, trimmed, now, now);
  return trimmed;
}

export function createCategory(input: unknown): Category {
  const data = parseWith(categoryCreateSchema, input);
  ensureNameAvailable(data.name);
  const icon = normalizeIcon(data.icon);
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO categories (id, name, description, icon, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, data.name, data.description ?? null, icon, data.sort_order ?? 0, now, now);
  return getCategory(id);
}

export function updateCategory(id: string, input: unknown): Category {
  const existing = getCategory(id);
  const data = parseWith(categoryUpdateSchema, input);

  if (data.name !== undefined) ensureNameAvailable(data.name, id);

  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  if (data.name !== undefined) {
    fields.push('name = ?');
    values.push(data.name);
  }
  if ('description' in data) {
    fields.push('description = ?');
    values.push(data.description ?? null);
  }
  if ('icon' in data) {
    fields.push('icon = ?');
    values.push(normalizeIcon(data.icon));
  }
  if (data.sort_order !== undefined) {
    fields.push('sort_order = ?');
    values.push(data.sort_order);
  }
  if (!fields.length) return existing;

  const nextName = data.name ?? existing.name;
  fields.push('updated_at = ?');
  values.push(nowIso(), id);

  transaction(() => {
    db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (data.name !== undefined && nextName !== existing.name) {
      db.prepare('UPDATE items SET category = ? WHERE category = ? COLLATE NOCASE').run(
        nextName,
        existing.name
      );
    }
  });

  return getCategory(id);
}

/**
 * Delete a category and uncategorise its items. The items themselves are kept;
 * only the category label is cleared.
 */
export function deleteCategory(id: string): void {
  const existing = getCategory(id);
  const row = db.prepare('SELECT image_filename FROM categories WHERE id = ?').get(id) as unknown as {
    image_filename: string | null;
  };
  transaction(() => {
    db.prepare('UPDATE items SET category = NULL WHERE category = ? COLLATE NOCASE').run(
      existing.name
    );
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  });
  if (row?.image_filename) {
    rmSync(path.join(uploadDir, row.image_filename), { force: true });
  }
}

export function validateCategoryImage(file: unknown): File | null {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > maxUploadBytes) {
    throw new ApiError(
      413,
      'file_too_large',
      `Image is too large. The limit is ${Math.round(maxUploadBytes / (1024 * 1024))} MB.`
    );
  }
  if (!categoryImageExtensions[file.type]) {
    throw badRequest('Upload a JPEG, PNG, WebP, GIF, AVIF, BMP or SVG image.');
  }
  return file;
}

export async function setCategoryImage(id: string, file: File): Promise<Category> {
  const row = db.prepare('SELECT image_filename FROM categories WHERE id = ?').get(id) as unknown as
    | { image_filename: string | null }
    | undefined;
  if (!row) throw notFound('Category', id);

  const image = validateCategoryImage(file);
  if (!image) throw badRequest('Attach a non-empty image using the "file" field');

  const extension = categoryImageExtensions[image.type] ?? '';
  const filename = `category-${id}-${randomUUID()}${extension}`;
  const buffer = Buffer.from(await image.arrayBuffer());
  await writeFile(path.join(uploadDir, filename), buffer);

  db.prepare(
    'UPDATE categories SET image_filename = ?, image_mime_type = ?, updated_at = ? WHERE id = ?'
  ).run(filename, image.type, nowIso(), id);

  if (row.image_filename) {
    try {
      await unlink(path.join(uploadDir, row.image_filename));
    } catch {
      // a missing old file should not block the replacement
    }
  }

  return getCategory(id);
}

export async function removeCategoryImage(id: string): Promise<Category> {
  const row = db.prepare('SELECT image_filename FROM categories WHERE id = ?').get(id) as unknown as
    | { image_filename: string | null }
    | undefined;
  if (!row) throw notFound('Category', id);

  if (row.image_filename) {
    db.prepare(
      'UPDATE categories SET image_filename = NULL, image_mime_type = NULL, updated_at = ? WHERE id = ?'
    ).run(nowIso(), id);
    try {
      await unlink(path.join(uploadDir, row.image_filename));
    } catch {
      // file already gone — nothing else to do
    }
  }

  return getCategory(id);
}

export async function categoryImageResponse(id: string): Promise<Response> {
  const row = db
    .prepare('SELECT image_filename, image_mime_type FROM categories WHERE id = ?')
    .get(id) as unknown as
    | { image_filename: string | null; image_mime_type: string | null }
    | undefined;
  if (!row) throw notFound('Category', id);
  if (!row.image_filename || !row.image_mime_type) throw notFound('Category image', id);

  const filePath = path.join(uploadDir, row.image_filename);
  if (!existsSync(filePath)) {
    throw new ApiError(410, 'file_missing', 'The category image is missing from disk');
  }
  const info = await stat(filePath);
  const headers = new Headers({
    'content-type': row.image_mime_type,
    'content-length': String(info.size),
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff'
  });
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new Response(webStream, { headers });
}
