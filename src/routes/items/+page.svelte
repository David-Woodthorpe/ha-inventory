<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import Icon from '$lib/components/Icon.svelte';
  import LocationSelect from '$lib/components/LocationSelect.svelte';
  import { formatDate, formatMoney, formatNumber, plural } from '$lib/format';
  import { withBase } from '$lib/paths';

  let { data }: { data: PageData } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
  const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.limit)));

  function submitFilters(event: Event) {
    const form = (event.currentTarget as HTMLInputElement | HTMLSelectElement).form;
    form?.requestSubmit();
  }

  function pageHref(target: number): string {
    const params = new URLSearchParams(page.url.searchParams);
    params.set('page', String(target));
    return h(`/items?${params.toString()}`);
  }

  function clearHref(): string {
    const params = new URLSearchParams();
    if (data.filters.sort !== 'name') params.set('sort', data.filters.sort);
    return h(params.size ? `/items?${params.toString()}` : '/items');
  }
</script>

<svelte:head>
  <title>Items · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">
      <Icon name="box" size={13} />
      Catalogue
    </div>
    <h1 class="page-title">Items</h1>
    <p class="page-sub">
      {plural(data.total, 'item')}{#if data.filters.q}{' '}matching “{data.filters.q}”{/if}{#if data.filters.low}&nbsp;· low stock{/if}{#if data.filters.archived}&nbsp;· including archived{/if}
    </p>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href={h('/items/new')}>
      <Icon name="plus" size={16} />
      Add item
    </a>
  </div>
</div>

<form class="filters" method="GET" action={h('/items')}>
  <div class="search">
    <Icon name="search" size={16} />
    <input
      class="input"
      type="search"
      name="q"
      value={data.filters.q}
      placeholder="Search name, SKU, tags, notes…"
      aria-label="Search items"
    />
  </div>

  <select
    class="select"
    name="category"
    aria-label="Filter by category"
    onchange={submitFilters}
  >
    <option value="">All categories</option>
    {#each data.options.categories as category (category.category)}
      <option value={category.category} selected={category.category === data.filters.category}>
        {category.category} ({category.count})
      </option>
    {/each}
  </select>

  <div style="min-width: 150px; max-width: 240px;">
    <LocationSelect
      locations={data.options.locations}
      value={data.filters.location}
      name="location"
      id="filter-location"
      emptyLabel="All locations"
      fullPath
    />
  </div>

  {#if data.options.tags.length}
    <select class="select" name="tag" aria-label="Filter by tag" onchange={submitFilters}>
      <option value="">All tags</option>
      {#each data.options.tags as tag (tag.tag)}
        <option value={tag.tag} selected={tag.tag === data.filters.tag}>{tag.tag} ({tag.count})</option>
      {/each}
    </select>
  {/if}

  <select class="select" name="sort" aria-label="Sort items" onchange={submitFilters}>
    <option value="name" selected={data.filters.sort === 'name'}>Name A–Z</option>
    <option value="updated_at" selected={data.filters.sort === 'updated_at'}>Recently updated</option>
    <option value="created_at" selected={data.filters.sort === 'created_at'}>Recently added</option>
    <option value="quantity" selected={data.filters.sort === 'quantity'}>Quantity</option>
    <option value="value" selected={data.filters.sort === 'value'}>Value</option>
    <option value="category" selected={data.filters.sort === 'category'}>Category</option>
  </select>

  <label class="filter-toggle" class:on={data.filters.low}>
    <input type="checkbox" name="low" value="1" checked={data.filters.low} onchange={submitFilters} />
    <Icon name="alert" size={14} />
    Low stock
  </label>

  <label class="filter-toggle" class:on={data.filters.archived}>
    <input
      type="checkbox"
      name="archived"
      value="1"
      checked={data.filters.archived}
      onchange={submitFilters}
    />
    <Icon name="archive" size={14} />
    Archived
  </label>

  {#if data.filtered}
    <a class="btn btn-ghost btn-sm" href={clearHref()}>
      <Icon name="x" size={14} />
      Clear
    </a>
  {/if}
</form>

<div class="card">
  {#if data.items.length}
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Item</th>
            <th class="hide-sm">Category</th>
            <th class="hide-sm">Location</th>
            <th class="num">Qty</th>
            <th class="num hide-sm">Value</th>
            <th class="hide-sm">Updated</th>
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
                  <span style="min-width: 0;">
                    <span class="cell-title">{item.name}</span>
                    <span class="cell-sub">
                      {#if item.sku}<span class="mono">{item.sku}</span>{/if}
                      {#if item.archived}<span class="badge badge-outline">Archived</span>{/if}
                      {#if item.low_stock}<span class="badge badge-low">Low</span>{/if}
                      {#if item.attachment_count > 0}
                        <span class="row" style="gap: 3px;">
                          <Icon name="file" size={11} />
                          {item.attachment_count}
                        </span>
                      {/if}
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
                  <a class="link" href={h(`/locations/${item.location.id}`)}>{item.location.path_label}</a>
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
              <td class="num hide-sm">{formatMoney(item.total_value, item.currency)}</td>
              <td class="hide-sm muted small">{formatDate(item.updated_at)}</td>
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
  {:else}
    <div class="empty">
      <div class="empty-icon"><Icon name={data.filtered ? 'search' : 'box'} size={24} /></div>
      <h3>{data.filtered ? 'No matching items' : 'No items yet'}</h3>
      <p>
        {#if data.filtered}
          Try a different search, or clear the filters to see everything.
        {:else}
          Add your first component, tool or supply to start building the catalogue.
        {/if}
      </p>
      <div class="row" style="justify-content: center; margin-top: 6px;">
        {#if data.filtered}
          <a class="btn" href={clearHref()}>Clear filters</a>
        {:else}
          <a class="btn btn-primary" href={h('/items/new')}>
            <Icon name="plus" size={16} />
            Add item
          </a>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if data.total > data.limit}
  <div class="pagination">
    {#if data.page > 1}
      <a class="btn btn-sm" href={pageHref(data.page - 1)}>
        <Icon name="arrowLeft" size={14} />
        Previous
      </a>
    {:else}
      <span class="btn btn-sm" style="opacity: .45; pointer-events: none;">
        <Icon name="arrowLeft" size={14} />
        Previous
      </span>
    {/if}
    <span class="page-info">Page {data.page} of {totalPages}</span>
    {#if data.page < totalPages}
      <a class="btn btn-sm" href={pageHref(data.page + 1)}>
        Next
        <Icon name="arrowRight" size={14} />
      </a>
    {:else}
      <span class="btn btn-sm" style="opacity: .45; pointer-events: none;">
        Next
        <Icon name="arrowRight" size={14} />
      </span>
    {/if}
  </div>
{/if}
