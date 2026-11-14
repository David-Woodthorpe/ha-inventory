import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Attachment } from '$lib/types';
import { maxUploadBytes, uploadDir } from './config';
import { db, nowIso } from './db';
import { ApiError, badRequest, notFound } from './errors';
import { toAttachment } from './serialize';

const mimeExtensions: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/zip': '.zip',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods'
};

const inlineTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'application/pdf',
  'text/plain'
]);

function cleanOriginalName(name: string): string {
  const base = path.basename(name || 'upload');
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'upload';
}

function extensionFor(originalName: string, mimeType: string): string {
  const fromName = path.extname(originalName).toLowerCase();
  if (/^\.[a-z0-9]{1,10}$/.test(fromName)) return fromName;
  return mimeExtensions[mimeType] ?? '';
}

export async function createAttachment(formData: FormData): Promise<Attachment> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    throw badRequest('Attach a non-empty file using the "file" field');
  }
  if (file.size > maxUploadBytes) {
    throw new ApiError(
      413,
      'file_too_large',
      `File is too large. The limit is ${Math.round(maxUploadBytes / (1024 * 1024))} MB.`
    );
  }

  const rawItemId = formData.get('item_id');
  const rawLocationId = formData.get('location_id');
  const rawServiceRecordId = formData.get('service_record_id');
  let itemId = typeof rawItemId === 'string' && rawItemId.trim() ? rawItemId.trim() : null;
  const locationId =
    typeof rawLocationId === 'string' && rawLocationId.trim() ? rawLocationId.trim() : null;
  const serviceRecordId =
    typeof rawServiceRecordId === 'string' && rawServiceRecordId.trim()
      ? rawServiceRecordId.trim()
      : null;

  if (serviceRecordId) {
    // Service receipts belong to an item through the service record. Derive the
    // item so the attachment's existing item/location CHECK stays satisfied.
    const record = db
      .prepare('SELECT item_id FROM service_records WHERE id = ?')
      .get(serviceRecordId) as unknown as { item_id: string } | undefined;
    if (!record) throw notFound('Service record', serviceRecordId);
    if (itemId && itemId !== record.item_id) {
      throw badRequest('The service record does not belong to this item');
    }
    itemId = record.item_id;
  }

  if (Boolean(itemId) === Boolean(locationId)) {
    throw badRequest('Provide exactly one of "item_id" or "location_id"');
  }

  if (itemId) {
    const item = db.prepare('SELECT id FROM items WHERE id = ?').get(itemId);
    if (!item) throw notFound('Item', itemId);
  }
  if (locationId) {
    const location = db.prepare('SELECT id FROM locations WHERE id = ?').get(locationId);
    if (!location) throw notFound('Location', locationId);
  }

  const rawKind = formData.get('kind');
  const mimeType = file.type || 'application/octet-stream';
  let kind: 'photo' | 'document';
  if (typeof rawKind === 'string' && rawKind.trim()) {
    if (rawKind !== 'photo' && rawKind !== 'document') {
      throw badRequest('"kind" must be either "photo" or "document"');
    }
    kind = rawKind;
  } else {
    kind = mimeType.startsWith('image/') ? 'photo' : 'document';
  }

  const rawCaption = formData.get('caption');
  const caption =
    typeof rawCaption === 'string' && rawCaption.trim() ? rawCaption.trim().slice(0, 500) : null;

  const id = randomUUID();
  const originalName = cleanOriginalName(file.name);
  const filename = `${id}${extensionFor(originalName, mimeType)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadDir, filename), buffer);

  db.prepare(
    `INSERT INTO attachments
      (id, item_id, location_id, service_record_id, kind, filename, original_name, mime_type, size, caption, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    itemId,
    locationId,
    serviceRecordId,
    kind,
    filename,
    originalName,
    mimeType,
    file.size,
    caption,
    nowIso()
  );

  const attachment = getAttachment(id);
  return attachment;
}

export function getAttachment(id: string): Attachment {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as unknown as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound('Attachment', id);
  return toAttachment(row);
}

export function listAttachments(filter: {
  item_id?: string;
  location_id?: string;
  service_record_id?: string;
}): Attachment[] {
  let sql = 'SELECT * FROM attachments WHERE 1 = 1';
  const args: string[] = [];
  if (filter.item_id) {
    sql += ' AND item_id = ?';
    args.push(filter.item_id);
  }
  if (filter.location_id) {
    sql += ' AND location_id = ?';
    args.push(filter.location_id);
  }
  if (filter.service_record_id) {
    sql += ' AND service_record_id = ?';
    args.push(filter.service_record_id);
  }
  sql += ' ORDER BY created_at ASC';
  const rows = db.prepare(sql).all(...args) as unknown as Array<Record<string, unknown>>;
  return rows.map(toAttachment);
}

export async function deleteAttachment(id: string): Promise<Attachment> {
  const attachment = getAttachment(id);
  const row = db.prepare('SELECT filename FROM attachments WHERE id = ?').get(id) as unknown as {
    filename: string;
  };
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
  try {
    await unlink(path.join(uploadDir, row.filename));
  } catch {
    // file already gone — nothing else to do
  }
  return attachment;
}

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function attachmentResponse(
  id: string,
  options: { download?: boolean } = {}
): Promise<Response> {
  const attachment = getAttachment(id);
  const row = db.prepare('SELECT filename FROM attachments WHERE id = ?').get(id) as unknown as {
    filename: string;
  };
  const filePath = path.join(uploadDir, row.filename);
  if (!existsSync(filePath)) {
    throw new ApiError(410, 'file_missing', 'The file for this attachment is missing from disk');
  }
  const info = await stat(filePath);
  const inline = !options.download && inlineTypes.has(attachment.mime_type);
  const headers = new Headers({
    'content-type': attachment.mime_type,
    'content-length': String(info.size),
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-disposition': contentDisposition(inline ? 'inline' : 'attachment', attachment.original_name)
  });

  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new Response(webStream, { headers });
}
