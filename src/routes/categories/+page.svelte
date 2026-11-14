<script lang="ts">
  import { page } from '$app/state';
  import type { ActionData, PageData } from './$types';
  import type { Category } from '$lib/types';
  import Icon from '$lib/components/Icon.svelte';
  import { formatDate, plural } from '$lib/format';
  import { withBase } from '$lib/paths';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);

  function confirmDelete(event: SubmitEvent, category: Category) {
    const message =
      category.item_count > 0
        ? `Delete “${category.name}”? ${plural(category.item_count, 'item')} will become uncategorised. The items themselves are kept.`
        : `Delete “${category.name}”?`;
    if (!confirm(message)) event.preventDefault();
  }
</script>

<svelte:head>
  <title>Categories · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">
      <Icon name="tag" size={13} />
      Catalogue
    </div>
    <h1 class="page-title">Categories</h1>
    <p class="page-sub">
      Group items and give each group an icon or image. The icon or image is used on items that do
      not have a photo of their own.
    </p>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href={h('/categories/new')}>
      <Icon name="plus" size={16} />
      New category
    </a>
  </div>
</div>

{#if form?.error}
  <div class="alert alert-error" role="alert" style="margin-bottom: 18px;">
    <Icon name="alert" size={17} />
    {form.error}
  </div>
{/if}

<div class="card">
  {#if data.categories.length}
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Category</th>
            <th class="num">Items</th>
            <th class="hide-sm">Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each data.categories as category (category.id)}
            <tr>
              <td>
                <a class="cell-main" href={h(`/items?category=${encodeURIComponent(category.name)}`)}>
                  {#if category.image_url}
                    <img
                      class="thumb thumb-category"
                      src={h(category.image_url)}
                      alt=""
                      loading="lazy"
                    />
                  {:else}
                    <span class="thumb thumb-empty">
                      <Icon name={category.icon ?? 'tag'} size={17} />
                    </span>
                  {/if}
                  <span style="min-width: 0;">
                    <span class="cell-title">{category.name}</span>
                    <span class="cell-sub">
                      {#if category.description}
                        <span class="truncate" style="max-width: 52ch;">{category.description}</span>
                      {:else}
                        <span class="faint">No description</span>
                      {/if}
                    </span>
                  </span>
                </a>
              </td>
              <td class="num">
                <a class="link" href={h(`/items?category=${encodeURIComponent(category.name)}`)}>
                  {category.item_count}
                </a>
              </td>
              <td class="hide-sm muted small">{formatDate(category.updated_at)}</td>
              <td style="width: 84px;">
                <div class="row" style="justify-content: flex-end; gap: 4px;">
                  <a
                    class="icon-btn"
                    href={h(`/categories/${category.id}/edit`)}
                    title={`Edit ${category.name}`}
                    aria-label={`Edit ${category.name}`}
                  >
                    <Icon name="edit" size={14} />
                  </a>
                  <form method="POST" action="?/delete" onsubmit={(event) => confirmDelete(event, category)}>
                    <input type="hidden" name="id" value={category.id} />
                    <button
                      class="icon-btn danger"
                      type="submit"
                      title={`Delete ${category.name}`}
                      aria-label={`Delete ${category.name}`}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="empty">
      <div class="empty-icon"><Icon name="tag" size={24} /></div>
      <h3>No categories yet</h3>
      <p>
        Create categories such as “Resistors”, “Cables” or “Tools”, then choose an icon or upload an
        image for each one. Items without a photo will show the category artwork instead.
      </p>
      <a class="btn btn-primary" href={h('/categories/new')} style="margin-top: 6px;">
        <Icon name="plus" size={16} />
        Create your first category
      </a>
    </div>
  {/if}
</div>
