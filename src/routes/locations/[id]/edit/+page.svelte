<script lang="ts">
  import { page } from '$app/state';
  import type { ActionData, PageData } from './$types';
  import LocationForm from '$lib/components/LocationForm.svelte';
  import { withBase } from '$lib/paths';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
</script>

<svelte:head>
  <title>Edit {data.location.name} · Inventory</title>
</svelte:head>

<div class="page-head">
  <div>
    <div class="eyebrow">
      <a class="link" href={h(`/locations/${data.location.id}`)}>← Back to location</a>
    </div>
    <h1 class="page-title">Edit location</h1>
    <p class="page-sub">{data.location.path_label}</p>
  </div>
</div>

<LocationForm
  values={form?.values ?? data.values}
  locations={data.locations}
  error={form?.error ?? ''}
  details={form?.details ?? []}
  submitLabel="Save changes"
  cancelHref={`/locations/${data.location.id}`}
/>
