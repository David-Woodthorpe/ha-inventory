<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import Icon from '$lib/components/Icon.svelte';
  import UploadForm from '$lib/components/UploadForm.svelte';
  import { formatBytes, formatDate, formatNumber, plural } from '$lib/format';
  import { withBase } from '$lib/paths';
  import type { Item } from '$lib/types';

  type ActionResult = { success?: string; error?: string } | null;

  let { data, form }: { data: PageData; form: ActionResult } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
  const location = $derived(data.location);

  // Items can live in this location or any location below it. Show only the
  // part of each item's path that is below the current location.
  function relativeCrumbs(item: Item): Array<{ id: string; name: string }> {
    if (!item.location) return [];
    const base = location.path_ids;
    const ids = item.location.path_ids;
    let start = 0;
    while (start < base.length && ids[start] === base[start]) start += 1;
    return item.location.path.slice(start).map((name, index) => ({
      id: ids[start + index],
      name
    }));
  }

  function confirmDeleteLocation(event: SubmitEvent) {
    if (
      !confirm(
        `Delete the location “${location.name}”? It must be empty — move any items and sublocations first.`
      )
    ) {
      event.preventDefault();
    }
  }

  function confirmDeleteAttachment(event: SubmitEvent) {
    if (!confirm('Delete this attachment?')) event.preventDefault();
  }
</script>

<svelte:head>
  <title>{location.name} · Locations · Inventory</title>
</svelte:head>

