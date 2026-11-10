<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import ItemForm from '$lib/components/ItemForm.svelte';

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>Add item · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">Catalogue</div>
    <h1 class="page-title">Add item</h1>
    <p class="page-sub">
      Record what it is, how many you have and where it lives. Photos and documents can be added
      straight after saving.
    </p>
  </div>
</div>

<ItemForm
  values={form?.values ?? data.values}
  options={data.options}
  error={form?.error ?? ''}
  details={form?.details ?? []}
  submitLabel="Add item"
  cancelHref="/items"
/>
