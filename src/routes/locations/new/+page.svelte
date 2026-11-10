<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import LocationForm from '$lib/components/LocationForm.svelte';

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>New location · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">Storage</div>
    <h1 class="page-title">New location</h1>
    <p class="page-sub">
      Locations nest freely. Pick a parent to create a sublocation, or leave it empty for a top-level
      location.
    </p>
  </div>
</div>

<LocationForm
  values={form?.values ?? data.values}
  locations={data.locations}
  error={form?.error ?? ''}
  details={form?.details ?? []}
  submitLabel="Create location"
  cancelHref="/locations"
/>
