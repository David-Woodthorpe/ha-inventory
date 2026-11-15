import { appVersion, pricingEnabled } from './config';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const attachment = ref('Attachment');
const error = ref('Error');
const location = ref('Location');
const category = ref('Category');
const item = ref('Item');
const itemDetail = ref('ItemDetail');
const serviceRecord = ref('ServiceRecord');
const stockLot = ref('ItemStockLot');
const allocation = ref('ItemAllocation');

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
    { name: 'Stock', description: 'Per-location stock and components signed out to other items' },
    { name: 'Locations', description: 'Nested storage locations' },
    { name: 'Categories', description: 'Managed item categories with optional icon or image' },
    { name: 'Service', description: 'Optional maintenance history and recurring service schedules' },
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
    '/items/move': {
      post: {
        tags: ['Stock'],
        summary: 'Move every unit of several items to one location',
        description:
          'Batch equivalent of changing an item\'s location: each item\'s stock lots are consolidated into the destination and item totals are unchanged. Every item is moved in its own transaction, so partial success is possible. Returns 207 when some items failed.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['item_ids', 'to_location_id'],
            properties: {
              item_ids: {
                type: 'array',
                minItems: 1,
                maxItems: 500,
                items: { type: 'string', format: 'uuid' }
              },
              to_location_id: { type: 'string', format: 'uuid' },
              note: { type: 'string', nullable: true }
            }
          })
        },
        responses: {
          '200': {
            description: 'All items moved',
            content: json({
              type: 'object',
              properties: {
                data: {
                  type: 'object',
                  properties: {
                    moved: { type: 'array', items: { type: 'string' } },
                    errors: { type: 'array', items: { type: 'object' } },
                    moved_count: { type: 'integer' },
                    error_count: { type: 'integer' }
                  }
                }
              }
            })
          },
          '207': { description: 'Some items moved, some failed', content: json({ type: 'object' }) },
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
      get: {
        tags: ['Stock'],
        summary: 'Per-location stock breakdown',
        responses: {
          '200': {
            description: 'Stock lots for the item',
            content: json({ type: 'object', properties: { data: { type: 'array', items: stockLot } } })
          },
          '404': errorResponses['404']
        }
      },
      post: {
        tags: ['Stock'],
        summary: 'Adjust stock with a delta or absolute value',
        description:
          'Send exactly one of delta or set. An optional location_id targets a specific lot; positive changes land there and negative changes come from there first. Negative resulting quantities are rejected with 409.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              delta: { type: 'number', description: 'Amount to add (positive) or remove (negative)' },
              set: { type: 'number', minimum: 0, description: 'New absolute quantity' },
              location_id: { type: 'string', format: 'uuid', nullable: true, description: 'Optional stock lot to adjust first' },
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
    '/items/{id}/transfer': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      post: {
        tags: ['Stock'],
        summary: 'Transfer part of an item between locations',
        description:
          'Moves a quantity from one stock lot to another without changing the item total. The destination may be null for unassigned stock. The response is the updated item detail.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['from_location_id', 'quantity'],
            properties: {
              from_location_id: { type: 'string', format: 'uuid', nullable: true },
              to_location_id: { type: 'string', format: 'uuid', nullable: true },
              quantity: { type: 'number', exclusiveMinimum: 0 },
              note: { type: 'string', nullable: true }
            }
          })
        },
        responses: {
          '200': { description: 'Updated item', content: json({ type: 'object', properties: { data: itemDetail } }) },
          ...errorResponses
        }
      }
    },
    '/items/{id}/components': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Stock'],
        summary: 'Components installed in this item',
        responses: {
          '200': {
            description: 'Active allocations where this item is the host',
            content: json({ type: 'object', properties: { data: { type: 'array', items: allocation } } })
          },
          '404': errorResponses['404']
        }
      },
      post: {
        tags: ['Stock'],
        summary: 'Sign a component out to this item',
        description:
          'Removes stock from the component immediately and records it as installed in this host item. Omit source_location_id to use the location holding the most stock. The response contains the allocation and the updated host item.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['component_item_id', 'quantity'],
            properties: {
              component_item_id: { type: 'string', format: 'uuid' },
              quantity: { type: 'number', exclusiveMinimum: 0 },
              source_location_id: { type: 'string', format: 'uuid', nullable: true },
              note: { type: 'string', nullable: true }
            }
          })
        },
        responses: {
          '201': { description: 'Component signed out', content: json({ type: 'object' }) },
          ...errorResponses
        }
      }
    },
    '/items/{id}/components/{allocationId}/return': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'allocationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
      ],
      post: {
        tags: ['Stock'],
        summary: 'Return a signed-out component to stock',
        description:
          'Returns all or part of an allocation to its source location. Omit quantity to return everything. Returns null when the allocation is fully returned.',
        requestBody: {
          required: false,
          content: json({
            type: 'object',
            properties: {
              quantity: { type: 'number', exclusiveMinimum: 0 },
              note: { type: 'string', nullable: true }
            }
          })
        },
        responses: {
          '200': { description: 'Remaining allocation, or null', content: json({ type: 'object' }) },
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
    '/items/{id}/service': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Service'],
        summary: 'List service history for an item',
        responses: {
          '200': {
            description: 'Service records, newest first',
            content: json({
              type: 'object',
              properties: { data: { type: 'array', items: serviceRecord } }
            })
          },
          '404': errorResponses['404']
        }
      },
      post: {
        tags: ['Service'],
        summary: 'Log a service record',
        description:
          'When the item has a service interval, the next due date is advanced from the latest record date. A Home Assistant calendar event is created or moved when calendar sync is configured.',
        requestBody: { required: true, content: json(ref('ServiceRecordInput')) },
        responses: {
          '201': {
            description: 'Service record created',
            content: json({ type: 'object', properties: { data: serviceRecord } })
          },
          ...errorResponses
        }
      }
    },
    '/items/{id}/service/{recordId}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'recordId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
      ],
      get: {
        tags: ['Service'],
        summary: 'Get a service record',
        responses: {
          '200': {
            description: 'Service record',
            content: json({ type: 'object', properties: { data: serviceRecord } })
          },
          '404': errorResponses['404']
        }
      },
      patch: {
        tags: ['Service'],
        summary: 'Update a service record',
        requestBody: { required: true, content: json(ref('ServiceRecordInput')) },
        responses: {
          '200': {
            description: 'Updated service record',
            content: json({ type: 'object', properties: { data: serviceRecord } })
          },
          ...errorResponses
        }
      },
      delete: {
        tags: ['Service'],
        summary: 'Delete a service record and its attachments',
        responses: { '204': { description: 'Deleted' }, '404': errorResponses['404'] }
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
              },
              grid_cols: {
                type: 'integer',
                nullable: true,
                description: 'Turn this location into a grid map with this many cells across'
              },
              grid_rows: { type: 'integer', nullable: true, description: 'Cells front to back' }
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
              },
              grid_cols: { type: 'integer', nullable: true },
              grid_rows: { type: 'integer', nullable: true }
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
    '/locations/{id}/layout': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Locations'],
        summary: 'Read the grid map of a drawer or other partitioned container',
        description:
          'Returns the grid size, every placed bin with its origin and rotated footprint, the child locations that are not placed yet, and any items sitting in the container outside a bin. Cells are counted from the front-left corner: x grows to the right, y grows away from the front. A location without grid_cols/grid_rows returns null dimensions and no bins.',
        responses: {
          '200': { description: 'Layout', content: json({ type: 'object', properties: { data: ref('DrawerLayout') } }) },
          '404': errorResponses['404']
        }
      },
      put: {
        tags: ['Locations'],
        summary: 'Replace the placements on a grid map',
        description:
          'The payload is a whole map, not a patch: any child left out becomes unplaced. Overlaps, out-of-bounds footprints and children of another location are rejected (409/400). Send {"bins": []} to clear the map. Bins are child locations, so moving one to another drawer is PATCH /locations/{id} with parent_id, which clears its position.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['bins'],
            properties: {
              bins: {
                type: 'array',
                maxItems: 500,
                items: {
                  type: 'object',
                  required: ['location_id', 'x', 'y', 'w', 'h'],
                  properties: {
                    location_id: { type: 'string', format: 'uuid' },
                    x: { type: 'integer', minimum: 0 },
                    y: { type: 'integer', minimum: 0 },
                    w: { type: 'integer', minimum: 1 },
                    h: { type: 'integer', minimum: 1 },
                    rotation: {
                      type: 'integer',
                      enum: [0, 90],
                      description: 'Orientation: 0 is portrait, 90 is landscape. 90 swaps the effective width and depth.'
                    }
                  }
                }
              }
            }
          })
        },
        responses: {
          '200': { description: 'Saved layout', content: json({ type: 'object', properties: { data: ref('DrawerLayout') } }) },
          ...errorResponses
        }
      }
    },
    '/categories': {
      get: {
        tags: ['Categories'],
        summary: 'List categories',
        description:
          'Returns every managed category with its item count and optional icon/image. Categories are also included in GET /meta.',
        responses: {
          '200': {
            description: 'Categories',
            content: json({ type: 'object', properties: { data: { type: 'array', items: category } } })
          }
        }
      },
      post: {
        tags: ['Categories'],
        summary: 'Create a category',
        requestBody: { required: true, content: json(ref('CategoryInput')) },
        responses: {
          '201': { description: 'Category created', content: json({ type: 'object', properties: { data: category } }) },
          ...errorResponses
        }
      }
    },
    '/categories/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Categories'],
        summary: 'Get a category',
        responses: {
          '200': { description: 'Category', content: json({ type: 'object', properties: { data: category } }) },
          '404': errorResponses['404']
        }
      },
      patch: {
        tags: ['Categories'],
        summary: 'Rename or update a category',
        description:
          'Renaming a category updates items.category for every item that used the old name. Name matching is case-insensitive.',
        requestBody: { required: true, content: json(ref('CategoryInput')) },
        responses: {
          '200': { description: 'Updated category', content: json({ type: 'object', properties: { data: category } }) },
          ...errorResponses
        }
      },
      delete: {
        tags: ['Categories'],
        summary: 'Delete a category',
        description:
          'Deletes the category and clears the category label from its items. The items themselves are kept.',
        responses: { '204': { description: 'Deleted' }, '404': errorResponses['404'] }
      }
    },
    '/categories/{id}/image': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Categories'],
        summary: 'Get the category image',
        responses: {
          '200': {
            description: 'Image',
            content: { 'image/*': { schema: { type: 'string', format: 'binary' } } }
          },
          '404': errorResponses['404'],
          '410': { description: 'Database row exists but the image file is missing', content: json(error) }
        }
      },
      post: {
        tags: ['Categories'],
        summary: 'Upload or replace the category image',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Image saved', content: json({ type: 'object', properties: { data: category } }) },
          '413': { description: 'File too large', content: json(error) },
          ...errorResponses
        }
      },
      delete: {
        tags: ['Categories'],
        summary: 'Remove the category image',
        responses: {
          '200': { description: 'Updated category', content: json({ type: 'object', properties: { data: category } }) },
          '404': errorResponses['404']
        }
      }
    },
    '/attachments': {
      get: {
        tags: ['Attachments'],
        summary: 'List attachments',
        parameters: [
          { name: 'item_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'location_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'service_record_id', in: 'query', schema: { type: 'string', format: 'uuid' } }
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
          'multipart/form-data. Provide exactly one of item_id or location_id, or a service_record_id to attach a receipt to a service record. kind is inferred from the MIME type when omitted.',
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
                  service_record_id: { type: 'string', format: 'uuid' },
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
          grid_cols: {
            type: 'integer',
            nullable: true,
            description: 'Grid map width in cells. Null when this location has no map.'
          },
          grid_rows: {
            type: 'integer',
            nullable: true,
            description: 'Grid map depth in cells. Null when this location has no map.'
          },
          grid_x: { type: 'integer', nullable: true, description: 'Placement origin cell within the parent grid' },
          grid_y: { type: 'integer', nullable: true },
          grid_w: { type: 'integer', nullable: true, description: 'Footprint width in cells, before rotation' },
          grid_h: { type: 'integer', nullable: true },
          grid_rot: {
            type: 'integer',
            enum: [0, 90],
            description: 'Orientation of the bin: 0 portrait, 90 landscape'
          },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      },
      LooseItem: {
        type: 'object',
        description:
          'An item sitting in a container rather than in one of its bins. loose_quantity is what this container holds; quantity is the total on hand everywhere.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          unit: { type: 'string' },
          quantity: { type: 'number' },
          loose_quantity: { type: 'number' }
        }
      },
      DrawerLayout: {
        type: 'object',
        description: 'The map of one partitioned container: its grid, its placed bins and what is still loose.',
        properties: {
          location: location,
          cols: { type: 'integer', nullable: true },
          rows: { type: 'integer', nullable: true },
          used_cells: { type: 'integer' },
          free_cells: { type: 'integer' },
          bins: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                location_id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                code: { type: 'string', nullable: true },
                x: { type: 'integer' },
                y: { type: 'integer' },
                w: { type: 'integer', description: 'Effective width in cells, after rotation' },
                h: { type: 'integer', description: 'Effective depth in cells, after rotation' },
                base_w: { type: 'integer', description: 'Footprint width before rotation' },
                base_h: { type: 'integer' },
                rotation: { type: 'integer', enum: [0, 90] },
                item_count: { type: 'integer' },
                unit_count: { type: 'number' }
              }
            }
          },
          unplaced_bins: {
            type: 'array',
            items: location,
            description: 'Child locations that exist but have no position on the grid yet'
          },
          loose_items: {
            type: 'array',
            items: ref('LooseItem'),
            description: 'Items held by the container itself rather than by a bin'
          }
        }
      },
      Category: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Resistors' },
          description: { type: 'string', nullable: true },
          icon: { type: 'string', nullable: true, example: 'cpu' },
          image_url: {
            type: 'string',
            nullable: true,
            description: 'URL of the uploaded category image, or null when none is set'
          },
          image_mime_type: { type: 'string', nullable: true },
          sort_order: { type: 'integer' },
          item_count: { type: 'integer', description: 'Number of items in this category, including archived items' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      },
      CategoryInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', example: 'Resistors' },
          description: { type: 'string', nullable: true },
          icon: {
            type: 'string',
            nullable: true,
            description: 'Name of a built-in icon such as cpu, tool, bolt, plug, resistor or tag'
          },
          sort_order: { type: 'integer', default: 0 }
        }
      },
      Attachment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          item_id: { type: 'string', format: 'uuid', nullable: true },
          location_id: { type: 'string', format: 'uuid', nullable: true },
          service_record_id: { type: 'string', format: 'uuid', nullable: true },
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
          location_id: { type: 'string', format: 'uuid', nullable: true },
          location: { allOf: [ref('LocationRef')], nullable: true },
          to_location_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Destination for a transfer movement'
          },
          to_location: { allOf: [ref('LocationRef')], nullable: true },
          created_at: { type: 'string', format: 'date-time' }
        }
      },
      ItemRef: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          sku: { type: 'string', nullable: true },
          unit: { type: 'string' }
        }
      },
      ItemStockLot: {
        type: 'object',
        description:
          'A quantity of one item held at one location. The item quantity is the sum of its lots and its primary location is the largest lot.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          item_id: { type: 'string', format: 'uuid' },
          location_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Null means unassigned stock'
          },
          location: { allOf: [ref('LocationRef')], nullable: true },
          quantity: { type: 'number' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      },
      ItemAllocation: {
        type: 'object',
        description:
          'A component signed out to a host item. The component stock has already been removed; returning the allocation puts it back.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          component_item_id: { type: 'string', format: 'uuid' },
          component: ref('ItemRef'),
          host_item_id: { type: 'string', format: 'uuid' },
          host: ref('ItemRef'),
          quantity: { type: 'number' },
          source_location_id: { type: 'string', format: 'uuid', nullable: true },
          source_location: { allOf: [ref('LocationRef')], nullable: true },
          note: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
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
              'Publish this item to Home Assistant via MQTT discovery. New items default to false. Published items stay visible even when their location is hidden and are grouped under the nearest published location device.'
          },
          service_interval_months: {
            type: 'integer',
            minimum: 1,
            maximum: 120,
            nullable: true,
            description: 'Optional service interval. Logging a service advances the next due date by this many months.'
          },
          service_next_due: {
            type: 'string',
            format: 'date',
            nullable: true,
            description: 'Date-only next service date (YYYY-MM-DD). Added to the configured Home Assistant calendar.'
          },
          service_notes: { type: 'string', nullable: true }
        }
      },
      ServiceRecordInput: {
        type: 'object',
        required: ['performed_at'],
        properties: {
          performed_at: { type: 'string', format: 'date', example: '2026-05-12' },
          notes: { type: 'string', nullable: true },
          ...(pricingEnabled
            ? {
                cost: { type: 'number', minimum: 0, nullable: true },
                currency: { type: 'string', nullable: true, example: 'GBP' }
              }
            : {})
        }
      },
      ServiceRecord: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          item_id: { type: 'string', format: 'uuid' },
          performed_at: { type: 'string', format: 'date' },
          notes: { type: 'string', nullable: true },
          ...(pricingEnabled
            ? {
                cost: { type: 'number', nullable: true },
                currency: { type: 'string', nullable: true }
              }
            : {}),
          attachments: { type: 'array', items: attachment },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
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
          category_icon: {
            type: 'string',
            nullable: true,
            description: 'Icon for the category, used by clients when the item has no photo'
          },
          category_image_url: {
            type: 'string',
            nullable: true,
            description: 'Image for the category, used by clients when the item has no photo'
          },
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
          service_interval_months: { type: 'integer', nullable: true },
          service_next_due: { type: 'string', format: 'date', nullable: true },
          service_notes: { type: 'string', nullable: true },
          service_due: {
            type: 'boolean',
            description: 'True when service_next_due is today or in the past'
          },
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
              stock: {
                type: 'array',
                items: stockLot,
                description: 'Per-location stock lots, sorted by location path'
              },
              components: {
                type: 'array',
                items: allocation,
                description: 'Components installed in this item'
              },
              assigned_to: {
                type: 'array',
                items: allocation,
                description: 'Host items this item is signed out to'
              },
              movements: { type: 'array', items: ref('StockMovement') },
              service_records: { type: 'array', items: serviceRecord }
            }
          }
        ]
      }
    }
  }
};
