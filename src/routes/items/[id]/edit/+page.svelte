<script lang="ts">
  import { page } from '$app/state';
  import type { ActionData, PageData } from './$types';
  import ItemForm from '$lib/components/ItemForm.svelte';
  import { withBase } from '$lib/paths';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
</script>

<svelte:head>
  <title>Edit {data.item.name} · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">
      <a class="link" href={h(`/items/${data.item.id}`)}>← Back to item</a>
    </div>
    <h1 class="page-title">Edit item</h1>
    <p class="page-sub">{data.item.name}</p>
  </div>
</div>

<ItemForm
  values={form?.values ?? data.values}
  options={data.options}
  error={form?.error ?? ''}
  details={form?.details ?? []}
  submitLabel="Save changes"
  cancelHref={`/items/${data.item.id}`}
/>
