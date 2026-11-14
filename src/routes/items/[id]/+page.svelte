<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import Icon from '$lib/components/Icon.svelte';
  import UploadForm from '$lib/components/UploadForm.svelte';
  import { withBase } from '$lib/paths';
  import {
    formatBytes,
    formatDate,
    formatDateTime,
    formatMoney,
    formatNumber,
    plural,
    quantityClass
  } from '$lib/format';

  type ActionResult = { success?: string; error?: string } | null;

  let { data, form }: { data: PageData; form: ActionResult } = $props();

  let activePhoto = $state(0);
  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
  const item = $derived(data.item);
  const photos = $derived(item.photos);
  const currentPhoto = $derived(photos[Math.min(activePhoto, photos.length - 1)] ?? null);
  const customEntries = $derived(Object.entries(item.custom_fields));
  const qtyClass = $derived(quantityClass(item.quantity, item.low_stock));

  function confirmDelete(event: SubmitEvent) {
    if (!confirm(`Delete “${item.name}” and all of its files? This cannot be undone.`)) {
      event.preventDefault();
    }
  }

  function confirmDeleteAttachment(event: SubmitEvent) {
    if (!confirm('Delete this attachment?')) event.preventDefault();
  }

  function confirmDeleteService(event: SubmitEvent) {
    if (!confirm('Delete this service record and its files? This cannot be undone.')) {
      event.preventDefault();
    }
  }
</script>

<svelte:head>
  <title>{item.name} · Inventory</title>
</svelte:head>

