<script lang="ts">
  import { page } from '$app/state';
  import type { ItemFormOptions, ItemFormValues } from '$lib/form-types';
  import { withBase } from '$lib/paths';
  import Icon from './Icon.svelte';
  import KeyValueEditor from './KeyValueEditor.svelte';
  import LocationSelect from './LocationSelect.svelte';

  let {
    values,
    options,
    submitLabel = 'Save item',
    addAnotherLabel = 'Save and add another',
    cancelHref = '/items',
    error = '',
    details = [],
    scanMode = false,
    focusSku = false
  }: {
    values: ItemFormValues;
    options: ItemFormOptions;
    submitLabel?: string;
    addAnotherLabel?: string;
    cancelHref?: string;
    error?: string;
    details?: Array<{ field: string; message: string }>;
    scanMode?: boolean;
    focusSku?: boolean;
  } = $props();

  const cancel = $derived(withBase(page.data.ingressPath ?? '', cancelHref));
  const pricingEnabled = $derived(page.data.pricingEnabled ?? true);

  // Focusing through an action rather than the autofocus attribute avoids the
  // a11y warning and lets us select any leftover text so a scanner replaces it.
  function focusSelect(node: HTMLInputElement, enabled: boolean) {
    let frame: number | undefined;

    function focus() {
      if (!enabled) return;
      frame = requestAnimationFrame(() => {
        node.focus();
        node.select();
      });
    }

    focus();
    return {
      update(next: boolean) {
        enabled = next;
        focus();
      },
      destroy() {
        if (frame !== undefined) cancelAnimationFrame(frame);
      }
    };
  }
</script>

