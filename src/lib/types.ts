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
  ha_enabled: boolean;
  /** Container grid dimensions in cells, or null when this location has no map. */
  grid_cols: number | null;
  grid_rows: number | null;
  /** Placement of this location inside its parent's grid, or null when unplaced. */
  grid_x: number | null;
  grid_y: number | null;
  /** Unrotated footprint of this location's bin, in cells. */
  grid_w: number | null;
  grid_h: number | null;
  /** Rotation of the bin inside its cell footprint, in degrees. */
  grid_rot: number;
  /** True for the one location that holds parts not filed yet. */
  is_staging: boolean;
  /** Rack height in U slots, or null when this location is not a rack. */
  rack_units: number | null;
  created_at: string;
  updated_at: string;
}

export interface LocationNode extends Location {
  children: LocationNode[];
}

/** An item held by a bin, with the quantity stored there. */
export interface BinItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
}

/** A bin placed on its parent container's grid map. */
export interface DrawerBin {
  location_id: string;
  name: string;
  code: string | null;
  /** Origin cell of the rotated footprint, zero-based, counted from the front-left. */
  x: number;
  y: number;
  /** Effective footprint in cells, after rotation. */
  w: number;
  h: number;
  /** The bin's own footprint, before rotation. */
  base_w: number;
  base_h: number;
  /** Rotation in degrees: 0, 90, 180 or 270. */
  rotation: number;
  item_count: number;
  unit_count: number;
  /** What is actually stored in the bin, newest of the map view. */
  items: BinItem[];
}

/**
 * An item sitting in a container rather than in one of its bins. The two
 * quantities differ when only part of the stock lives in this container.
 */
export interface LooseItem {
  id: string;
  name: string;
  unit: string;
  /** Total on hand across every location. */
  quantity: number;
  /** How many of those are held by this container itself. */
  loose_quantity: number;
}

/** A drawer's grid with one placed bin picked out, for showing on an item. */
export interface DrawerMapSummary {
  drawer: { id: string; name: string; path_label: string };
  cols: number;
  rows: number;
  bins: Array<{ location_id: string; name: string; x: number; y: number; w: number; h: number }>;
  /** Bins on this map that hold the item being viewed. */
  highlight: string[];
}

/** Something mounted in a rack slot: an item (equipment) or a shelf (a location). */
export interface RackMount {
  id: string;
  type: 'item' | 'location';
  ref_id: string;
  name: string;
  code: string | null;
  u_start: number;
  u_height: number;
  /** For an item: whether it is stored in this rack or below it. */
  stored_here: boolean;
  note: string | null;
}

/** A rack and its elevation, ordered from the bottom slot upwards. */
export interface RackView {
  location: Location;
  units: number | null;
  mounts: RackMount[];
  used_units: number;
  free_units: number;
}

/** The staging area: where parts wait until they are filed. */
export interface StagingArea {
  location: Location;
  items: LooseItem[];
}

/** The map of one partitioned container: its grid plus what is placed on it. */
export interface DrawerLayout {
  location: Location;
  cols: number | null;
  rows: number | null;
  used_cells: number;
  free_cells: number;
  bins: DrawerBin[];
  /** Child locations that exist but have no position on the grid yet. */
  unplaced_bins: Location[];
  /** Items held directly by the container, outside any bin. */
  loose_items: LooseItem[];
}

/** A managed category, optionally decorated with an icon or an image. */
export interface Category {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  image_url: string | null;
  image_mime_type: string | null;
  sort_order: number;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  item_id: string | null;
  location_id: string | null;
  service_record_id: string | null;
  kind: 'photo' | 'document';
  original_name: string;
  mime_type: string;
  size: number;
  caption: string | null;
  url: string;
  created_at: string;
}

export interface ServiceRecord {
  id: string;
  item_id: string;
  performed_at: string;
  notes: string | null;
  cost: number | null;
  currency: string | null;
  attachments: Attachment[];
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: string;
  item_id: string;
  delta: number;
  reason: string | null;
  note: string | null;
  location_id: string | null;
  location: LocationRef | null;
  to_location_id: string | null;
  to_location: LocationRef | null;
  created_at: string;
}

/** Minimal item reference used by allocations and pickers. */
export interface ItemRef {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
}

/** A quantity of one item held at one location. */
export interface ItemStockLot {
  id: string;
  item_id: string;
  location_id: string | null;
  location: LocationRef | null;
  quantity: number;
  created_at: string;
  updated_at: string;
}

/**
 * A component signed out to a host item. The component's stock has already
 * been removed; returning the allocation puts it back into stock.
 */
export interface ItemAllocation {
  id: string;
  component_item_id: string;
  component: ItemRef;
  host_item_id: string;
  host: ItemRef;
  quantity: number;
  source_location_id: string | null;
  source_location: LocationRef | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  category: string | null;
  /** Fallback icon from the item's category, used when the item has no photo. */
  category_icon: string | null;
  /** Fallback image from the item's category, used when the item has no photo. */
  category_image_url: string | null;
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
  ha_enabled: boolean;
  low_stock: boolean;
  total_value: number | null;
  service_interval_months: number | null;
  service_next_due: string | null;
  service_notes: string | null;
  service_due: boolean;
  photo: Attachment | null;
  attachment_count: number;
  photos: Attachment[];
  documents: Attachment[];
  created_at: string;
  updated_at: string;
}

export interface ItemDetail extends Item {
  stock: ItemStockLot[];
  components: ItemAllocation[];
  assigned_to: ItemAllocation[];
  movements: StockMovement[];
  service_records: ServiceRecord[];
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
  total_value: number | null;
  attachment_count: number;
  category_count: number;
  currency: string;
}

export interface CategoryCount {
  /** Null for a legacy category name found on an item but not in the categories table. */
  id: string | null;
  category: string;
  count: number;
  icon: string | null;
  image_url: string | null;
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
