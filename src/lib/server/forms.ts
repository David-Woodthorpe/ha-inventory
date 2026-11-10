import type { Item, Location } from '$lib/types';
import type { ItemFormValues, LocationFormValues } from '$lib/form-types';

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function emptyItemFormValues(currency = 'GBP'): ItemFormValues {
  return {
    name: '',
    sku: '',
    description: '',
    category: '',
    quantity: '0',
    unit: 'pcs',
    min_quantity: '0',
    location_id: '',
    manufacturer: '',
    mpn: '',
    supplier: '',
    supplier_url: '',
    price: '',
    currency,
    datasheet_url: '',
    notes: '',
    tags: '',
    archived: false,
    custom_fields: []
  };
}

export function itemToFormValues(item: Item): ItemFormValues {
  return {
    name: item.name,
    sku: item.sku ?? '',
    description: item.description ?? '',
    category: item.category ?? '',
    quantity: String(item.quantity),
    unit: item.unit,
    min_quantity: String(item.min_quantity),
    location_id: item.location_id ?? '',
    manufacturer: item.manufacturer ?? '',
    mpn: item.mpn ?? '',
    supplier: item.supplier ?? '',
    supplier_url: item.supplier_url ?? '',
    price: item.price === null ? '' : String(item.price),
    currency: item.currency,
    datasheet_url: item.datasheet_url ?? '',
    notes: item.notes ?? '',
    tags: item.tags.join(', '),
    archived: item.archived,
    custom_fields: Object.entries(item.custom_fields).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value)
    }))
  };
}

function customFieldRows(form: FormData): Array<{ key: string; value: string }> {
  const keys = form.getAll('custom_key');
  const values = form.getAll('custom_value');
  const rows: Array<{ key: string; value: string }> = [];
  keys.forEach((key, index) => {
    const cleanKey = typeof key === 'string' ? key.trim() : '';
    if (!cleanKey) return;
    const value = values[index];
    rows.push({ key: cleanKey, value: typeof value === 'string' ? value.trim() : '' });
  });
  return rows;
}

export function readItemForm(form: FormData): { values: ItemFormValues; input: Record<string, unknown> } {
  const customRows = customFieldRows(form);
  const values: ItemFormValues = {
    name: text(form, 'name'),
    sku: text(form, 'sku'),
    description: text(form, 'description'),
    category: text(form, 'category'),
    quantity: text(form, 'quantity') || '0',
    unit: text(form, 'unit') || 'pcs',
    min_quantity: text(form, 'min_quantity') || '0',
    location_id: text(form, 'location_id'),
    manufacturer: text(form, 'manufacturer'),
    mpn: text(form, 'mpn'),
    supplier: text(form, 'supplier'),
    supplier_url: text(form, 'supplier_url'),
    price: text(form, 'price'),
    currency: text(form, 'currency').toUpperCase(),
    datasheet_url: text(form, 'datasheet_url'),
    notes: text(form, 'notes'),
    tags: text(form, 'tags'),
    archived: form.get('archived') === 'on',
    custom_fields: customRows
  };

  const customFields: Record<string, string> = {};
  for (const row of customRows) customFields[row.key] = row.value;

  const input = {
    name: values.name,
    sku: values.sku,
    description: values.description,
    category: values.category,
    quantity: values.quantity,
    unit: values.unit,
    min_quantity: values.min_quantity,
    location_id: values.location_id,
    manufacturer: values.manufacturer,
    mpn: values.mpn,
    supplier: values.supplier,
    supplier_url: values.supplier_url,
    price: values.price === '' ? null : values.price,
    currency: values.currency,
    datasheet_url: values.datasheet_url,
    notes: values.notes,
    tags: values.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    custom_fields: customFields,
    archived: values.archived
  };

  return { values, input };
}

export function emptyLocationFormValues(parentId = ''): LocationFormValues {
  return { name: '', parent_id: parentId, description: '', code: '' };
}

export function locationToFormValues(location: Location): LocationFormValues {
  return {
    name: location.name,
    parent_id: location.parent_id ?? '',
    description: location.description ?? '',
    code: location.code ?? ''
  };
}

export function readLocationForm(form: FormData): {
  values: LocationFormValues;
  input: Record<string, unknown>;
} {
  const values: LocationFormValues = {
    name: text(form, 'name'),
    parent_id: text(form, 'parent_id'),
    description: text(form, 'description'),
    code: text(form, 'code')
  };
  return {
    values,
    input: {
      name: values.name,
      parent_id: values.parent_id,
      description: values.description,
      code: values.code
    }
  };
}
