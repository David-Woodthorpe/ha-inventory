<script lang="ts">
  import { untrack } from 'svelte';
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '$lib/components/Icon.svelte';
  import { plural } from '$lib/format';
  import { withBase } from '$lib/paths';
  import type { PageData } from './$types';

  type ActionResult = { success?: string; error?: string } | null;

  let { data, form }: { data: PageData; form: ActionResult } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
  const rack = $derived(data.rack);
  const location = $derived(rack.location);
  const units = $derived(rack.units ?? 0);

  /** Slot labels top-down, so the elevation reads like the cabinet. */
  const rows = $derived(
    Array.from({ length: units }, (_, index) => units - index)
  );

  /** Lowest slot with nothing in it, which is where most new kit goes. */
  function firstFree(total: number, mounts: typeof data.rack.mounts): number {
    const taken = new Set<number>();
    for (const mount of mounts) {
      for (let u = mount.u_start; u < mount.u_start + mount.u_height; u += 1) taken.add(u);
    }
    for (let u = 1; u <= total; u += 1) {
      if (!taken.has(u)) return u;
    }
    return 1;
  }

  /** Where the next mount goes; clicking an empty slot moves it. */
  let uStart = $state(untrack(() => firstFree(data.rack.units ?? 1, data.rack.mounts)));
  let uHeight = $state(1);
  const occupies = $derived(
    uStart + uHeight - 1 > 0 ? `U${uStart}` + (uHeight > 1 ? `–U${uStart + uHeight - 1}` : '') : ''
  );

  /** The mount the toolbar acts on: drag it, nudge it with the arrows, unmount it. */
  let selected = $state<string | null>(null);
  const selectedMount = $derived(rack.mounts.find((mount) => mount.id === selected) ?? null);

  let dragging = $state<{
    id: string;
    pointerId: number;
    startY: number;
    unitPx: number;
    fromU: number;
    height: number;
  } | null>(null);
  let dragTarget = $state<number | null>(null);
  let bodyEl = $state<HTMLDivElement | null>(null);
  let busy = $state(false);
  let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

  /** True when a mount at this slot would collide with, or overrun, the rack. */
  function blocked(mountId: string, u: number, height: number): string | null {
    const top = u + height - 1;
    if (u < 1) return 'That is below the bottom of the rack.';
    if (top > units) return `A ${height}U device would run past U${units}.`;
    for (const other of rack.mounts) {
      if (other.id === mountId) continue;
      const otherTop = other.u_start + other.u_height - 1;
      if (u <= otherTop && top >= other.u_start) {
        return `That slot is taken by “${other.name}”.`;
      }
    }
    return null;
  }

  async function postAction(action: string, fields: Record<string, string>, okText: string) {
    busy = true;
    message = null;
    try {
      const body = new FormData();
      for (const [key, value] of Object.entries(fields)) body.set(key, value);
      const response = await fetch(`?/${action}`, {
        method: 'POST',
        body,
        headers: { 'x-sveltekit-action': 'true' }
      });
      const result = deserialize(await response.text());
      if (result.type === 'failure') {
        message = {
          kind: 'error',
          text: (result.data as { error?: string } | undefined)?.error ?? 'That change was refused.'
        };
      } else {
        message = { kind: 'ok', text: okText };
      }
      await invalidateAll();
    } catch {
      message = { kind: 'error', text: 'Could not reach the server. Nothing changed.' };
    } finally {
      busy = false;
    }
  }

  function beginDrag(event: PointerEvent, mount: (typeof rack.mounts)[number]) {
    selected = mount.id;
    if (event.button !== 0 || !bodyEl) return;
    const rect = bodyEl.getBoundingClientRect();
    if (rect.height === 0) return;
    dragging = {
      id: mount.id,
      pointerId: event.pointerId,
      startY: event.clientY,
      unitPx: rect.height / Math.max(1, units),
      fromU: mount.u_start,
      height: mount.u_height
    };
    dragTarget = mount.u_start;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* capture is an optimisation */
    }
  }

  function moveDrag(event: PointerEvent) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    // The rack is counted upwards, so dragging up increases the slot.
    const delta = -Math.round((event.clientY - dragging.startY) / dragging.unitPx);
    dragTarget = Math.min(
      units - dragging.height + 1,
      Math.max(1, dragging.fromU + delta)
    );
  }

  function endDrag(event: PointerEvent, mount: (typeof rack.mounts)[number]) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const target = dragTarget;
    dragging = null;
    dragTarget = null;
    if (target === null || target === mount.u_start) return;
    const problem = blocked(mount.id, target, mount.u_height);
    if (problem) {
      message = { kind: 'error', text: problem };
      return;
    }
    void postAction(
      'moveMount',
      { mount_id: mount.id, u_start: String(target) },
      `“${mount.name}” moved to U${target}`
    );
  }

  /** Arrow keys move a focused mount; Delete removes it. */
  function onMountKeydown(event: KeyboardEvent, mount: (typeof rack.mounts)[number]) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const target = mount.u_start + (event.key === 'ArrowUp' ? 1 : -1);
      const problem = blocked(mount.id, target, mount.u_height);
      if (problem) {
        message = { kind: 'error', text: problem };
        return;
      }
      void postAction(
        'moveMount',
        { mount_id: mount.id, u_start: String(target) },
        `“${mount.name}” moved to U${target}`
      );
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      unmount(mount);
    }
  }

  function unmount(mount: (typeof rack.mounts)[number]) {
    if (!confirm(`Take “${mount.name}” out of the rack? Its contents stay where they are.`)) return;
    void postAction('unmountDevice', { mount_id: mount.id }, `“${mount.name}” removed from the rack`);
  }