<div class="breadcrumbs">
  <a href={h('/items')}>Items</a>
  {#if item.location}
    {#each item.location.path as part, index}
      <span class="sep">/</span>
      <a href={h(`/locations/${item.location.path_ids[index]}`)}>{part}</a>
    {/each}
  {/if}
  <span class="sep">/</span>
  <span class="truncate" style="max-width: 34ch;">{item.name}</span>
</div>

<div class="detail-head">
  <div>
    <div class="row" style="margin-bottom: 6px;">
      {#if item.category}
        <span class="badge badge-accent">{item.category}</span>
      {/if}
      {#if item.low_stock}
        <span class="badge badge-low"><Icon name="alert" size={11} /> Low stock</span>
      {/if}
      {#if item.archived}
        <span class="badge badge-outline">Archived</span>
      {/if}
      {#if item.ha_enabled}
        <span class="badge badge-accent"><Icon name="home" size={11} /> Home Assistant</span>
      {/if}
      {#if item.sku}
        <span class="mono small muted">{item.sku}</span>
      {/if}
    </div>
    <h1 class="detail-title">{item.name}</h1>
    {#if item.description}
      <p class="page-sub" style="margin-top: 8px;">{item.description}</p>
    {/if}
  </div>

  <div class="page-actions">
    <a class="btn" href={h(`/items/${item.id}/edit`)}>
      <Icon name="edit" size={15} />
      Edit
    </a>
    <a class="btn" href={h(`/items/new?copy=${item.id}&focus=sku`)}>
      <Icon name="plus" size={15} />
      Add another
    </a>
    <form method="POST" action="?/archive">
      <button class="btn" type="submit">
        <Icon name="archive" size={15} />
        {item.archived ? 'Restore' : 'Archive'}
      </button>
    </form>
    <form method="POST" action="?/delete" onsubmit={confirmDelete}>
      <button class="btn btn-danger" type="submit">
        <Icon name="trash" size={15} />
        Delete
      </button>
    </form>
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
      <div class="card-body">
        <div class="gallery">
          <div class="gallery-main">
            {#if currentPhoto}
              <a href={h(currentPhoto.url)} target="_blank" rel="noreferrer" style="display: contents;">
                <img src={h(currentPhoto.url)} alt={currentPhoto.caption ?? item.name} />
              </a>
            {:else}
              <div class="gallery-empty">
                <Icon name="image" size={30} />
                <span>No photos yet</span>
              </div>
            {/if}
          </div>

          {#if photos.length > 0}
            <div class="gallery-thumbs">
              {#each photos as photo, index (photo.id)}
                <button
                  class="gallery-thumb"
                  class:active={index === activePhoto}
                  type="button"
                  aria-label={`View photo ${index + 1}`}
                  onclick={() => (activePhoto = index)}
                >
                  <img src={h(photo.url)} alt="" loading="lazy" />
                </button>
              {/each}
            </div>
          {/if}

          {#if currentPhoto}
            <div class="row-between">
              <span class="small muted">
                {currentPhoto.caption ?? currentPhoto.original_name}
                <span class="faint">· {formatBytes(currentPhoto.size)}</span>
              </span>
              <form method="POST" action="?/deleteAttachment" onsubmit={confirmDeleteAttachment}>
                <input type="hidden" name="id" value={currentPhoto.id} />
                <button class="btn btn-ghost btn-sm" type="submit">
                  <Icon name="trash" size={13} />
                  Remove photo
                </button>
              </form>
            </div>
          {/if}
        </div>
      </div>
      <div class="card-foot">
        <UploadForm action="?/upload" targetName="item_id" targetId={item.id} kind="photo" title="Add a photo" />
      </div>
    </div>

    {#if item.notes}
      <div class="card">
        <div class="card-head"><h2>Notes</h2></div>
        <div class="card-body">
          <p style="white-space: pre-wrap; color: var(--text-soft);">{item.notes}</p>
        </div>
      </div>
    {/if}

    <div class="card">
      <div class="card-head">
        <h2>Service schedule</h2>
        {#if item.service_due}
          <span class="badge badge-low"><Icon name="alert" size={11} /> Due</span>
        {:else if item.service_next_due}
          <span class="badge badge-outline">Scheduled</span>
        {:else}
          <span class="hint">Optional</span>
        {/if}
      </div>
      <div class="card-body">
        {#if item.service_interval_months || item.service_next_due}
          <dl class="kv">
            <dt>Next due</dt>
            <dd>
              {#if item.service_next_due}
                <strong class:service-overdue={item.service_due}>{formatDate(item.service_next_due)}</strong>
                {#if item.service_due}<span class="small muted">· service is due</span>{/if}
              {:else}
                <span class="faint">Not scheduled</span>
              {/if}
            </dd>
            {#if item.service_interval_months}
              <dt>Interval</dt>
              <dd>Every {plural(item.service_interval_months, 'month')}</dd>
            {/if}
            {#if item.service_notes}
              <dt>Notes</dt>
              <dd style="white-space: pre-wrap;">{item.service_notes}</dd>
            {/if}
            {#if data.serviceCalendarEnabled}
              <dt>Calendar</dt>
              <dd class="mono small">{data.serviceCalendarEntity}</dd>
            {/if}
          </dl>
        {:else}
          <p class="small muted">
            No service schedule yet. Set an interval and next due date when editing the item, then
            log each service to advance it automatically.
          </p>
        {/if}
      </div>
      <div class="card-foot">
        <a class="btn btn-sm" href={h(`/items/${item.id}/edit`)}>
          <Icon name="edit" size={14} />
          Edit schedule
        </a>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Service history</h2>
        <span class="hint">{plural(item.service_records.length, 'record')}</span>
      </div>
      <div class="card-body">
        {#if item.service_records.length}
          <div class="stack-sm">
            {#each item.service_records as record (record.id)}
              <div class="service-record">
                <div class="row-between">
                  <div>
                    <strong class="small">{formatDate(record.performed_at)}</strong>
                    {#if record.cost !== null}
                      <span class="muted small">
                        · {formatMoney(record.cost, record.currency ?? item.currency)}
                      </span>
                    {/if}
                  </div>
                  <div class="row">
                    <details class="service-details">
                      <summary class="btn btn-ghost btn-sm">Edit</summary>
                      <form method="POST" action="?/updateService" class="stack-sm service-edit-form">
                        <input type="hidden" name="record_id" value={record.id} />
                        <div class="form-grid" style="gap: 8px;">
                          <div class="field">
                            <label class="label" for={`service-date-${record.id}`}>Date</label>
                            <input
                              id={`service-date-${record.id}`}
                              class="input"
                              type="date"
                              name="performed_at"
                              value={record.performed_at}
                              required
                            />
                          </div>
                          {#if data.pricingEnabled}
                            <div class="field">
                              <label class="label" for={`service-cost-${record.id}`}>Cost</label>
                              <input
                                id={`service-cost-${record.id}`}
                                class="input"
                                type="number"
                                name="cost"
                                min="0"
                                step="any"
                                value={record.cost ?? ''}
                              />
                            </div>
                          {/if}
                        </div>
                        <textarea class="textarea" name="notes" rows="3" placeholder="What was done?">{record.notes ?? ''}</textarea>
                        {#if data.pricingEnabled}
                          <input
                            class="input mono"
                            name="currency"
                            value={record.currency ?? item.currency}
                            maxlength="3"
                            placeholder="Currency"
                            aria-label="Currency"
                          />
                        {/if}
                        <button class="btn btn-sm btn-primary" type="submit">
                          <Icon name="check" size={14} />
                          Save changes
                        </button>
                      </form>
                    </details>
                    <form method="POST" action="?/deleteService" onsubmit={confirmDeleteService}>
                      <input type="hidden" name="record_id" value={record.id} />
                      <button class="icon-btn danger" type="submit" aria-label="Delete service record">
                        <Icon name="trash" size={14} />
                      </button>
                    </form>
                  </div>
                </div>

                {#if record.notes}
                  <p class="small service-record-notes">{record.notes}</p>
                {/if}

                {#if record.attachments.length}
                  <div class="attachment-list" style="margin-top: 8px;">
                    {#each record.attachments as attachment (attachment.id)}
                      <div class="attachment">
                        <span class="attachment-icon"><Icon name="file" size={16} /></span>
                        <div style="min-width: 0; flex: 1;">
                          <a
                            class="attachment-name"
                            href={h(attachment.url)}
                            download={attachment.original_name}
                            title={attachment.original_name}
                          >
                            {attachment.caption ?? attachment.original_name}
                          </a>
                          <div class="attachment-meta">
                            {formatBytes(attachment.size)} · {formatDate(attachment.created_at)}
                          </div>
                        </div>
                        <form method="POST" action="?/deleteAttachment" onsubmit={confirmDeleteAttachment}>
                          <input type="hidden" name="id" value={attachment.id} />
                          <button class="icon-btn danger" type="submit" aria-label="Delete attachment">
                            <Icon name="trash" size={14} />
                          </button>
                        </form>
                      </div>
                    {/each}
                  </div>
                {/if}

                <details class="service-details">
                  <summary class="btn btn-ghost btn-sm service-upload-toggle">
                    <Icon name="plus" size={13} />
                    Add receipt or document
                  </summary>
                  <form
                    method="POST"
                    action="?/upload"
                    enctype="multipart/form-data"
                    class="stack-sm service-edit-form"
                  >
                    <input type="hidden" name="item_id" value={item.id} />
                    <input type="hidden" name="service_record_id" value={record.id} />
                    <input type="hidden" name="kind" value="document" />
                    <input type="file" name="file" required />
                    <input class="input" name="caption" placeholder="Caption (optional)" />
                    <button class="btn btn-sm" type="submit">
                      <Icon name="upload" size={14} />
                      Upload
                    </button>
                  </form>
                </details>
              </div>
            {/each}
          </div>
        {:else}
          <p class="small muted" style="margin-bottom: 12px;">
            Log a service to keep a dated record of maintenance, repairs and receipts.
          </p>
        {/if}
      </div>
      <div class="card-foot">
        <details class="service-details" open={item.service_records.length === 0}>
          <summary class="btn btn-sm btn-primary">
            <Icon name="plus" size={14} />
            Log service
          </summary>
          <form
            method="POST"
            action="?/addService"
            enctype="multipart/form-data"
            class="stack-sm service-edit-form"
          >
            <div class="form-grid" style="gap: 10px;">
              <div class="field">
                <label class="label" for="service-performed">Date</label>
                <input
                  id="service-performed"
                  class="input"
                  type="date"
                  name="performed_at"
                  value={data.today}
                  required
                />
              </div>
              {#if data.pricingEnabled}
                <div class="field">
                  <label class="label" for="service-cost">Cost</label>
                  <input
                    id="service-cost"
                    class="input"
                    type="number"
                    name="cost"
                    min="0"
                    step="any"
                    placeholder="Optional"
                  />
                </div>
                <div class="field">
                  <label class="label" for="service-currency">Currency</label>
                  <input
                    id="service-currency"
                    class="input mono"
                    name="currency"
                    value={item.currency}
                    maxlength="3"
                  />
                </div>
              {/if}
            </div>
            <textarea
              class="textarea"
              name="notes"
              rows="3"
              placeholder="What was done? Parts replaced, measurements, next steps…"
            ></textarea>
            <div class="field">
              <label class="label" for="service-files">Receipts or documents</label>
              <input id="service-files" type="file" name="files" multiple />
              <span class="hint">Attach one or more files (photos, PDFs, receipts).</span>
            </div>
            <button class="btn btn-primary" type="submit">
              <Icon name="check" size={15} />
              Save service record
            </button>
          </form>
        </details>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Details</h2>
        <span class="hint">Added {formatDate(item.created_at)}</span>
      </div>
      <div class="card-body">
        <dl class="kv">
          <dt>Location</dt>
          <dd>
            {#if item.location}
              <a class="link" href={h(`/locations/${item.location.id}`)}>{item.location.path_label}</a>
            {:else}
              <span class="faint">Unassigned</span>
            {/if}
          </dd>

          <dt>Home Assistant</dt>
          <dd>
            {#if item.ha_enabled}
              <span class="badge badge-accent"><Icon name="home" size={11} /> Published</span>
              {#if data.locationPublished === false}
                <span class="small muted">· its location is hidden, but the item is still published</span>
              {/if}
            {:else}
              <span class="faint">Not published</span>
            {/if}
          </dd>

          {#if item.category}
            <dt>Category</dt>
            <dd><a class="link" href={h(`/items?category=${encodeURIComponent(item.category)}`)}>{item.category}</a></dd>
          {/if}

          {#if item.manufacturer}
            <dt>Manufacturer</dt>
            <dd>{item.manufacturer}</dd>
          {/if}

          {#if item.mpn}
            <dt>Part number</dt>
            <dd class="mono">{item.mpn}</dd>
          {/if}

          {#if item.supplier}
            <dt>Supplier</dt>
            <dd>
              {#if item.supplier_url}
                <a class="link" href={item.supplier_url} target="_blank" rel="noreferrer">
                  {item.supplier}
                  <Icon name="external" size={12} />
                </a>
              {:else}
                {item.supplier}
              {/if}
            </dd>
          {/if}

          {#if data.pricingEnabled && item.price !== null}
            <dt>Unit price</dt>
            <dd>
              {formatMoney(item.price, item.currency)}
              {#if item.total_value !== null}
                <span class="muted small">· {formatMoney(item.total_value, item.currency)} total</span>
              {/if}
            </dd>
          {/if}

          {#if item.datasheet_url}
            <dt>Datasheet</dt>
            <dd>
              <a class="link" href={item.datasheet_url} target="_blank" rel="noreferrer">
                Open datasheet
                <Icon name="external" size={12} />
              </a>
            </dd>
          {/if}

          {#if item.tags.length}
            <dt>Tags</dt>
            <dd>
              <span class="tag-list">
                {#each item.tags as tag}
                  <a class="tag" href={h(`/items?tag=${encodeURIComponent(tag)}`)}>{tag}</a>
                {/each}
              </span>
            </dd>
          {/if}

          {#each customEntries as [key, value]}
            <dt>{key}</dt>
            <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
          {/each}

          <dt>Updated</dt>
          <dd>{formatDate(item.updated_at)}</dd>
        </dl>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Stock history</h2>
        <span class="hint">{plural(item.movements.length, 'movement')}</span>
      </div>
      {#if item.movements.length}
        <div class="card-body history-scroll">
          <div class="history">
            {#each item.movements as movement (movement.id)}
              <div class="history-row">
                <span class="history-delta" class:up={movement.delta > 0} class:down={movement.delta < 0}>
                  {movement.delta > 0 ? '+' : ''}{formatNumber(movement.delta)}
                </span>
                <span class="history-reason">
                  {movement.reason ?? 'Adjustment'}
                  {#if movement.note}<span class="faint">· {movement.note}</span>{/if}
                </span>
                <span class="history-date">{formatDateTime(movement.created_at)}</span>
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <div class="empty" style="padding: 30px 20px;">
          <p class="small">No stock movements recorded yet.</p>
        </div>
      {/if}
    </div>
  </div>

  <div class="stack">
    <div class="card">
      <div class="card-head">
        <h2>Stock</h2>
        <span class="hint">per {item.unit}</span>
      </div>
      <div class="card-body">
        <div class="quantity-box">
          <div>
            <div class="quantity-value {qtyClass}">
              {formatNumber(item.quantity)}<span class="quantity-unit">{item.unit}</span>
            </div>
            <div class="hint" style="margin-top: 5px;">
              {#if item.min_quantity > 0}
                Low-stock threshold: {formatNumber(item.min_quantity)} {item.unit}
              {:else}
                No low-stock threshold set
              {/if}
            </div>
          </div>
          <div class="stepper">
            <form method="POST" action="?/adjust">
              <input type="hidden" name="delta" value="-1" />
              <input type="hidden" name="reason" value="used" />
              <button class="btn" type="submit" aria-label="Remove one" title="Remove one">
                <Icon name="minus" size={15} />
              </button>
            </form>
            <form method="POST" action="?/adjust">
              <input type="hidden" name="delta" value="1" />
              <input type="hidden" name="reason" value="restock" />
              <button class="btn" type="submit" aria-label="Add one" title="Add one">
                <Icon name="plus" size={15} />
              </button>
            </form>
          </div>
        </div>

        <form method="POST" action="?/adjust" class="stack-sm" style="margin-top: 16px;">
          <div class="form-grid" style="gap: 10px;">
            <div class="field">
              <label class="label" for="delta">Adjust by</label>
              <input
                id="delta"
                class="input"
                type="number"
                name="delta"
                step="any"
                placeholder="e.g. -5 or 25"
                required
              />
            </div>
            <div class="field">
              <label class="label" for="reason">Reason</label>
              <select id="reason" class="select" name="reason">
                <option value="purchase">Purchase</option>
                <option value="restock">Restock</option>
                <option value="used">Used</option>
                <option value="adjustment">Adjustment</option>
                <option value="return">Return</option>
                <option value="damaged">Damaged</option>
                <option value="lost">Lost</option>
              </select>
            </div>
          </div>
          <input class="input" name="note" placeholder="Note (optional)" maxlength="1000" />
          <button class="btn btn-primary" type="submit">
            <Icon name="check" size={15} />
            Update stock
          </button>
        </form>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Documents</h2>
        <span class="hint">{plural(item.documents.length, 'file')}</span>
      </div>
      <div class="card-body">
        {#if item.documents.length}
          <div class="attachment-list">
            {#each item.documents as document (document.id)}
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
          <p class="small muted" style="margin-bottom: 12px;">
            Datasheets, manuals and receipts will appear here.
          </p>
        {/if}
      </div>
      <div class="card-foot">
        <UploadForm
          action="?/upload"
          targetName="item_id"
          targetId={item.id}
          kind="document"
          title="Add a document"
        />
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <div class="row-between">
          <div>
            <strong class="small">Item actions</strong>
            <p class="small muted" style="margin-top: 2px;">Edit the record or remove it entirely.</p>
          </div>
          <div class="row">
            <a class="btn btn-sm" href={h(`/items/${item.id}/edit`)}>
              <Icon name="edit" size={14} />
              Edit
            </a>
          </div>
        </div>
        <div class="divider"></div>
        <div class="row">
          <form method="POST" action="?/toggleHomeAssistant">
            <button class="btn btn-sm" type="submit">
              <Icon name="home" size={14} />
              {item.ha_enabled ? 'Stop publishing to Home Assistant' : 'Publish to Home Assistant'}
            </button>
          </form>
          <form method="POST" action="?/archive">
            <button class="btn btn-sm" type="submit">
              <Icon name="archive" size={14} />
              {item.archived ? 'Restore item' : 'Archive item'}
            </button>
          </form>
          <form method="POST" action="?/delete" onsubmit={confirmDelete}>
            <button class="btn btn-sm btn-danger" type="submit">
              <Icon name="trash" size={14} />
              Delete
            </button>
          </form>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .service-record {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px;
  }

  .service-record-notes {
    white-space: pre-wrap;
    margin-top: 8px;
    color: var(--text-soft);
  }

  .service-details > summary {
    list-style: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    width: fit-content;
  }

  .service-details > summary::-webkit-details-marker {
    display: none;
  }

  .service-edit-form {
    margin-top: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    min-width: min(340px, 80vw);
  }

  .service-upload-toggle {
    margin-top: 8px;
  }

  .service-overdue {
    color: var(--danger);
  }
</style>
