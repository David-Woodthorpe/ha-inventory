<script lang="ts">
  /**
   * A small, read-only view of a drawer's grid. Cells are drawn with the front
   * row at the bottom, matching the map screen: the drawer you are looking down
   * at has its handle nearest you.
   */
  let {
    cols,
    rows,
    bins,
    highlight = []
  }: {
    cols: number;
    rows: number;
    bins: Array<{ location_id: string; name: string; x: number; y: number; w: number; h: number }>;
    highlight?: string[];
  } = $props();

  const highlighted = $derived(new Set(highlight));
</script>

<div
  class="mini-map"
  style={`--cols: ${cols}; --rows: ${rows}; width: calc(190px * ${cols} / ${rows});`}
  role="img"
  aria-label={`${cols} by ${rows} drawer with ${bins.length} bins`}
>
  {#each bins as bin (bin.location_id)}
    <span
      class="mini-bin"
      class:hit={highlighted.has(bin.location_id)}
      style={`left: ${(bin.x / cols) * 100}%; bottom: ${(bin.y / rows) * 100}%; width: ${(bin.w / cols) * 100}%; height: ${(bin.h / rows) * 100}%;`}
      title={`${bin.name}${highlighted.has(bin.location_id) ? ' — holds this item' : ''}`}
    ></span>
  {/each}
</div>

<style>
  .mini-map {
    position: relative;
    height: 190px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background-color: var(--surface-2);
    background-image:
      linear-gradient(to right, var(--border) 1px, transparent 1px),
      linear-gradient(to bottom, var(--border) 1px, transparent 1px);
    background-size: calc(100% / var(--cols)) calc(100% / var(--rows));
    overflow: hidden;
    flex: none;
  }

  .mini-bin {
    position: absolute;
    margin: 2px;
    border-radius: 3px;
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
  }

  .mini-bin.hit {
    background: var(--accent);
    border-color: var(--accent-hover);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
</style>
