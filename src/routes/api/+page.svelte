<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import Icon from '$lib/components/Icon.svelte';
  import { withBase } from '$lib/paths';

  let { data }: { data: PageData } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
  const base = $derived(`${data.origin}/api/v1`);

  type Endpoint = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; desc: string };

  const groups: Array<{ title: string; icon: string; endpoints: Endpoint[] }> = [
    {
      title: 'System',
      icon: 'dashboard',
      endpoints: [
        { method: 'GET', path: '/health', desc: 'Liveness probe' },
        { method: 'GET', path: '/meta', desc: 'Locations, categories, tags, units, stats' },
        { method: 'GET', path: '/openapi.json', desc: 'Machine-readable schema' },
        { method: 'GET', path: '/export', desc: 'Full JSON export' }
      ]
    },
    {
      title: 'Items',
      icon: 'box',
      endpoints: [
        { method: 'GET', path: '/items', desc: 'Search, filter and paginate' },
        { method: 'POST', path: '/items', desc: 'Create one item' },
        { method: 'POST', path: '/items/bulk', desc: 'Create up to 500 items' },
        { method: 'GET', path: '/items/{id}', desc: 'Item with attachments' },
        { method: 'PATCH', path: '/items/{id}', desc: 'Partial update' },
        { method: 'DELETE', path: '/items/{id}', desc: 'Delete item and files' },
        { method: 'POST', path: '/items/{id}/stock', desc: 'Adjust with delta or set' },
        { method: 'GET', path: '/items/{id}/movements', desc: 'Stock history' },
        { method: 'GET', path: '/search?q=', desc: 'Search items and locations' }
      ]
    },
    {
      title: 'Locations',
      icon: 'pin',
      endpoints: [
        { method: 'GET', path: '/locations', desc: 'Flat list or ?tree=true' },
        { method: 'POST', path: '/locations', desc: 'Create, optionally nested' },
        { method: 'GET', path: '/locations/{id}', desc: 'Location with children' },
        { method: 'PATCH', path: '/locations/{id}', desc: 'Rename or move' },
        { method: 'DELETE', path: '/locations/{id}', desc: 'Only when empty (409)' }
      ]
    },
    {
      title: 'Attachments',
      icon: 'file',
      endpoints: [
        { method: 'GET', path: '/attachments', desc: 'Filter by item or location' },
        { method: 'POST', path: '/attachments', desc: 'Multipart upload' },
        { method: 'GET', path: '/attachments/{id}', desc: 'File metadata' },
        { method: 'GET', path: '/attachments/{id}/file', desc: 'Download or view file' },
        { method: 'DELETE', path: '/attachments/{id}', desc: 'Delete metadata and file' }
      ]
    }
  ];

  const authHeader = $derived(
    data.apiKeyEnabled ? `-H 'Authorization: Bearer $INVENTORY_API_KEY' \\\n  ` : ''
  );

  const quickStart = $derived(`# 1. See what already exists
curl ${base}/meta \\
  ${authHeader}-H 'Accept: application/json'

# 2. Create a nested location
curl -X POST ${base}/locations \\
  ${authHeader}-H 'Content-Type: application/json' \\
  -d '{"name":"Drawer 1a","parent_id":"<location-id>"}'

# 3. Add a component
curl -X POST ${base}/items \\
  ${authHeader}-H 'Content-Type: application/json' \\
  -d '{"name":"10k resistor","category":"Resistors","quantity":100,"unit":"pcs","location_id":"<location-id>","tags":["through-hole"]}'

# 4. Adjust stock
curl -X POST ${base}/items/<item-id>/stock \\
  ${authHeader}-H 'Content-Type: application/json' \\
  -d '{"delta":-5,"reason":"used"}'

# 5. Upload a datasheet
curl -X POST ${base}/attachments \\
  ${authHeader}-F 'file=@datasheet.pdf' -F 'item_id=<item-id>' -F 'kind=document'`);

  const itemShape = $derived(`{
  "name": "10kΩ resistor 0.25W",   // required
  "sku": "RES-10K-025",
  "category": "Resistors",
  "quantity": 240,
  "unit": "pcs",
  "min_quantity": 50,
  "location_id": "uuid",
  "manufacturer": "Yageo",
  "mpn": "CFR-25JB-52-10K",
  "supplier": "Mouser",
  "supplier_url": "https://…",
  "price": 0.02,
  "currency": "${data.currency}",
  "datasheet_url": "https://…",
  "notes": "Bought in 2025",
  "tags": ["through-hole", "10k"],
  "custom_fields": { "tolerance": "5%", "power": "0.25W" },
  "archived": false
}`);

  const responseShape = `// success
{ "data": { "id": "…", "name": "10k resistor", … } }

// list
{ "data": [ … ], "pagination": { "total": 42, "limit": 50, "offset": 0, "has_more": false } }

// failure
{ "error": {
    "code": "validation_error",
    "message": "Some fields are invalid",
    "details": [{ "field": "name", "message": "Required" }]
} }`;
</script>

