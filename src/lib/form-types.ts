import type { CategoryCount, Location, TagCount } from './types';

export interface ItemFormOptions {
  locations: Location[];
  categories: CategoryCount[];
  tags: TagCount[];
  units: string[];
  currencies: string[];
}

export interface CustomFieldValue {
  key: string;
  value: string;
}

export interface ItemFormValues {
  name: string;
  sku: string;
  description: string;
  category: string;
  quantity: string;
  unit: string;
  min_quantity: string;
  location_id: string;
  manufacturer: string;
  mpn: string;
  supplier: string;
  supplier_url: string;
  price: string;
  currency: string;
  datasheet_url: string;
  notes: string;
  tags: string;
  archived: boolean;
  ha_enabled: boolean;
  service_interval_months: string;
  service_next_due: string;
  service_notes: string;
  custom_fields: CustomFieldValue[];
}

export interface LocationFormValues {
  name: string;
  parent_id: string;
  description: string;
  code: string;
  ha_enabled: boolean;
}