<form method="POST" class="stack">
  {#if error}
    <div class="alert alert-error" role="alert">
      <Icon name="alert" size={17} />
      <div>
        <strong>{error}</strong>
        {#if details.length}
          <ul>
            {#each details as detail}
              <li><span class="mono">{detail.field}</span> — {detail.message}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}

  <div class="card">
    <div class="card-head">
      <h2>Basics</h2>
      <span class="hint">What is it?</span>
    </div>
    <div class="card-body">
      <div class="form-grid">
        <div class="field full">
          <label class="label" for="name">Name <span class="optional">required</span></label>
          <input
            id="name"
            class="input"
            name="name"
            value={values.name}
            placeholder="e.g. 10kΩ resistor 0.25W"
            required
            maxlength="200"
          />
        </div>

        <div class="field">
          <label class="label" for="sku">SKU / part code</label>
          <input
            id="sku"
            class="input mono"
            name="sku"
            value={values.sku}
            placeholder="e.g. RES-10K-025"
            maxlength="120"
            use:focusSelect={focusSku}
          />
          {#if focusSku}
            <span class="hint">Scan or type the SKU, then press Enter to save and add another.</span>
          {/if}
        </div>

        <div class="field">
          <label class="label" for="category">Category</label>
          <input
            id="category"
            class="input"
            name="category"
            list="category-options"
            value={values.category}
            placeholder="e.g. Resistors"
            maxlength="120"
          />
          <datalist id="category-options">
            {#each options.categories as category}
              <option value={category.category}></option>
            {/each}
          </datalist>
        </div>

        <div class="field full">
          <label class="label" for="description">Description</label>
          <textarea
            id="description"
            class="textarea"
            name="description"
            placeholder="Specs, package, tolerance, anything useful…"
            rows="3"
          >{values.description}</textarea>
        </div>

        <div class="field full">
          <label class="label" for="tags">Tags</label>
          <input
            id="tags"
            class="input"
            name="tags"
            value={values.tags}
            placeholder="through-hole, 10k, axial"
          />
          <span class="hint">Separate tags with commas.</span>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>Stock &amp; storage</h2>
      <span class="hint">How many, and where?</span>
    </div>
    <div class="card-body">
      <div class="form-grid">
        <div class="field">
          <label class="label" for="quantity">Quantity</label>
          <input
            id="quantity"
            class="input"
            type="number"
            name="quantity"
            value={values.quantity}
            min="0"
            step="any"
          />
        </div>

        <div class="field">
          <label class="label" for="unit">Unit</label>
          <input
            id="unit"
            class="input"
            name="unit"
            list="unit-options"
            value={values.unit}
            maxlength="24"
            placeholder="pcs"
          />
          <datalist id="unit-options">
            {#each options.units as unit}
              <option value={unit}></option>
            {/each}
          </datalist>
        </div>

        <div class="field">
          <label class="label" for="min_quantity">Low-stock threshold</label>
          <input
            id="min_quantity"
            class="input"
            type="number"
            name="min_quantity"
            value={values.min_quantity}
            min="0"
            step="any"
          />
          <span class="hint">Flag the item when quantity reaches this level. 0 disables it.</span>
        </div>

        <div class="field">
          <label class="label" for="location_id">Location</label>
          <LocationSelect locations={options.locations} value={values.location_id} />
        </div>

        <div class="field full">
          <label class="check">
            <input type="checkbox" name="archived" checked={values.archived} />
            Archived (hidden from normal lists)
          </label>
        </div>

        <div class="field full">
          <label class="check">
            <input type="checkbox" name="ha_enabled" checked={values.ha_enabled} />
            Publish this item to Home Assistant
          </label>
          <span class="hint">
            New items are not published by default. Published items stay visible even when their
            location is not published, so vital stock can still be monitored. Their entities are
            grouped under the nearest published location, or the Inventory hub.
          </span>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>Service schedule</h2>
      <span class="hint">Optional</span>
    </div>
    <div class="card-body">
      <div class="form-grid">
        <div class="field">
          <label class="label" for="service_interval_months">Service interval (months)</label>
          <input
            id="service_interval_months"
            class="input"
            type="number"
            name="service_interval_months"
            value={values.service_interval_months}
            min="1"
            max="120"
            step="1"
            placeholder="e.g. 12"
          />
          <span class="hint">Leave blank to disable the schedule.</span>
        </div>

        <div class="field">
          <label class="label" for="service_next_due">Next service due</label>
          <input
            id="service_next_due"
            class="input"
            type="date"
            name="service_next_due"
            value={values.service_next_due}
          />
          <span class="hint">Logging a service advances this date by the interval.</span>
        </div>

        <div class="field full">
          <label class="label" for="service_notes">Service notes</label>
          <textarea
            id="service_notes"
            class="textarea"
            name="service_notes"
            rows="3"
            placeholder="Maintenance instructions, lubricants, replacement parts…"
          >{values.service_notes}</textarea>
          <span class="hint">
            When a Home Assistant calendar is configured, the next due date is added as an all-day
            event and moved forward automatically after each service.
          </span>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>Sourcing</h2>
      <span class="hint">{pricingEnabled ? 'Where it came from and what it cost' : 'Where it came from'}</span>
    </div>
    <div class="card-body">
      <div class="form-grid">
        <div class="field">
          <label class="label" for="manufacturer">Manufacturer</label>
          <input id="manufacturer" class="input" name="manufacturer" value={values.manufacturer} maxlength="160" />
        </div>

        <div class="field">
          <label class="label" for="mpn">Manufacturer part number</label>
          <input id="mpn" class="input mono" name="mpn" value={values.mpn} maxlength="160" />
        </div>

        <div class="field">
          <label class="label" for="supplier">Supplier</label>
          <input id="supplier" class="input" name="supplier" value={values.supplier} maxlength="160" />
        </div>

        <div class="field">
          <label class="label" for="supplier_url">Supplier URL</label>
          <input
            id="supplier_url"
            class="input"
            type="url"
            name="supplier_url"
            value={values.supplier_url}
            placeholder="https://"
          />
        </div>

        {#if pricingEnabled}
          <div class="field">
            <label class="label" for="price">Unit price</label>
            <input
              id="price"
              class="input"
              type="number"
              name="price"
              value={values.price}
              min="0"
              step="any"
              placeholder="0.00"
            />
          </div>

          <div class="field">
            <label class="label" for="currency">Currency</label>
            <input
              id="currency"
              class="input mono"
              name="currency"
              list="currency-options"
              value={values.currency}
              maxlength="3"
              style="text-transform: uppercase;"
            />
            <datalist id="currency-options">
              {#each options.currencies as currency}
                <option value={currency}></option>
              {/each}
            </datalist>
          </div>
        {/if}

        <div class="field full">
          <label class="label" for="datasheet_url">Datasheet URL</label>
          <input
            id="datasheet_url"
            class="input"
            type="url"
            name="datasheet_url"
            value={values.datasheet_url}
            placeholder="https://"
          />
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>Notes &amp; extra fields</h2>
      <span class="hint">Anything else worth remembering</span>
    </div>
    <div class="card-body">
      <div class="form-grid">
        <div class="field full">
          <label class="label" for="notes">Notes</label>
          <textarea
            id="notes"
            class="textarea"
            name="notes"
            rows="4"
            placeholder="Bin contents, condition, quirks, project notes…"
          >{values.notes}</textarea>
        </div>

        <div class="field full">
          <div class="label">Custom fields</div>
          <KeyValueEditor initial={values.custom_fields} />
          <span class="hint">Stored as key/value pairs. Useful for tolerance, voltage, package, etc.</span>
        </div>
      </div>
    </div>
  </div>

  <div class="form-actions">
    {#if scanMode}
      <button class="btn btn-primary" type="submit" name="intent" value="add_another">
        <Icon name="plus" size={16} />
        {addAnotherLabel}
      </button>
      <button class="btn" type="submit" name="intent" value="save">
        <Icon name="check" size={16} />
        {submitLabel}
      </button>
    {:else}
      <button class="btn btn-primary" type="submit" name="intent" value="save">
        <Icon name="check" size={16} />
        {submitLabel}
      </button>
      <button class="btn" type="submit" name="intent" value="add_another">
        <Icon name="plus" size={16} />
        {addAnotherLabel}
      </button>
    {/if}
    <a class="btn btn-ghost" href={cancel}>Cancel</a>
  </div>
</form>
