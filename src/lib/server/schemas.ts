import { z } from 'zod';
import { ApiError } from './errors';

const emptyToNull = (value: unknown) => {
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
};

const emptyToUndefined = (value: unknown) => {
  if (value === '' || value === null) return undefined;
  return value;
};

const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();

const optionalNumber = (min = 0) =>
  z.preprocess(emptyToUndefined, z.coerce.number().min(min).optional());

const optionalBoolean = z
  .preprocess((value) => {
    if (value === true || value === 'true' || value === '1' || value === 1 || value === 'on') return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    return value;
  }, z.boolean())
  .optional();

const optionalId = z.preprocess(emptyToNull, z.string().trim().max(100).nullable()).optional();

export const itemFields = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  sku: optionalText(120),
  description: optionalText(20000),
  category: optionalText(120),
  quantity: optionalNumber(0),
  unit: z.preprocess(emptyToNull, z.string().trim().min(1).max(24).nullable()).optional(),
  min_quantity: optionalNumber(0),
  location_id: optionalId,
  manufacturer: optionalText(160),
  mpn: optionalText(160),
  supplier: optionalText(160),
  supplier_url: optionalText(2000),
  price: z.preprocess(
    (value) => (value === '' ? null : value),
    z.coerce.number().min(0).nullable()
  ).optional(),
  currency: z.preprocess(emptyToNull, z.string().trim().length(3).transform((v) => v.toUpperCase()).nullable()).optional(),
  datasheet_url: optionalText(2000),
  notes: optionalText(20000),
  tags: z.array(z.string().trim().min(1).max(60)).max(100).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  archived: optionalBoolean
};

export const itemCreateSchema = z.object(itemFields);
export const itemUpdateSchema = z
  .object({ ...itemFields, name: itemFields.name.optional() })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update'
  });

export type ItemInput = z.infer<typeof itemCreateSchema>;

export const stockAdjustSchema = z
  .object({
    delta: optionalNumber(Number.NEGATIVE_INFINITY),
    set: optionalNumber(0),
    reason: optionalText(80),
    note: optionalText(1000)
  })
  .refine((value) => (value.delta === undefined) !== (value.set === undefined), {
    message: 'Provide exactly one of "delta" or "set"'
  });

export const locationCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  parent_id: optionalId,
  description: optionalText(2000),
  code: optionalText(60),
  sort_order: optionalNumber(Number.NEGATIVE_INFINITY)
});

export const locationUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    parent_id: optionalId,
    description: optionalText(2000),
    code: optionalText(60),
    sort_order: optionalNumber(Number.NEGATIVE_INFINITY)
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update'
  });

export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, 'validation_error', 'Some fields are invalid', formatZodIssues(result.error));
  }
  return result.data;
}

export function formatZodIssues(error: z.ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : '(body)',
    message: issue.message
  }));
}
