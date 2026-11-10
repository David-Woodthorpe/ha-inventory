<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import Icon from '$lib/components/Icon.svelte';
  import { formatMoney, formatNumber, plural } from '$lib/format';
  import { withBase } from '$lib/paths';

  let { data }: { data: PageData } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
  const stats = $derived(data.stats);
  const maxCategory = $derived(Math.max(1, ...data.categories.map((category) => category.count)));
  const isEmpty = $derived(stats.item_count === 0);
</script>

<svelte:head>
  <title>Overview · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">
      <Icon name="dashboard" size={13} />
      Workspace
    </div>
    <h1 class="page-title">Overview</h1>
    <p class="page-sub">Everything in your workshop, at a glance.</p>
  </div>
  <div class="page-actions">
    <a class="btn" href={h('/locations/new')}>
      <Icon name="pin" size={16} />
      Add location
    </a>
    <a class="btn btn-primary" href={h('/items/new')}>
      <Icon name="plus" size={16} />
      Add item
    </a>
  </div>
</div>

<div class="stat-grid">
  <div class="stat">
    <div class="stat-icon"><Icon name="box" size={19} /></div>
    <div class="stat-label">Items</div>
    <div class="stat-value">{formatNumber(stats.item_count)}</div>
    <div class="stat-foot">{formatNumber(stats.total_units)} units on hand</div>
  </div>
  <div class="stat">
    <div class="stat-icon"><Icon name="pin" size={19} /></div>
    <div class="stat-label">Locations</div>
    <div class="stat-value">{formatNumber(stats.location_count)}</div>
    <div class="stat-foot">Nested storage tree</div>
  </div>
  <div class="stat" class:stat-accent={stats.low_stock_count > 0}>
    <div class="stat-icon"><Icon name="alert" size={19} /></div>
    <div class="stat-label">Low stock</div>
    <div class="stat-value">{formatNumber(stats.low_stock_count)}</div>
    <div class="stat-foot">
      {#if stats.low_stock_count > 0}
        <a class="link" href={h('/items?low=1')}>Review items</a>
      {:else}
        Everything is above its threshold
      {/if}
    </div>
  </div>
  {#if data.pricingEnabled}
    <div class="stat">
      <div class="stat-icon"><Icon name="tag" size={19} /></div>
      <div class="stat-label">Inventory value</div>
      <div class="stat-value">{formatMoney(stats.total_value, stats.currency)}</div>
      <div class="stat-foot">Estimated at unit price</div>
    </div>
  {/if}
</div>

{#if isEmpty}
  <div class="card">
    <div class="card-body">
      <div class="empty" style="padding-bottom: 24px;">
        <div class="empty-icon"><Icon name="box" size={24} /></div>
        <h3>Your inventory is empty</h3>
        <p>
          Set up a few nested locations, then start adding parts. Photos, datasheets and manuals can be
          attached to any item.
        </p>
        <div class="row" style="justify-content: center; margin-top: 6px;">
          <a class="btn btn-primary" href={h('/items/new')}>
            <Icon name="plus" size={16} />
            Add your first item
          </a>
          <a class="btn" href={h('/locations/new')}>Create a location</a>
        </div>
      </div>
      <div class="onboarding">
        <div class="onboarding-step">
          <div class="step-num">1</div>
          <strong class="small">Build the location tree</strong>
          <p class="small muted" style="margin-top: 4px;">
            Office → Drawer unit 1 → Drawer 1a. Locations can nest as deep as you like.
          </p>
        </div>
        <div class="onboarding-step">
          <div class="step-num">2</div>
          <strong class="small">Add your parts</strong>
          <p class="small muted" style="margin-top: 4px;">
            Track quantity, unit, low-stock threshold, supplier{data.pricingEnabled ? ', price' : ''} and custom fields.
          </p>
        </div>
        <div class="onboarding-step">
          <div class="step-num">3</div>
          <strong class="small">Attach photos &amp; docs</strong>
          <p class="small muted" style="margin-top: 4px;">
            Upload photos, datasheets and manuals straight from an item or location page.
          </p>
        </div>
      </div>
    </div>
  </div>
{:else}
  <div class="dash-grid">
    <div class="stack">
      <div class="card">
        <div class="card-head">
          <h2>Recently added</h2>
          <a class="link small" href={h('/items?sort=created_at')}>View all</a>
        </div>
        {#if data.recent.length}
          <div class="recent-list">
            {#each data.recent as item (item.id)}
              <a class="recent-row" href={h(`/items/${item.id}`)}>
                {#if item.photo}
                  <img class="thumb" src={h(item.photo.url)} alt="" loading="lazy" />
                {:else}
                  <span class="thumb thumb-empty"><Icon name="box" size={17} /></span>
                {/if}
                <div style="min-width: 0;">
                  <div class="recent-name truncate">{item.name}</div>
                  <div class="recent-sub truncate">
                    {item.category ?? 'Uncategorised'}
                    {#if item.location}· {item.location.path_label}{/if}
                  </div>
                </div>
                <div class="recent-qty">
                  <div class="qty" class:low={item.low_stock} class:zero={item.quantity <= 0}>
                    {formatNumber(item.quantity)}
                  </div>
                  <div class="recent-sub">{item.unit}</div>
                </div>
              </a>
            {/each}
          </div>
        {:else}
          <div class="empty">
            <p>No items yet.</p>
          </div>
        {/if}
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Low stock</h2>
          {#if data.lowStock.length}
            <a class="link small" href={h('/items?low=1')}>View all</a>
          {/if}
        </div>
        {#if data.lowStock.length}
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="num">On hand</th>
                  <th class="num hide-sm">Threshold</th>
                </tr>
              </thead>
              <tbody>
                {#each data.lowStock as item (item.id)}
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
                          <span class="cell-sub">{item.location?.path_label ?? 'Unassigned'}</span>
                        </span>
                      </a>
                    </td>
                    <td class="num">
                      <span class="qty" class:zero={item.quantity <= 0} class:low={item.low_stock}>
                        {formatNumber(item.quantity)} {item.unit}
                      </span>
                    </td>
                    <td class="num hide-sm muted">{formatNumber(item.min_quantity)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="empty" style="padding: 34px 20px;">
            <div class="empty-icon" style="width: 42px; height: 42px;">
              <Icon name="check" size={20} />
            </div>
            <p>Nothing is below its low-stock threshold.</p>
          </div>
        {/if}
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="card-head">
          <h2>Top categories</h2>
          <a class="link small" href={h('/items')}>Browse</a>
        </div>
        <div class="card-body">
          {#if data.categories.length}
            <div class="category-bar">
              {#each data.categories as category (category.category)}
                <a class="category-row" href={h(`/items?category=${encodeURIComponent(category.category)}`)}>
                  <span class="category-name">{category.category}</span>
                  <span class="category-track">
                    <span
                      class="category-fill"
                      style={`width: ${Math.max(4, (category.count / maxCategory) * 100)}%`}
                    ></span>
                  </span>
                  <span class="category-count">{category.count}</span>
                </a>
              {/each}
            </div>
          {:else}
            <p class="muted small">Add categories to your items to see a breakdown here.</p>
          {/if}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Locations</h2>
          <a class="link small" href={h('/locations')}>Manage</a>
        </div>
        <div class="card-body" style="padding: 10px 12px;">
          {#if data.locations.length}
            <div class="stack-sm">
              {#each data.locations as location (location.id)}
                <a class="child-card" href={h(`/locations/${location.id}`)}>
                  <span class="child-card-icon"><Icon name="folder" size={17} /></span>
                  <span style="min-width: 0;">
                    <span class="child-card-name truncate" style="display: block;">{location.name}</span>
                    <span class="child-card-meta">
                      {plural(location.total_item_count, 'item')}
                      {#if location.child_count}· {plural(location.child_count, 'sublocation')}{/if}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={15} />
                </a>
              {/each}
            </div>
          {:else}
            <div class="empty" style="padding: 26px 12px;">
              <p class="small">No locations yet. <a class="link" href={h('/locations/new')}>Create one</a>.</p>
            </div>
          {/if}
        </div>
      </div>

      <div class="card">
        <div class="card-body">
          <div class="row" style="align-items: flex-start;">
            <span class="child-card-icon" style="flex: none;"><Icon name="sparkles" size={18} /></span>
            <div>
              <strong class="small">AI-ready API</strong>
              <p class="small muted" style="margin-top: 3px;">
                Every item, location and file is available over a clean REST API. Point an agent at
                <a class="link" href={h('/llms.txt')}>/llms.txt</a>.
              </p>
              <a class="btn btn-sm" href={h('/api')} style="margin-top: 10px;">
                <Icon name="code" size={14} />
                API &amp; AI
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