</script>

<svelte:head>
  <title>Rack · {location.name} · Inventory</title>
</svelte:head>

<nav class="breadcrumbs" aria-label="Breadcrumb">
  <a href={h('/locations')}>Locations</a>
  {#each location.path as part, index}
    <span class="sep">/</span>
    {#if index === location.path.length - 1}
      <span>{part}</span>
    {:else}
      <a href={h(`/locations/${location.path_ids[index]}`)}>{part}</a>
    {/if}
  {/each}
</nav>

<div class="detail-head">
  <div>
    <div class="row" style="margin-bottom: 6px;">
      <span class="badge badge-accent"><Icon name="pin" size={11} /> Location</span>
      {#if location.code}
        <span class="badge badge-outline mono">{location.code}</span>
      {/if}
      {#if units > 0}
        <span class="badge">{units}U rack</span>
      {/if}
    </div>
    <h1 class="detail-title">{location.name}</h1>
  </div>
</div>

<nav class="tabs" aria-label="Location views">
  <a href={h(`/locations/${location.id}`)}><Icon name="pin" size={14} /> Overview</a>
  {#if (location.grid_cols && location.grid_rows) || location.child_count === 0}
    <a href={h(`/locations/${location.id}/map`)}><Icon name="dashboard" size={14} /> Map</a>
  {/if}
  <a class="active" href={h(`/locations/${location.id}/rack`)} aria-current="page">
    <Icon name="layers" size={14} /> Rack
  </a>
</nav>

{#if message}
  <div
    class="alert"
    class:alert-success={message.kind === 'ok'}
    class:alert-error={message.kind === 'error'}
    role="status"
    style="margin-bottom: 18px;"
  >
    <Icon name={message.kind === 'ok' ? 'check' : 'alert'} size={17} />
    {message.text}
  </div>
{:else if form?.error}
  <div class="alert alert-error" role="alert" style="margin-bottom: 18px;">
    <Icon name="alert" size={17} />
    {form.error}
  </div>
{:else if form?.success}
  <div class="alert alert-success" role="status" style="margin-bottom: 18px;">
    <Icon name="check" size={17} />
    {form.success}
  </div>
{/if}

{#if units === 0}
  <div class="card">
    <div class="card-head"><h2>Not a rack yet</h2></div>
    <div class="card-body">
      <p class="small muted">
        Give this location a rack height under <strong>Edit</strong> — a full cabinet is 42U — and its
        slots appear here.
      </p>
      <a class="btn" href={h(`/locations/${location.id}/edit`)}>
        <Icon name="edit" size={15} /> Edit location
      </a>
    </div>
  </div>
{:else}
  <div class="rack-layout">
    <div class="card">
      <div class="card-head">
        <h2>Elevation</h2>
        <span class="badge">{rack.used_units} of {units}U used</span>
      </div>

      {#if selectedMount}
        <div class="rack-toolbar">
          <span class="rack-toolbar-name">{selectedMount.name}</span>
          <span class="badge badge-outline mono">
            U{selectedMount.u_start}{selectedMount.u_height > 1
              ? `–${selectedMount.u_start + selectedMount.u_height - 1}`
              : ''}
          </span>
          <span class="badge">{selectedMount.u_height}U</span>
          <button
            class="btn btn-sm"
            type="button"
            onclick={() => unmount(selectedMount)}
            disabled={busy}
          >
            <Icon name="minus" size={14} /> Unmount
          </button>
          <button class="btn btn-sm btn-ghost" type="button" onclick={() => (selected = null)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      {/if}

      <div class="card-body">
        <div class="rack" style={`--units: ${units};`}>
          <div class="rack-gutter" aria-hidden="true">
            {#each rows as u (u)}
              <span class:every-five={u % 5 === 0}>{u}</span>
            {/each}
          </div>
          <div
            class="rack-body"
            bind:this={bodyEl}
            role="group"
            aria-label={`${units} unit rack elevation`}
          >
            {#each rows as u (u)}
              <button
                type="button"
                class="rack-slot"
                style={`bottom: calc(${u - 1} * var(--u));`}
                aria-label={`Put the next mount at U${u}`}
                title={`U${u} — click to start a mount here`}
                onclick={() => (uStart = u)}
              ></button>
            {/each}

            {#each rack.mounts as mount (mount.id)}
              <button
                type="button"
                class="rack-mount"
                class:is-shelf={mount.type === 'location'}
                class:dragging={dragging?.id === mount.id}
                class:blocked={dragging?.id === mount.id && dragTarget !== null &&
                  blocked(mount.id, dragTarget, mount.u_height) !== null}
                class:selected={selected === mount.id ||
                  (dragging?.id === mount.id && dragTarget !== null)}
                style={`bottom: calc(${(dragging?.id === mount.id && dragTarget !== null
                  ? dragTarget
                  : mount.u_start) - 1} * var(--u)); height: calc(${mount.u_height} * var(--u));`}
                title={`${mount.name} — U${mount.u_start}${mount.u_height > 1 ? `–U${mount.u_start + mount.u_height - 1}` : ''}`}
                onpointerdown={(event) => beginDrag(event, mount)}
                onpointermove={moveDrag}
                onpointerup={(event) => endDrag(event, mount)}
                onpointercancel={() => {
                  dragging = null;
                  dragTarget = null;
                }}
                onfocus={() => (selected = mount.id)}
                onclick={() => (selected = mount.id)}
                onkeydown={(event) => onMountKeydown(event, mount)}
              >
                <span class="rack-mount-name">
                  {#if mount.u_height >= 2}
                    {mount.name}
                  {:else}
                    {mount.code ?? mount.name.slice(0, 14)}
                  {/if}
                </span>
                <span class="rack-mount-u">U{mount.u_start}{mount.u_height > 1 ? `–${mount.u_start + mount.u_height - 1}` : ''}</span>
                {#if mount.type === 'location'}
                  <span class="rack-mount-tag">shelf</span>
                {:else if !mount.stored_here}
                  <span class="rack-mount-warn" title="Stored elsewhere in the inventory">!</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>
        <p class="small muted" style="margin-top: 10px;">
          Click an empty slot to start a mount there. Drag a mounted device to move it, or focus it and
          use ↑ ↓; <kbd>Delete</kbd> takes it out. Rack shelves are locations, so their own contents live
          inside them.
        </p>
      </div>
    </div>

    <div class="rack-side">
      <div class="card">
        <div class="card-head"><h2>Mount something</h2></div>
        <div class="card-body">
          <form method="POST" action="?/mountDevice" class="form-grid">
            <div class="field">
              <label class="label" for="rack-item">Item or shelf</label>
              <select class="select" id="rack-item" name="ref" required>
                <option value="" disabled selected>Choose…</option>
                {#if data.items.length}
                  <optgroup label="Items (equipment)">
                    {#each data.items as item (item.id)}
                      <option value={`item:${item.id}`}>
                        {item.name}{item.sku ? ` · ${item.sku}` : ''}
                      </option>
                    {/each}
                  </optgroup>
                {/if}
                {#if data.shelves.length}
                  <optgroup label="Shelves (sublocations)">
                    {#each data.shelves as shelf (shelf.id)}
                      <option value={`location:${shelf.id}`}>{shelf.name}</option>
                    {/each}
                  </optgroup>
                {/if}
              </select>
            </div>
            <div class="field">
              <label class="label" for="rack-u">Start at</label>
              <input class="input" id="rack-u" name="u_start" type="number" min="1" max={units} bind:value={uStart} required />
            </div>
            <div class="field">
              <label class="label" for="rack-height">Height (U)</label>
              <input class="input" id="rack-height" name="u_height" type="number" min="1" max={units} bind:value={uHeight} required />
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">
                <Icon name="plus" size={15} /> Mount {occupies}
              </button>
            </div>
          </form>
          <p class="small muted" style="margin-top: 10px;">
            Choose a slot in the elevation to fill in the start. Mounting is a position, not a stock
            move — the item stays where it is stored, and a warning marks anything racked here but
            stored elsewhere.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Mounted</h2>
          <span class="badge">{plural(rack.mounts.length, 'device')}</span>
        </div>
        <div class="card-body">
          {#if rack.mounts.length === 0}
            <p class="small muted">Nothing is mounted yet.</p>
          {:else}
            <ul class="rack-list">
              {#each rack.mounts as mount (mount.id)}
                <li>
                  <span class="rack-list-u mono">
                    U{mount.u_start}{mount.u_height > 1 ? `–${mount.u_start + mount.u_height - 1}` : ''}
                  </span>
                  <span class="rack-list-name">
                    <a
                      class="link"
                      href={h(mount.type === 'item' ? `/items/${mount.ref_id}` : `/locations/${mount.ref_id}`)}
                    >
                      {mount.name}
                    </a>
                    {#if mount.type === 'location'}
                      <span class="badge">shelf</span>
                    {:else if !mount.stored_here}
                      <span class="badge badge-low" title="Stored elsewhere in the inventory">
                        stored elsewhere
                      </span>
                    {/if}
                  </span>
                  <form method="POST" action="?/unmountDevice">
                    <input type="hidden" name="mount_id" value={mount.id} />
                    <button class="icon-btn" type="submit" title={`Unmount ${mount.name}`} aria-label={`Unmount ${mount.name}`}>
                      <Icon name="x" size={15} />
                    </button>
                  </form>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Free space</h2></div>
        <div class="card-body">
          <p class="small muted">
            {rack.free_units}U free of {units}U. Gaps between devices count as free, so the elevation
            shows what a new device could actually occupy.
          </p>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .rack-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }

  @media (max-width: 1080px) {
    .rack-layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .rack-side {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .rack {
    --u: 24px;
    display: grid;
    grid-template-columns: 34px minmax(0, 260px);
    gap: 6px;
    align-items: stretch;
  }

  .rack-gutter {
    display: flex;
    flex-direction: column;
    height: calc(var(--units) * var(--u));
  }

  .rack-gutter span {
    height: var(--u);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 6px;
    font-size: 10px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }

  .rack-gutter span.every-five {
    color: var(--muted);
    font-weight: 700;
  }

  .rack-body {
    position: relative;
    height: calc(var(--units) * var(--u));
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background-color: var(--surface-2);
    background-image: repeating-linear-gradient(
      to top,
      var(--border) 0,
      var(--border) 1px,
      transparent 1px,
      transparent var(--u)
    );
    overflow: hidden;
    cursor: crosshair;
  }

  .rack-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }

  .rack-toolbar-name {
    font-weight: 650;
    font-size: 13px;
  }

  .rack-slot {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--u);
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }

  .rack-slot:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .rack-slot:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .rack-mount {
    position: absolute;
    z-index: 1;
    left: 4px;
    right: 4px;
    margin: 1px 0;
    padding: 2px 6px;
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 4px;
    background: var(--accent-soft);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent-text);
    font-size: 11px;
    overflow: hidden;
  }

  .rack-mount.is-shelf {
    background: var(--surface-3);
    border-color: var(--border-strong);
    color: var(--text-soft);
  }

  .rack-mount {
    font: inherit;
    text-align: left;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .rack-mount.selected {
    box-shadow: 0 0 0 2px var(--accent);
  }

  .rack-mount.dragging {
    cursor: grabbing;
    opacity: 0.9;
    z-index: 3;
    box-shadow: var(--shadow);
  }

  .rack-mount.blocked {
    background: var(--danger-soft);
    border-color: var(--danger);
    color: var(--danger);
  }

  .rack-mount:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .rack-mount-name {
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .rack-mount-u {
    font-size: 9.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    flex: none;
  }

  .rack-mount-tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    flex: none;
  }

  .rack-mount-warn {
    flex: none;
    width: 14px;
    height: 14px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--warning-soft);
    color: var(--warning);
    font-size: 9px;
    font-weight: 800;
  }

  .rack-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .rack-list li {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .rack-list-u {
    flex: none;
    width: 56px;
    font-size: 11px;
    color: var(--muted);
  }

  .rack-list-name {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 6px;
    align-items: baseline;
    flex-wrap: wrap;
  }
</style>
