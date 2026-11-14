<script lang="ts">
  import { onDestroy } from 'svelte';
  import { page } from '$app/state';
  import type { CategoryFormValues } from '$lib/form-types';
  import { iconNames } from '$lib/icons';
  import { withBase } from '$lib/paths';
  import Icon from './Icon.svelte';

  let {
    values,
    imageUrl = null,
    submitLabel = 'Save category',
    cancelHref = '/categories',
    error = '',
    details = []
  }: {
    values: CategoryFormValues;
    imageUrl?: string | null;
    submitLabel?: string;
    cancelHref?: string;
    error?: string;
    details?: Array<{ field: string; message: string }>;
  } = $props();

  // svelte-ignore state_referenced_locally
  let selectedIcon = $state(values.icon);
  let preview = $state<string | null>(null);

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
  const cancel = $derived(h(cancelHref));

  onDestroy(() => {
    if (preview) URL.revokeObjectURL(preview);
  });

  function onImageChange(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (preview) URL.revokeObjectURL(preview);
    preview = file ? URL.createObjectURL(file) : null;
  }
</script>

<form method="POST" action="?/save" enctype="multipart/form-data" class="stack" style="max-width: 820px;">
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
      <h2>Category</h2>
      <span class="hint">How items are grouped</span>
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
            placeholder="e.g. Resistors"
            maxlength="120"
            required
          />
          <span class="hint">
            Renaming a category updates every item that uses it. Names are case-insensitive.
          </span>
        </div>

        <div class="field full">
          <label class="label" for="description">Description</label>
          <textarea
            id="description"
            class="textarea"
            name="description"
            rows="3"
            placeholder="What belongs in this category?"
          >{values.description}</textarea>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>Icon &amp; image</h2>
      <span class="hint">Shown on items without a photo</span>
    </div>
    <div class="card-body">
      <div class="field">
        <div class="label" id="icon-label">Icon</div>
        <div class="icon-picker" role="radiogroup" aria-labelledby="icon-label">
          <label class="icon-option icon-option-none" class:active={selectedIcon === ''}>
            <input class="icon-radio" type="radio" name="icon" value="" bind:group={selectedIcon} />
            <span>None</span>
          </label>
          {#each iconNames as icon (icon)}
            <label class="icon-option" class:active={selectedIcon === icon} title={icon}>
              <input
                class="icon-radio"
                type="radio"
                name="icon"
                value={icon}
                bind:group={selectedIcon}
                aria-label={icon}
              />
              <Icon name={icon} size={19} />
            </label>
          {/each}
        </div>
        <span class="hint">
          Choose a built-in icon for a crisp fallback at any size. An uploaded image takes priority
          over the icon.
        </span>
      </div>

      <div class="divider"></div>

      <div class="field">
        <label class="label" for="image">Category image</label>
        {#if preview || imageUrl}
          <div class="image-preview">
            <img src={preview ?? h(imageUrl ?? '')} alt="" />
          </div>
        {/if}
        <input
          id="image"
          class="input file-input"
          type="file"
          name="image"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,image/svg+xml"
          onchange={onImageChange}
        />
        <span class="hint">
          JPEG, PNG, WebP, GIF, AVIF, BMP or SVG. The image is displayed on items in this category
          when they have no photo of their own.
        </span>
      </div>

      {#if imageUrl}
        <label class="check">
          <input type="checkbox" name="remove_image" value="1" />
          Remove the current image
        </label>
      {/if}
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

<style>
  .icon-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 4px;
  }

  .icon-option {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--text-soft);
    cursor: pointer;
  }

  .icon-option:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .icon-option.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .icon-option:has(.icon-radio:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .icon-option-none {
    width: auto;
    padding: 0 12px;
    font-size: 12px;
  }

  .icon-radio {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .image-preview {
    width: 180px;
    height: 120px;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface-2);
    margin-bottom: 9px;
  }

  .image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .file-input {
    padding: 8px;
    height: auto;
  }
</style>
