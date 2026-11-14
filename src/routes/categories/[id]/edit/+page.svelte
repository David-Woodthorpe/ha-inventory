<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import CategoryForm from '$lib/components/CategoryForm.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { plural } from '$lib/format';
  import { withBase } from '$lib/paths';
  import { page } from '$app/state';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);

  function confirmDelete(event: SubmitEvent) {
    const count = data.category.item_count;
    const message =
      count > 0
        ? `Delete “${data.category.name}”? ${plural(count, 'item')} will become uncategorised. The items themselves are kept.`
        : `Delete “${data.category.name}”?`;
    if (!confirm(message)) event.preventDefault();
  }
</script>

<svelte:head>
  <title>Edit {data.category.name} · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">Catalogue</div>
    <h1 class="page-title">Edit category</h1>
    <p class="page-sub">
      Update the name, description, icon or image for <strong>{data.category.name}</strong>.
    </p>
  </div>
  <div class="page-actions">
    <a class="btn" href={h(`/items?category=${encodeURIComponent(data.category.name)}`)}>
      <Icon name="box" size={16} />
      View items
    </a>
  </div>
</div>

<CategoryForm
  values={form?.values ?? data.values}
  imageUrl={data.category.image_url}
  error={form?.error ?? ''}
  details={form?.details ?? []}
  submitLabel="Save changes"
/>

<div class="card" style="max-width: 820px;">
  <div class="card-body">
    <div class="row-between">
      <div>
        <strong class="small">Delete this category</strong>
        <p class="small muted" style="margin-top: 2px;">
          Items stay in the inventory but lose this category label.
        </p>
      </div>
      <form method="POST" action="?/delete" onsubmit={confirmDelete}>
        <button class="btn btn-danger" type="submit">
          <Icon name="trash" size={15} />
          Delete category
        </button>
      </form>
    </div>
  </div>
</div>
