<script lang="ts">
  import { page } from '$app/state';
  import type { LocationFormValues } from '$lib/form-types';
  import type { Location } from '$lib/types';
  import { withBase } from '$lib/paths';
  import Icon from './Icon.svelte';
  import LocationSelect from './LocationSelect.svelte';

  let {
    values,
    locations,
    submitLabel = 'Save location',
    cancelHref = '/locations',
    error = '',
    details = []
  }: {
    values: LocationFormValues;
    locations: Location[];
    submitLabel?: string;
    cancelHref?: string;
    error?: string;
    details?: Array<{ field: string; message: string }>;
  } = $props();

  const cancel = $derived(withBase(page.data.ingressPath ?? '', cancelHref));
</script>

<form method="POST" class="stack" style="max-width: 760px;">
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
      <h2>Location</h2>
      <span class="hint">Rooms, cupboards, drawers, bins…</span>
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
            placeholder="e.g. Drawer 1a"
            maxlength="120"
            required
          />
        </div>

        <div class="field full">
          <label class="label" for="parent_id">Parent location</label>
          <LocationSelect
            locations={locations}
            value={values.parent_id}
            name="parent_id"
            id="parent_id"
            emptyLabel="Top level (no parent)"
            fullPath
          />
          <span class="hint">Leave empty for a top-level location. Nesting has no depth limit.</span>
        </div>

        <div class="field">
          <label class="label" for="code">Short code</label>
          <input
            id="code"
            class="input mono"
            name="code"
            value={values.code}
            placeholder="e.g. D1A"
            maxlength="60"
          />
        </div>

        <div class="field full">
          <label class="label" for="description">Description</label>
          <textarea
            id="description"
            class="textarea"
            name="description"
            rows="3"
            placeholder="What is stored here? Any labelling notes?"
          >{values.description}</textarea>
        </div>
      </div>
    </div>
  </div>

  <div class="form-actions">
    <button class="btn btn-primary" type="submit">
      <Icon name="check" size={16} />
      {submitLabel}
    </button>
    <a class="btn btn-ghost" href={cancel}>Cancel</a>
  </div>
</form>
