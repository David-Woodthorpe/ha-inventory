<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import CategoryForm from '$lib/components/CategoryForm.svelte';

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>New category · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">Catalogue</div>
    <h1 class="page-title">New category</h1>
    <p class="page-sub">
      Give a group of items a name, an icon and optionally an image. Items in this category will use
      the artwork whenever they have no photo.
    </p>
  </div>
</div>

<CategoryForm
  values={form?.values ?? data.values}
  error={form?.error ?? ''}
  details={form?.details ?? []}
  submitLabel="Create category"
/>
