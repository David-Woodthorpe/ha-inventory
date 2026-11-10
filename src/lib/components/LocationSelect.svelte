<script lang="ts">
  import type { Location } from '$lib/types';

  let {
    locations,
    value = '',
    name = 'location_id',
    emptyLabel = 'Unassigned',
    id = 'location_id',
    fullPath = false
  }: {
    locations: Location[];
    value?: string | null;
    name?: string;
    emptyLabel?: string;
    id?: string;
    fullPath?: boolean;
  } = $props();

  const indent = (depth: number) => '— '.repeat(Math.max(0, depth));
</script>

<select {id} {name} class="select">
  <option value="">{emptyLabel}</option>
  {#each locations as location (location.id)}
    <option value={location.id} selected={location.id === (value ?? '')}>
      {fullPath
        ? location.path_label
        : `${indent(location.depth)}${location.name}${location.code ? ` (${location.code})` : ''}`}
    </option>
  {/each}
</select>