<nav class="breadcrumbs" aria-label="Breadcrumb">
  <a href={h('/locations')}>Locations</a>
  {#each location.path as part, index}
    <span class="sep">/</span>
    {#if index === location.path.length - 1}
      <span>{part}</span>
    {:else}
      <a href={h(`/locations/${location.path_ids[index]}`)}>{part}</a>
    {/if}
  {/each}
</nav>

<div class="detail-head">
  <div>
    <div class="row" style="margin-bottom: 6px;">
      <span class="badge badge-accent"><Icon name="pin" size={11} /> Location</span>
      {#if location.code}
        <span class="badge badge-outline mono">{location.code}</span>
      {/if}
      {#if location.ha_enabled}
        <span class="badge badge-accent"><Icon name="home" size={11} /> Home Assistant</span>
      {/if}
    </div>
    <h1 class="detail-title">{location.name}</h1>
    {#if location.description}
      <p class="page-sub" style="margin-top: 8px;">{location.description}</p>
    {/if}
    <div class="row" style="margin-top: 12px;">
      <span class="badge">{plural(location.direct_item_count, 'item')} directly here</span>
      <span class="badge">{plural(location.total_item_count, 'item')} including sublocations</span>
      <span class="badge">{plural(data.children.length, 'sublocation')}</span>
    </div>
    {#if location.ha_enabled && !data.ancestorsEnabled}
      <p class="small muted" style="margin-top: 8px;">
        A parent location is not published, so this location is hidden in Home Assistant.
      </p>
    {/if}
  </div>

  <div class="page-actions">
    <a class="btn" href={h(`/locations/new?parent=${location.id}`)}>
      <Icon name="plus" size={15} />
      Add sublocation
    </a>
    <form method="POST" action="?/toggleHomeAssistant">
      <button class="btn" type="submit">
        <Icon name="home" size={15} />
        {location.ha_enabled ? 'Stop publishing' : 'Publish to Home Assistant'}
      </button>
    </form>
    <a class="btn" href={h(`/locations/${location.id}/edit`)}>
      <Icon name="edit" size={15} />
      Edit
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
  </div>
{/if}

<div class="split">
  <div class="stack">
    <div class="card">
      <div class="card-head">
        <h2>Sublocations</h2>
        <a class="link small" href={h(`/locations/new?parent=${location.id}`)}>
          <Icon name="plus" size={12} /> Add
        </a>
      </div>
      <div class="card-body">
        {#if data.children.length}
          <div class="child-grid">
            {#each data.children as child (child.id)}
              <a class="child-card" href={h(`/locations/${child.id}`)}>
                <span class="child-card-icon"><Icon name="folder" size={17} /></span>
                <span style="min-width: 0; flex: 1;">
                  <span class="child-card-name truncate" style="display: block;">{child.name}</span>
                  <span class="child-card-meta">
                    {plural(child.total_item_count, 'item')}
                    {#if child.child_count}· {plural(child.child_count, 'sublocation')}{/if}
                  </span>
                </span>
                <Icon name="chevronRight" size={15} />
              </a>
            {/each}
          </div>
        {:else}
          <p class="small muted">
            No sublocations yet.
            <a class="link" href={h(`/locations/new?parent=${location.id}`)}>Add one</a> to go another level
            deeper.
          </p>
        {/if}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Items in this location</h2>
        <div class="row" style="gap: 12px;">
          <a class="link small" href={h(`/items?location=${location.id}`)}>View in catalogue</a>
          <a class="link small" href={h(`/items/new?location=${location.id}`)}>
            <Icon name="plus" size={12} /> Add item
          </a>
        </div>
      </div>
      {#if data.items.length}
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Item</th>
                <th class="hide-sm">Category</th>
                <th class="hide-sm">Location</th>
                <th class="num">Qty</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each data.items as item (item.id)}
                <tr>
                  <td>
                    <a class="cell-main" href={h(`/items/${item.id}`)}>
                      {#if item.photo}
                        <img class="thumb" src={h(item.photo.url)} alt="" loading="lazy" />
                      {:else}
                        <span class="thumb thumb-empty"><Icon name="box" size={17} /></span>
                      {/if}
                      <span>
                        <span class="cell-title">{item.name}</span>
                        <span class="cell-sub">
                          {#if item.sku}<span class="mono">{item.sku}</span>{/if}
                          {#if item.low_stock}<span class="badge badge-low">Low</span>{/if}
                          <span class="only-mobile">
                            {item.location?.path_label ?? 'Unassigned'}
                          </span>
                        </span>
                      </span>
                    </a>
                  </td>
                  <td class="hide-sm">{item.category ?? '—'}</td>
                  <td class="hide-sm">
                    {#if item.location}
                      {@const crumbs = relativeCrumbs(item)}
                      {#if crumbs.length === 0}
                        <span class="faint">Here</span>
                      {:else}
                        <span class="breadcrumbs inline">
                          {#each crumbs as crumb, index}
                            {#if index > 0}<span class="sep">/</span>{/if}
                            <a href={h(`/locations/${crumb.id}`)}>{crumb.name}</a>
                          {/each}
                        </span>
                      {/if}
                    {:else}
                      <span class="faint">Unassigned</span>
                    {/if}
                  </td>
                  <td class="num">
                    <span class="qty" class:low={item.low_stock} class:zero={item.quantity <= 0}>
                      {formatNumber(item.quantity)}
                    </span>
                    <span class="faint small">{item.unit}</span>
                  </td>
                  <td style="width: 40px;">
                    <a class="icon-btn" href={h(`/items/${item.id}`)} aria-label={`Open ${item.name}`}>
                      <Icon name="chevronRight" size={16} />
                    </a>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if data.itemTotal > data.items.length}
          <div class="card-body" style="border-top: 1px solid var(--border);">
            <p class="small muted">
              Showing {data.items.length} of {data.itemTotal} items.
              <a class="link" href={h(`/items?location=${location.id}`)}>View all in the catalogue</a>.
            </p>
          </div>
        {/if}
      {:else}
        <div class="empty" style="padding: 34px 20px;">
          <div class="empty-icon" style="width: 42px; height: 42px;"><Icon name="box" size={20} /></div>
          <p class="small">
            Nothing is stored here or in any sublocation.
            <a class="link" href={h(`/items/new?location=${location.id}`)}>Add an item</a>.
          </p>
        </div>
      {/if}
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Photos</h2>
        <span class="hint">{plural(data.photos.length, 'photo')}</span>
      </div>
      <div class="card-body">
        {#if data.photos.length}
          <div class="photo-grid">
            {#each data.photos as photo (photo.id)}
              <div class="photo-tile">
                <a href={h(photo.url)} target="_blank" rel="noreferrer">
                  <img src={h(photo.url)} alt={photo.caption ?? location.name} loading="lazy" />
                </a>
                <form method="POST" action="?/deleteAttachment" onsubmit={confirmDeleteAttachment}>
                  <input type="hidden" name="id" value={photo.id} />
                  <button class="icon-btn" type="submit" aria-label="Delete photo">
                    <Icon name="trash" size={13} />
                  </button>
                </form>
              </div>
            {/each}
          </div>
        {:else}
          <p class="small muted">
            Add a photo of the drawer, shelf or bin so it is easy to recognise later.
          </p>
        {/if}
      </div>
    </div>
  </div>

  <div class="stack">
    <div class="card">
      <div class="card-head"><h2>Details</h2></div>
      <div class="card-body">
        <dl class="kv">
          <dt>Full path</dt>
          <dd>{location.path_label}</dd>

          {#if location.code}
            <dt>Code</dt>
            <dd class="mono">{location.code}</dd>
          {/if}

          <dt>Parent</dt>
          <dd>
            {#if data.parent}
              <a class="link" href={h(`/locations/${data.parent.id}`)}>{data.parent.name}</a>
            {:else}
              <span class="faint">Top level</span>
            {/if}
          </dd>

          <dt>Created</dt>
          <dd>{formatDate(location.created_at)}</dd>
          <dt>Updated</dt>
          <dd>{formatDate(location.updated_at)}</dd>
        </dl>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Add a photo or document</h2>
      </div>
      <div class="card-body">
        <UploadForm
          action="?/upload"
          targetName="location_id"
          targetId={location.id}
          kind="auto"
          title="Upload"
        />
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Documents</h2>
        <span class="hint">{plural(data.documents.length, 'file')}</span>
      </div>
      <div class="card-body">
        {#if data.documents.length}
          <div class="attachment-list">
            {#each data.documents as document (document.id)}
              <div class="attachment">
                <span class="attachment-icon"><Icon name="file" size={16} /></span>
                <div style="min-width: 0; flex: 1;">
                  <a
                    class="attachment-name"
                    href={h(document.url)}
                    download={document.original_name}
                    title={document.original_name}
                  >
                    {document.caption ?? document.original_name}
                  </a>
                  <div class="attachment-meta">
                    {formatBytes(document.size)} · {formatDate(document.created_at)}
                  </div>
                </div>
                <form method="POST" action="?/deleteAttachment" onsubmit={confirmDeleteAttachment}>
                  <input type="hidden" name="id" value={document.id} />
                  <button class="icon-btn danger" type="submit" aria-label="Delete document">
                    <Icon name="trash" size={14} />
                  </button>
                </form>
              </div>
            {/each}
          </div>
        {:else}
          <p class="small muted">No documents attached to this location.</p>
        {/if}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Danger zone</h2></div>
      <div class="card-body">
        <p class="small muted" style="margin-bottom: 12px;">
          Only empty locations can be deleted. Move or delete any items, sublocations and attachments
          first.
        </p>
        <form method="POST" action="?/delete" onsubmit={confirmDeleteLocation}>
          <button class="btn btn-danger btn-sm" type="submit">
            <Icon name="trash" size={14} />
            Delete location
          </button>
        </form>
      </div>
    </div>
  </div>
</div>
