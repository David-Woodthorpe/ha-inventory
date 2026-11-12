import { appVersion, pricingEnabled } from './config';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const attachment = ref('Attachment');
const error = ref('Error');
const location = ref('Location');
const item = ref('Item');
const itemDetail = ref('ItemDetail');

const json = (schema: unknown) => ({ 'application/json': { schema } });

const errorResponses = {
  '400': { description: 'Invalid request', content: json(error) },
  '404': { description: 'Not found', content: json(error) },
  '409': { description: 'Conflict', content: json(error) }
};

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Inventory API',
    version: appVersion,
    description:
      'A small, predictable REST API for a self-hosted electronics and electrical parts inventory. All IDs are UUIDs. Responses are JSON. Errors use {"error":{"code","message","details?"}}.' +
      (pricingEnabled ? '' : ' Pricing and value tracking are disabled on this instance.')
  },
  servers: [{ url: '/api/v1', description: 'This server' }],
  tags: [
    { name: 'Items', description: 'Parts, components, tools and supplies' },
    { name: 'Locations', description: 'Nested storage locations' },
    { name: 'Attachments', description: 'Photos, manuals and other documents' },
    { name: 'Discovery', description: 'Metadata, search and exports' }
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Discovery'],
        summary: 'Health check',
        responses: { '200': { description: 'Service is running', content: json({ type: 'object' }) } }
      }
    },
    '/meta': {
      get: {
        tags: ['Discovery'],
        summary: 'Everything needed to understand the inventory',
        description:
          'Returns stats, categories, tags, units, currencies and all locations. AI agents should call this first.',
        responses: { '200': { description: 'Inventory metadata', content: json({ type: 'object' }) } }
      }
    },
    '/items': {
      get: {
        tags: ['Items'],
        summary: 'List and search items',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Free-text search (all words must match)' },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'tag', in: 'query', schema: { type: 'string' } },
          { name: 'location_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          {
            name: 'include_descendants',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Include items in nested sub-locations'
          },
          { name: 'low_stock', in: 'query', schema: { type: 'boolean' } },
          { name: 'include_archived', in: 'query', schema: { type: 'boolean', default: false } },
          {
            name: 'sort',
            in: 'query',
            schema: { type: 'string', enum: ['name', 'category', 'quantity', 'updated_at', 'created_at', 'value'] }
          },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }
        ],
        responses: {
          '200': {
            description: 'Paginated items',
            content: json({
              type: 'object',
              properties: {
                data: { type: 'array', items: item },
                pagination: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer' },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                    has_more: { type: 'boolean' }
                  }
                }
              }
            })
          }
        }
      },
      post: {
        tags: ['Items'],
        summary: 'Create an item',
        requestBody: { required: true, content: json(ref('ItemInput')) },
        responses: {
          '201': { description: 'Item created', content: json({ type: 'object', properties: { data: itemDetail } }) },
          ...errorResponses
        }
      }
    },
    '/items/bulk': {
      post: {
        tags: ['Items'],
        summary: 'Create up to 500 items in one request',
        description:
          'Partial success is possible. The response contains created items and per-item errors. Returns 207 when some items failed.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: { items: { type: 'array', maxItems: 500, items: ref('ItemInput') } },
            required: ['items']
          })
        },
        responses: {
          '201': { description: 'All items created', content: json({ type: 'object' }) },
          '207': { description: 'Some items created, some failed', content: json({ type: 'object' }) },
          ...errorResponses
        }
      }
    },
    '/items/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Items'],
        summary: 'Get an item with photos, documents and stock history',
        responses: {
          '200': { description: 'Item detail', content: json({ type: 'object', properties: { data: itemDetail } }) },
          '404': errorResponses['404']
        }
      },
      patch: {
        tags: ['Items'],
        summary: 'Update any item fields',
        description: 'Send only the fields you want to change. Quantity changes are logged as corrections.',
        requestBody: { required: true, content: json(ref('ItemInput')) },
        responses: {
          '200': { description: 'Updated item', content: json({ type: 'object', properties: { data: itemDetail } }) },
          ...errorResponses
        }
      },
      delete: {
        tags: ['Items'],
        summary: 'Delete an item and its attachments',
        responses: { '204': { description: 'Deleted' }, '404': errorResponses['404'] }
      }
    },
    '/items/{id}/stock': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      post: {
        tags: ['Items'],
        summary: 'Adjust stock with a delta or absolute value',
        description: 'Send exactly one of delta or set. Negative resulting quantities are rejected with 409.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              delta: { type: 'number', description: 'Amount to add (positive) or remove (negative)' },
              set: { type: 'number', minimum: 0, description: 'New absolute quantity' },
              reason: { type: 'string', example: 'purchase' },
              note: { type: 'string', example: 'Order #1234' }
            }
          })
        },
        responses: {
          '200': { description: 'Updated item', content: json({ type: 'object', properties: { data: itemDetail } }) },
          ...errorResponses
        }
      }
    },
    '/items/{id}/movements': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Items'],
        summary: 'Stock movement history',
        responses: {
          '200': {
            description: 'Movements, newest first',
            content: json({ type: 'object', properties: { data: { type: 'array', items: ref('StockMovement') } } })
          }
        }
      }
    },
    '/locations': {
      get: {
        tags: ['Locations'],
        summary: 'List locations',
        parameters: [
          {
            name: 'tree',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'Return a nested tree instead of a flat list'
          }
        ],
        responses: {
          '200': {
            description: 'Locations with paths and item counts',
            content: json({ type: 'object', properties: { data: { type: 'array', items: location } } })
          }
        }
      },
      post: {
        tags: ['Locations'],
        summary: 'Create a location (optionally nested)',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', example: 'Drawer 1a' },
              parent_id: { type: 'string', format: 'uuid', nullable: true, example: null },
              description: { type: 'string', nullable: true },
              code: { type: 'string', nullable: true },
              sort_order: { type: 'integer', default: 0 },
              ha_enabled: {
                type: 'boolean',
                default: false,
                description: 'Publish this location to Home Assistant. New locations default to false.'
              }
            }
          })
        },
        responses: {
          '201': { description: 'Location created', content: json({ type: 'object', properties: { data: location } }) },
          ...errorResponses
        }
      }
    },
    '/locations/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Locations'],
        summary: 'Get a location with its children and direct items',
        parameters: [
          {
            name: 'include_items',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Set to false to omit the item list'
          }
        ],
        responses: {
          '200': { description: 'Location detail', content: json({ type: 'object' }) },
          '404': errorResponses['404']
        }
      },
      patch: {
        tags: ['Locations'],
        summary: 'Rename or move a location',
        description: 'Cycles are rejected. parent_id can be set to null to move a location to the top level.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              name: { type: 'string' },
              parent_id: { type: 'string', format: 'uuid', nullable: true },
              description: { type: 'string', nullable: true },
              code: { type: 'string', nullable: true },
              sort_order: { type: 'integer' },
              ha_enabled: {
                type: 'boolean',
                description:
                  'Publish this location to Home Assistant. Turning it off also hides its sublocations. Individually published items stay visible.'
              }
            }
          })
        },
        responses: {
          '200': { description: 'Updated location', content: json({ type: 'object', properties: { data: location } }) },
          ...errorResponses
        }
      },
      delete: {
        tags: ['Locations'],
        summary: 'Delete an empty location',
        description: 'Locations containing sub-locations, items or attachments cannot be deleted (409).',
        responses: {
          '204': { description: 'Deleted' },
          '404': errorResponses['404'],
          '409': errorResponses['409']
        }
      }
    },
    '/attachments': {
      get: {
        tags: ['Attachments'],
        summary: 'List attachments',
        parameters: [
          { name: 'item_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'location_id', in: 'query', schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': {
            description: 'Attachments',
            content: json({ type: 'object', properties: { data: { type: 'array', items: attachment } } })
          }
        }
      },
      post: {
        tags: ['Attachments'],
        summary: 'Upload a photo or document',
        description:
          'multipart/form-data. Provide exactly one of item_id or location_id. kind is inferred from the MIME type when omitted.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  item_id: { type: 'string', format: 'uuid' },
                  location_id: { type: 'string', format: 'uuid' },
                  kind: { type: 'string', enum: ['photo', 'document'] },
                  caption: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Uploaded', content: json({ type: 'object', properties: { data: attachment } }) },
          '413': { description: 'File too large', content: json(error) },
          ...errorResponses
        }
      }
    },
    '/attachments/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Attachments'],
        summary: 'Get attachment metadata',
        responses: {
          '200': { description: 'Attachment', content: json({ type: 'object', properties: { data: attachment } }) },
          '404': errorResponses['404']
        }
      },
      delete: {
        tags: ['Attachments'],
        summary: 'Delete an attachment and its file',
        responses: { '204': { description: 'Deleted' }, '404': errorResponses['404'] }
      }
    },
    '/attachments/{id}/file': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        {
          name: 'download',
          in: 'query',
          schema: { type: 'boolean', default: false },
          description: 'Force a download instead of inline display'
        }
      ],
      get: {
        tags: ['Attachments'],
        summary: 'Download or view the file',
        responses: {
          '200': { description: 'The file', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
          '404': errorResponses['404'],
          '410': { description: 'Database row exists but the file is missing from disk', content: json(error) }
        }
      }
    },
    '/search': {
      get: {
        tags: ['Discovery'],
        summary: 'Search items, locations, categories and tags at once',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } }
        ],
        responses: {
          '200': {
            description: 'Grouped search results',
            content: json({
              type: 'object',
              properties: {
                data: {
                  type: 'object',
                  properties: {
                    query: { type: 'string' },
                    items: { type: 'array', items: item },
                    locations: { type: 'array', items: location },
                    categories: { type: 'array', items: { type: 'object' } },
                    tags: { type: 'array', items: { type: 'object' } }
                  }
                }
              }
            })
          }
        }
      }
    },
    '/export': {
      get: {
        tags: ['Discovery'],
        summary: 'Export the whole database as JSON',
        description: 'Attachments are included as metadata; binary files live in the data/uploads directory.',
        responses: {
          '200': {
            description: 'Full JSON export',
            content: { 'application/json': { schema: { type: 'object' } } }
          }
        }
      }
    },
    '/backup': {
      get: {
        tags: ['Discovery'],
        summary: 'Download a consistent SQLite database snapshot',
        description:
          'Creates the snapshot with SQLite VACUUM INTO, so it is safe while the app is running. Uploaded files in data/uploads are not included.',
        responses: {
          '200': {
            description: 'SQLite database file',
            content: {
              'application/vnd.sqlite3': { schema: { type: 'string', format: 'binary' } }
            }
          }
        }
      }
    },
    '/restore': {
      post: {
        tags: ['Discovery'],
        summary: 'Replace the database from a SQLite snapshot',
        description:
          'Destructive. The uploaded file is validated with SQLite integrity, schema version and foreign-key checks before it replaces the current database. Uploaded files in data/uploads are not changed.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } }
              }
            },
            'application/vnd.sqlite3': { schema: { type: 'string', format: 'binary' } }
          }
        },
        responses: {
          '200': {
            description: 'Database restored',
            content: json({
              type: 'object',
              properties: {
                data: {
                  type: 'object',
                  properties: {
                    size: { type: 'integer' },
                    schema_version: { type: 'integer' },
                    item_count: { type: 'integer' },
                    location_count: { type: 'integer' },
                    attachment_count: { type: 'integer' }
                  }
                }
              }
            })
          },
          '400': errorResponses['400'],
          '413': { description: 'File too large', content: json(error) }
        }
      }
    }
  },
  components: {
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'not_found' },
              message: { type: 'string' },
              details: {}
            },
            required: ['code', 'message']
          }
        }
      },
      LocationRef: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          path: { type: 'array', items: { type: 'string' } },
          path_ids: { type: 'array', items: { type: 'string' } },
          path_label: { type: 'string', example: 'Office / Drawer unit 1 / Drawer 1a' }
        }
      },
      Location: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          parent_id: { type: 'string', format: 'uuid', nullable: true },
          description: { type: 'string', nullable: true },
          code: { type: 'string', nullable: true },
          sort_order: { type: 'integer' },
          path: { type: 'array', items: { type: 'string' } },
          path_ids: { type: 'array', items: { type: 'string' } },
          path_label: { type: 'string' },
          depth: { type: 'integer' },
          direct_item_count: { type: 'integer' },
          total_item_count: { type: 'integer' },
          child_count: { type: 'integer' },
          ha_enabled: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      },
      Attachment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          item_id: { type: 'string', format: 'uuid', nullable: true },
          location_id: { type: 'string', format: 'uuid', nullable: true },
          kind: { type: 'string', enum: ['photo', 'document'] },
          original_name: { type: 'string' },
          mime_type: { type: 'string' },
          size: { type: 'integer' },
          caption: { type: 'string', nullable: true },
          url: { type: 'string', example: '/media/2f1c...' },
          created_at: { type: 'string', format: 'date-time' }
        }
      },
      StockMovement: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          item_id: { type: 'string', format: 'uuid' },
          delta: { type: 'number' },
          reason: { type: 'string', nullable: true },
          note: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' }
        }
      },
      ItemInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', example: '10kΩ resistor 0.25W' },
          sku: { type: 'string', nullable: true, example: 'RES-10K-025' },
          description: { type: 'string', nullable: true },
          category: { type: 'string', nullable: true, example: 'Resistors' },
          quantity: { type: 'number', minimum: 0, default: 0 },
          unit: { type: 'string', default: 'pcs', example: 'pcs' },
          min_quantity: { type: 'number', minimum: 0, default: 0 },
          location_id: { type: 'string', format: 'uuid', nullable: true },
          manufacturer: { type: 'string', nullable: true },
          mpn: { type: 'string', nullable: true },
          supplier: { type: 'string', nullable: true },
          supplier_url: { type: 'string', nullable: true },
          ...(pricingEnabled
            ? {
                price: { type: 'number', minimum: 0, nullable: true, description: 'Price per unit' },
                currency: { type: 'string', nullable: true, example: 'GBP' }
              }
            : {}),
          datasheet_url: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' }, example: ['through-hole', '10k'] },
          custom_fields: { type: 'object', additionalProperties: true },
          archived: { type: 'boolean', default: false },
          ha_enabled: {
            type: 'boolean',
            default: false,
            description:
              'Publish this item to Home Assistant via MQTT discovery. New items default to false. Published items stay visible even when their location is hidden.'
          }
        }
      },
      Item: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          sku: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          category: { type: 'string', nullable: true },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          min_quantity: { type: 'number' },
          location_id: { type: 'string', format: 'uuid', nullable: true },
          location: { allOf: [ref('LocationRef')], nullable: true },
          manufacturer: { type: 'string', nullable: true },
          mpn: { type: 'string', nullable: true },
          supplier: { type: 'string', nullable: true },
          supplier_url: { type: 'string', nullable: true },
          ...(pricingEnabled
            ? {
                price: { type: 'number', nullable: true },
                currency: { type: 'string' }
              }
            : {}),
          datasheet_url: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          custom_fields: { type: 'object', additionalProperties: true },
          archived: { type: 'boolean' },
          ha_enabled: { type: 'boolean' },
          low_stock: { type: 'boolean' },
          ...(pricingEnabled ? { total_value: { type: 'number', nullable: true } } : {}),
          photo: { allOf: [attachment], nullable: true },
          attachment_count: { type: 'integer' },
          photos: { type: 'array', items: attachment },
          documents: { type: 'array', items: attachment },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      },
      ItemDetail: {
        allOf: [
          ref('Item'),
          {
            type: 'object',
            properties: {
              movements: { type: 'array', items: ref('StockMovement') }
            }
          }
        ]
      }
    }
  }
};
