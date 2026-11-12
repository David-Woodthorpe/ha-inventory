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
    <h1 class="page-title">{data.copiedFrom ? 'Add another item' : 'Add item'}</h1>
    <p class="page-sub">
      {#if data.copiedFrom}
        Copied from <strong>{data.copiedFrom.name}</strong>. The SKU has been cleared so you can scan
        the next one — pressing Enter saves and opens another copy.
      {:else}
        Record what it is, how many you have and where it lives. Photos and documents can be added
        straight after saving.
      {/if}
    </p>
  </div>
</div>

<ItemForm
  values={form?.values ?? data.values}
  options={data.options}
  error={form?.error ?? ''}
  details={form?.details ?? []}
  submitLabel="Add item"
  addAnotherLabel="Save and add another"
  cancelHref={data.copiedFrom ? `/items/${data.copiedFrom.id}` : '/items'}
  scanMode={data.focusSku}
  focusSku={data.focusSku}
/>
