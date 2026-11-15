<script lang="ts">
  /**
   * A read-only strip of a cabinet, with one device picked out. The rack
   * equivalent of the drawer mini map: small enough to sit on an item page,
   * counted from the bottom so it matches the rack screen.
   */
  let {
    units,
    slots,
    label
  }: {
    units: number;
    slots: Array<{ name: string; u_start: number; u_height: number; is_this: boolean }>;
    label?: string;
  } = $props();
</script>

<div class="rack-strip" style={`--units: ${units};`} role="img" aria-label={label ?? `${units} unit rack`}>
  {#each slots as slot (slot.name + slot.u_start)}
    <span
      class="strip-slot"
      class:hit={slot.is_this}
      style={`bottom: calc(${slot.u_start - 1} * var(--u)); height: calc(${slot.u_height} * var(--u));`}
      title={`${slot.name} — U${slot.u_start}${
        slot.u_height > 1 ? `–U${slot.u_start + slot.u_height - 1}` : ''
      }${slot.is_this ? ' — this item' : ''}`}
    ></span>
  {/each}
</div>

<style>
  .rack-strip {
    --u: calc(150px / var(--units));
    position: relative;
    width: 84px;
    height: 150px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background-color: var(--surface-2);
    background-image: repeating-linear-gradient(
      to top,
      var(--border) 0,
      var(--border) 1px,
      transparent 1px,
      transparent calc(var(--u) * 2)
    );
    overflow: hidden;
    flex: none;
  }

  .strip-slot {
    position: absolute;
    left: 3px;
    right: 3px;
    border-radius: 2px;
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
  }

  .strip-slot.hit {
    background: var(--accent);
    border-color: var(--accent-hover);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
</style>
