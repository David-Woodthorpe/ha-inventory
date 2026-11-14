<script lang="ts">
  import { iconPaths } from '$lib/icons';

  let {
    name,
    size = 20,
    strokeWidth = 1.8,
    class: className = ''
  }: { name: string; size?: number; strokeWidth?: number; class?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html iconPaths[name] ?? ''}
</svg>
