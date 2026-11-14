<script lang="ts">
  import { page } from '$app/state';
  import type { Item } from '$lib/types';
  import { withBase } from '$lib/paths';
  import Icon from './Icon.svelte';

  let {
    item,
    size = 38,
    class: className = ''
  }: { item: Item; size?: number; class?: string } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
  const style = $derived(`width:${size}px;height:${size}px;`);
</script>

{#if item.photo}
  <img class="thumb {className}" {style} src={h(item.photo.url)} alt="" loading="lazy" />
{:else if item.category_image_url}
  <img
    class="thumb thumb-category {className}"
    {style}
    src={h(item.category_image_url)}
    alt=""
    loading="lazy"
    title={item.category ?? undefined}
  />
{:else}
  <span
    class="thumb thumb-empty {className}"
    {style}
    title={item.category ?? 'No category set'}
  >
    <Icon name={item.category_icon ?? 'box'} size={Math.max(12, Math.round(size * 0.45))} />
  </span>
{/if}
