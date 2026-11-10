<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import Icon from '$lib/components/Icon.svelte';
  import { formatBytes, formatDateTime, formatNumber, plural } from '$lib/format';
  import { withBase } from '$lib/paths';

  type RestoreResult = {
    size: number;
    schema_version: number;
    item_count: number;
    location_count: number;
    attachment_count: number;
  };
  type BackupForm = { success?: string; error?: string; result?: RestoreResult } | null;

  let { data, form }: { data: PageData; form: BackupForm } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
  let confirmed = $state(false);

  const authHeader = $derived(
    data.apiKeyEnabled ? `-H "Authorization: Bearer $INVENTORY_API_KEY" \\\n  ` : ''
  );
  const backupCurl = $derived(
    `curl ${authHeader}http://<host>:3000/api/v1/backup \\\n  -o inventory-backup.db`
  );
  const restoreCurl = $derived(
    `curl -X POST ${authHeader}-F "file=@inventory-backup.db" \\\n  http://<host>:3000/api/v1/restore`
  );
</script>

<svelte:head>
  <title>Backup &amp; restore · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">
      <Icon name="archive" size={13} />
      System
    </div>
    <h1 class="page-title">Backup &amp; restore</h1>
    <p class="page-sub">Download a consistent snapshot of the SQLite database, or replace it with an earlier copy.</p>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href={h('/backup/download')} download>
      <Icon name="download" size={16} />
      Download backup
    </a>
  </div>
</div>

{#if form?.error}
  <div class="alert alert-error" role="alert" style="margin-bottom: 18px;">
    <Icon name="alert" size={17} />
    {form.error}
  </div>
{:else if form?.success}
  <div class="alert alert-success" role="status" style="margin-bottom: 18px;">
    <Icon name="check" size={17} />
    {form.success}
    {#if form.result}
      Restored {plural(form.result.item_count, 'item')}, {plural(form.result.location_count, 'location')} and
      {plural(form.result.attachment_count, 'attachment')} from a schema v{form.result.schema_version} database.
    {/if}
  </div>
{/if}

<div class="stat-grid" style="margin-bottom: 22px;">
  <div class="stat">
    <div class="stat-icon"><Icon name="archive" size={19} /></div>
    <div class="stat-label">Database size</div>
    <div class="stat-value">{formatBytes(data.database.size)}</div>
    <div class="stat-foot">{data.database.name} in the data directory</div>
  </div>
  <div class="stat">
    <div class="stat-icon"><Icon name="history" size={19} /></div>
    <div class="stat-label">Last modified</div>
    <div class="stat-value" style="font-size: 19px;">{formatDateTime(data.database.modified)}</div>
    <div class="stat-foot">Server time (UTC)</div>
  </div>
  <div class="stat">
    <div class="stat-icon"><Icon name="box" size={19} /></div>
    <div class="stat-label">Items</div>
    <div class="stat-value">{formatNumber(data.stats.item_count)}</div>
    <div class="stat-foot">{plural(data.stats.location_count, 'location')}</div>
  </div>
  <div class="stat">
    <div class="stat-icon"><Icon name="file" size={19} /></div>
    <div class="stat-label">Attachments</div>
    <div class="stat-value">{formatNumber(data.stats.attachment_count)}</div>
    <div class="stat-foot">Files live outside the database</div>
  </div>
</div>

<div class="alert alert-warning" role="note" style="margin-bottom: 22px;">
  <Icon name="alert" size={17} />
  <span>
    Database backups do not include photos, datasheets or other uploaded files. Those live in
    <code class="inline">data/uploads</code> (or <code class="inline">/data/uploads</code> in Docker and Home Assistant)
    and need to be copied separately.
  </span>
</div>

<div class="split">
  <div class="stack">
    <div class="card">
      <div class="card-head">
        <h2>Download a backup</h2>
        <span class="hint">SQLite snapshot</span>
      </div>
      <div class="card-body">
        <p class="small muted" style="margin-bottom: 14px;">
          The download is created with SQLite's <code class="inline">VACUUM INTO</code>, so it is a complete,
          consistent database even while the app is running. It contains items, locations, attachments metadata,
          stock history and settings stored in the database.
        </p>
        <a class="btn btn-primary" href={h('/backup/download')} download>
          <Icon name="download" size={16} />
          Download inventory.db
        </a>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Restore from a backup</h2>
        <span class="hint">replaces everything</span>
      </div>
      <div class="card-body">
        <p class="small muted" style="margin-bottom: 16px;">
          Upload a database file previously downloaded from this app. The current database is replaced only after
          the uploaded file passes SQLite integrity, schema and foreign-key checks. If the new file cannot be
          opened, the previous database is restored automatically.
        </p>

        <form method="POST" action="?/restore" enctype="multipart/form-data">
          <div class="field">
            <label class="label" for="backup-file">Database file</label>
            <input
              class="input"
              id="backup-file"
              type="file"
              name="file"
              accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/octet-stream"
              required
            />
            <span class="hint">Choose an <code class="inline">inventory-backup-*.db</code> file.</span>
          </div>

          <label class="check" style="margin-top: 18px; align-items: flex-start;">
            <input type="checkbox" name="confirm" value="yes" bind:checked={confirmed} />
            <span>
              I understand that restoring replaces all current items, locations, stock history and attachment
              metadata. Uploaded files in <code class="inline">data/uploads</code> are not changed.
            </span>
          </label>

          <div class="form-actions">
            <button class="btn btn-danger" type="submit" disabled={!confirmed}>
              <Icon name="upload" size={16} />
              Restore database
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <div class="stack">
    <div class="card">
      <div class="card-head">
        <h2>Command line</h2>
        <span class="hint">API</span>
      </div>
      <div class="card-body">
        <p class="small muted" style="margin-bottom: 10px;">Download:</p>
        <pre class="code">{backupCurl}</pre>
        <p class="small muted" style="margin: 16px 0 10px;">Restore:</p>
        <pre class="code">{restoreCurl}</pre>
        {#if data.apiKeyEnabled}
          <p class="hint" style="margin-top: 12px;">
            Set <code class="inline">INVENTORY_API_KEY</code> in your shell before running these commands.
          </p>
        {/if}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Good to know</h2>
      </div>
      <div class="card-body">
        <ul class="stack-sm small muted" style="padding-left: 18px; list-style: disc;">
          <li>Backups restore the database only; copy the uploads directory separately.</li>
          <li>Restoring is destructive and cannot be undone from the app.</li>
          <li>Restore briefly keeps a safety copy of the current database, then removes it.</li>
          <li>Backups made by a newer version of Inventory are rejected rather than downgraded.</li>
          <li>Home Assistant add-on backups already include the whole <code class="inline">/data</code> directory.</li>
          <li>The API endpoints use the same API-key protection as the rest of <code class="inline">/api/v1</code>.</li>
        </ul>
      </div>
    </div>
  </div>
</div>
