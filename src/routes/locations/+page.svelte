<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import type { LocationNode } from '$lib/types';
  import Icon from '$lib/components/Icon.svelte';
  import { plural } from '$lib/format';
  import { withBase } from '$lib/paths';

  let { data }: { data: PageData } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);

  let collapsed = $state(new Set<string>());

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }
</script>

{#snippet node(location: LocationNode)}
  <div class="tree-node">
    <div class="tree-row">
      {#if location.children.length}
        <button
          class="tree-caret"
          type="button"
          aria-label={collapsed.has(location.id) ? 'Expand' : 'Collapse'}
          onclick={() => toggle(location.id)}
        >
          <Icon name={collapsed.has(location.id) ? 'chevronRight' : 'chevronDown'} size={15} />
        </button>
      {:else}
        <span class="tree-caret placeholder"></span>
      {/if}

      <span class="tree-icon"><Icon name="folder" size={15} /></span>

      <a class="tree-name" href={h(`/locations/${location.id}`)}>{location.name}</a>

      {#if location.code}
        <span class="badge badge-outline mono">{location.code}</span>
      {/if}

      <span class="tree-path">
        {#if location.total_item_count > 0}
          {plural(location.total_item_count, 'item')}
        {:else}
          <span class="faint">empty</span>
        {/if}
        {#if location.children.length}
          · {plural(location.children.length, 'sublocation')}
        {/if}
      </span>

      <div class="tree-actions">
        <a
          class="icon-btn"
          href={h(`/locations/new?parent=${location.id}`)}
          title={`Add a location inside ${location.name}`}
          aria-label={`Add a location inside ${location.name}`}
        >
          <Icon name="plus" size={14} />
        </a>
        <a
          class="icon-btn"
          href={h(`/locations/${location.id}/edit`)}
          title={`Edit ${location.name}`}
          aria-label={`Edit ${location.name}`}
        >
          <Icon name="edit" size={14} />
        </a>
      </div>
    </div>

    {#if location.children.length && !collapsed.has(location.id)}
      <div class="location-children">
        {#each location.children as child (child.id)}
          {@render node(child)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<svelte:head>
  <title>Locations · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">
      <Icon name="pin" size={13} />
      Storage
    </div>
    <h1 class="page-title">Locations</h1>
    <p class="page-sub">
      A nested map of where things live. For example: Office → Drawer unit 1 → Drawer 1a.
    </p>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href={h('/locations/new')}>
      <Icon name="plus" size={16} />
      New location
    </a>
  </div>
</div>

{#if data.tree.length}
  <div class="card">
    <div class="card-head">
      <h2>Location tree</h2>
      <span class="hint">{plural(data.tree.length, 'top-level location')}</span>
    </div>
    <div class="card-body" style="padding: 10px;">
      <div class="tree">
        {#each data.tree as location (location.id)}
          {@render node(location)}
        {/each}
      </div>
    </div>
  </div>
{:else}
  <div class="card">
    <div class="empty">
      <div class="empty-icon"><Icon name="pin" size={24} /></div>
      <h3>No locations yet</h3>
      <p>
        Create a top-level location such as “Office” or “Workshop”, then add sublocations like
        “Drawer unit 1” and “Drawer 1a”.
      </p>
      <a class="btn btn-primary" href={h('/locations/new')} style="margin-top: 6px;">
        <Icon name="plus" size={16} />
        Create your first location
      </a>
    </div>
  </div>
{/if}
