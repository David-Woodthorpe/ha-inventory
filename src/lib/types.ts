export interface LocationRef {
  id: string;
  name: string;
  path: string[];
  path_ids: string[];
  path_label: string;
}

export interface Location {
  id: string;
  name: string;
  parent_id: string | null;
  description: string | null;
  code: string | null;
  sort_order: number;
  path: string[];
  path_ids: string[];
  path_label: string;
  depth: number;
  direct_item_count: number;
  total_item_count: number;
  child_count: number;
  created_at: string;
  updated_at: string;
}

export interface LocationNode extends Location {
  children: LocationNode[];
}

export interface Attachment {  id: string;
  item_id: string | null;
  location_id: string | null;
  kind: 'photo' | 'document';
  original_name: string;
  mime_type: string;
  size: number;
  caption: string | null;
  url: string;
  created_at: string;
}

export interface StockMovement {
  id: string;
  item_id: string;
  delta: number;
  reason: string | null;
  note: string | null;
  created_at: string;
}

export interface Item {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  category: string | null;
  quantity: number;
  unit: string;
  min_quantity: number;
  location_id: string | null;
  location: LocationRef | null;
  manufacturer: string | null;
  mpn: string | null;
  supplier: string | null;
  supplier_url: string | null;
  price: number | null;
  currency: string;
  datasheet_url: string | null;
  notes: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  archived: boolean;
  low_stock: boolean;
  total_value: number | null;
  photo: Attachment | null;
  attachment_count: number;
  photos: Attachment[];
  documents: Attachment[];
  created_at: string;
  updated_at: string;
}

export interface ItemDetail extends Item {
  movements: StockMovement[];
}

export interface ItemListResult {
  items: Item[];
  total: number;
}

export interface ItemListParams {
  q?: string;
  category?: string;
  tag?: string;
  location_id?: string;
  include_descendants?: boolean;
  low_stock?: boolean;
  include_archived?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface Stats {
  item_count: number;
  location_count: number;
  low_stock_count: number;
  total_units: number;
  total_value: number;
  attachment_count: number;
  category_count: number;
  currency: string;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface Meta {
  stats: Stats;
  categories: CategoryCount[];
  tags: TagCount[];
  units: string[];
  locations: Location[];
  currencies: string[];
}