<svelte:head>
  <title>API &amp; AI · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">
      <Icon name="code" size={13} />
      Developers
    </div>
    <h1 class="page-title">API &amp; AI</h1>
    <p class="page-sub">A clean REST interface over every item, location and file.</p>
  </div>
  <div class="page-actions">
    <a class="btn" href={h('/llms.txt')} target="_blank" rel="noopener">
      <Icon name="file" size={16} />
      llms.txt
    </a>
    <a class="btn btn-primary" href={h('/api/v1/openapi.json')} target="_blank" rel="noopener">
      <Icon name="download" size={16} />
      OpenAPI spec
    </a>
  </div>
</div>

<div class="api-hero">
  <span class="brand-mark"><Icon name="sparkles" size={22} /></span>
  <div>
    <h2>Designed for agents as much as for people</h2>
    <p>
      Point an AI assistant at <code class="inline">{base}</code> or hand it
      <a class="link" href={h('/llms.txt')} target="_blank" rel="noopener">/llms.txt</a>. Everything the UI can do,
      the API can do too — including nested locations and file uploads.
    </p>
  </div>
</div>

<div class="stat-grid" style="margin-bottom: 22px;">
  <div class="stat">
    <div class="stat-icon"><Icon name="link" size={19} /></div>
    <div class="stat-label">Base URL</div>
    <div class="stat-value" style="font-size: 16px; word-break: break-all;">{base}</div>
    <div class="stat-foot">Versioned under /api/v1</div>
  </div>
  <div class="stat" class:stat-accent={data.apiKeyEnabled}>
    <div class="stat-icon"><Icon name={data.apiKeyEnabled ? 'check' : 'info'} size={19} /></div>
    <div class="stat-label">Authentication</div>
    <div class="stat-value" style="font-size: 20px;">{data.apiKeyEnabled ? 'API key required' : 'Open access'}</div>
    <div class="stat-foot">
      {#if data.apiKeyEnabled}
        Send <code class="inline">Authorization: Bearer …</code> with each request
      {:else}
        Set <code class="inline">INVENTORY_API_KEY</code> to enable keys
      {/if}
    </div>
  </div>
  <div class="stat">
    <div class="stat-icon"><Icon name="file" size={19} /></div>
    <div class="stat-label">Upload limit</div>
    <div class="stat-value" style="font-size: 20px;">{data.maxUploadMb} MB</div>
    <div class="stat-foot">Configurable with MAX_UPLOAD_MB</div>
  </div>
  <div class="stat">
    <div class="stat-icon"><Icon name="tag" size={19} /></div>
    <div class="stat-label">Version</div>
    <div class="stat-value" style="font-size: 20px;">{data.version}</div>
    <div class="stat-foot">Default currency {data.currency}</div>
  </div>
</div>

<div class="api-grid">
  <div class="stack">
    <div class="card">
      <div class="card-head">
        <h2>Quick start</h2>
        <span class="hint">curl</span>
      </div>
      <div class="card-body">
        <pre class="code">{quickStart}</pre>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Responses</h2>
        <span class="hint">JSON envelope</span>
      </div>
      <div class="card-body">
        <pre class="code">{responseShape}</pre>
        <p class="hint" style="margin-top: 12px;">
          HTTP status codes are meaningful: 200/201 success, 400 validation, 404 missing, 409 conflict,
          413 too large, 207 partial bulk success.
        </p>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Item shape</h2>
        <span class="hint">only name is required</span>
      </div>
      <div class="card-body">
        <pre class="code">{itemShape}</pre>
      </div>
    </div>
  </div>

  <div class="stack">
    {#each groups as group (group.title)}
      <div class="card">
        <div class="card-head">
          <h2>
            <Icon name={group.icon} size={16} />
            {group.title}
          </h2>
          <span class="hint">{group.endpoints.length} endpoints</span>
        </div>
        <div>
          {#each group.endpoints as endpoint (endpoint.method + endpoint.path)}
            <div class="endpoint">
              <span class="method method-{endpoint.method.toLowerCase()}">{endpoint.method}</span>
              <span class="endpoint-path">{endpoint.path}</span>
              <span class="endpoint-desc">{endpoint.desc}</span>
            </div>
          {/each}
        </div>
      </div>
    {/each}

    <div class="card">
      <div class="card-head">
        <h2>Useful links</h2>
      </div>
      <div class="card-body">
        <div class="stack-sm">
          <a class="child-card" href={h('/llms.txt')} target="_blank" rel="noopener">
            <span class="child-card-icon"><Icon name="sparkles" size={17} /></span>
            <span style="min-width: 0;">
              <span class="child-card-name" style="display: block;">/llms.txt</span>
              <span class="child-card-meta">Concise instructions written for language models</span>
            </span>
            <Icon name="external" size={15} />
          </a>
          <a class="child-card" href={h('/api/v1/openapi.json')} target="_blank" rel="noopener">
            <span class="child-card-icon"><Icon name="code" size={17} /></span>
            <span style="min-width: 0;">
              <span class="child-card-name" style="display: block;">/api/v1/openapi.json</span>
              <span class="child-card-meta">OpenAPI 3.0 description of every route</span>
            </span>
            <Icon name="external" size={15} />
          </a>
          <a class="child-card" href={h('/api/v1/export')} target="_blank" rel="noopener">
            <span class="child-card-icon"><Icon name="download" size={17} /></span>
            <span style="min-width: 0;">
              <span class="child-card-name" style="display: block;">/api/v1/export</span>
              <span class="child-card-meta">Download the whole inventory as JSON</span>
            </span>
            <Icon name="external" size={15} />
          </a>
          <a class="child-card" href={h('/api/v1/health')} target="_blank" rel="noopener">
            <span class="child-card-icon"><Icon name="check" size={17} /></span>
            <span style="min-width: 0;">
              <span class="child-card-name" style="display: block;">/api/v1/health</span>
              <span class="child-card-meta">Health check for monitoring and uptime probes</span>
            </span>
            <Icon name="external" size={15} />
          </a>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Conventions</h2>
      </div>
      <div class="card-body">
        <ul class="stack-sm small muted" style="padding-left: 18px; list-style: disc;">
          <li>IDs are UUIDs; use them exactly as returned.</li>
          <li>Lists paginate with <code class="inline">limit</code> and <code class="inline">offset</code>.</li>
          <li>Stock changes go through <code class="inline">/stock</code>, never a raw quantity PATCH.</li>
          <li>Locations nest arbitrarily through <code class="inline">parent_id</code>.</li>
          <li>Quantities may be fractional — wire, filament, liquids.</li>
          <li>Deleting a location requires it to be empty.</li>
        </ul>
      </div>
    </div>
  </div>
</div>
