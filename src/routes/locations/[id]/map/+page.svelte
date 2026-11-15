<script lang="ts">
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Icon from '$lib/components/Icon.svelte';
  import { formatNumber, plural } from '$lib/format';
  import {
    areaIsFree,
    effectiveFootprint,
    findFreeOrigin,
    fitsInGrid,
    occupiedCells
  } from '$lib/grid';
  import { withBase } from '$lib/paths';
  import type { DrawerBin, LooseItem } from '$lib/types';
  import type { PageData } from './$types';

  type ActionResult = { success?: string; error?: string } | null;

  let { data, form }: { data: PageData; form: ActionResult } = $props();

  const h = (path: string) => withBase(page.data.ingressPath ?? '', path);
  const layout = $derived(data.layout);
  const location = $derived(layout.location);
  const cols = $derived(layout.cols ?? 0);
  const rows = $derived(layout.rows ?? 0);
  const bins = $derived(layout.bins ?? []);
  const cells = $derived(Array.from({ length: Math.max(0, cols * rows) }, (_, index) => index));

  let gridEl = $state<HTMLDivElement | null>(null);
  let dragging = $state<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    cellW: number;
    cellH: number;
    fromX: number;
    fromY: number;
    dx: number;
    dy: number;
  } | null>(null);
  let dragTarget = $state<{ x: number; y: number } | null>(null);
  let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let busy = $state(false);
  /**
   * The bin the toolbar and the loose-item arrows act on. A ?bin= parameter
   * arrives from an item page, which links straight to the right bin.
   */
  let selected = $state<string | null>(page.url.searchParams.get('bin'));
  const selectedBin = $derived(bins.find((bin) => bin.location_id === selected) ?? null);

  /** The unsorted panel is a working mode, so it remembers being open. */
  let showUnsorted = $state(false);
  const STORAGE_KEY = 'inventory:map:unsorted';

  onMount(() => {
    try {
      showUnsorted = window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      showUnsorted = false;
    }
  });

  function toggleUnsorted() {
    showUnsorted = !showUnsorted;
    try {
      window.localStorage.setItem(STORAGE_KEY, showUnsorted ? '1' : '0');
    } catch {
      /* private mode, session-only */
    }
  }

  /** File an unsorted item into the selected bin, or into the drawer itself. */
  async function fileItem(event: SubmitEvent, item: LooseItem) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const body = new FormData(form);
    const quantity = Number(body.get('quantity') ?? 0);
    const target = selectedBin ? `“${selectedBin.name}”` : 'this drawer';
    busy = true;
    message = null;
    try {
      const response = await fetch('?/fileItem', {
        method: 'POST',
        body,
        headers: { 'x-sveltekit-action': 'true' }
      });
      const result = deserialize(await response.text());
      if (result.type === 'failure') {
        message = {
          kind: 'error',
          text: (result.data as { error?: string } | undefined)?.error ?? 'That item could not be filed.'
        };
      } else {
        message = {
          kind: 'ok',
          text: `Filed ${formatNumber(Number.isFinite(quantity) ? quantity : item.loose_quantity)} × “${item.name}” into ${target}`
        };
      }
      await invalidateAll();
    } catch {
      message = { kind: 'error', text: 'Could not reach the server. Nothing moved.' };
    } finally {
      busy = false;
    }
  }

  function confirmFileAll(event: SubmitEvent) {
    if (
      !confirm(
        `File all ${data.staging?.items.length ?? 0} unsorted item(s) into this drawer as loose items?`
      )
    ) {
      event.preventDefault();
    }
  }

  function confirmMoveAllBins(event: SubmitEvent) {
    const form = event.currentTarget as HTMLFormElement;
    const select = form.querySelector('select');
    const label = select?.selectedOptions[0]?.textContent?.trim() ?? 'another location';
    if (
      !confirm(
        `Move every bin in this location to “${label}”? Their contents travel with them and they will need placing on the new map.`
      )
    ) {
      event.preventDefault();
    }
  }

  const payloadOf = (bin: DrawerBin) => ({
    location_id: bin.location_id,
    x: bin.x,
    y: bin.y,
    w: bin.base_w,
    h: bin.base_h,
    rotation: bin.rotation
  });

  async function persist(next: DrawerBin[], note: string) {
    busy = true;
    message = null;
    try {
      const body = new FormData();
      body.set('bins', JSON.stringify(next.map(payloadOf)));
      const response = await fetch('?/saveLayout', { method: 'POST', body });
      const result = deserialize(await response.text());
      if (result.type === 'failure') {
        message = {
          kind: 'error',
          text: (result.data as { error?: string } | undefined)?.error ?? 'The server rejected that position.'
        };
        await invalidateAll();
        return;
      }
      message = { kind: 'ok', text: note };
      await invalidateAll();
    } catch {
      message = { kind: 'error', text: 'Could not reach the server. Nothing was saved.' };
    } finally {
      busy = false;
    }
  }

  /**
   * Move a loose item into the selected bin without a full page reload, so the
   * selection survives and several items can be put away in a row.
   */
  async function assignItem(event: SubmitEvent, item: LooseItem, bin: DrawerBin) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const body = new FormData(form);
    const quantity = Number(body.get('quantity') ?? 0);
    busy = true;
    message = null;
    try {
      const response = await fetch('?/assignItem', {
        method: 'POST',
        body,
        headers: { 'x-sveltekit-action': 'true' }
      });
      const result = deserialize(await response.text());
      if (result.type === 'failure') {
        message = {
          kind: 'error',
          text:
            (result.data as { error?: string } | undefined)?.error ??
            `“${item.name}” could not be moved.`
        };
      } else {
        const moved = Number.isFinite(quantity) && quantity > 0 ? quantity : item.loose_quantity;
        message = {
          kind: 'ok',
          text: `Moved ${formatNumber(moved)} × “${item.name}” into “${bin.name}”`
        };
      }
      await invalidateAll();
    } catch {
      message = { kind: 'error', text: 'Could not reach the server. Nothing was moved.' };
    } finally {
      busy = false;
    }
  }

  function beginDrag(event: PointerEvent, bin: DrawerBin) {
    selected = bin.location_id;
    if (event.button !== 0 || !gridEl) return;
    const rect = gridEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    dragging = {
      id: bin.location_id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cellW: rect.width / cols,
      cellH: rect.height / rows,
      fromX: bin.x,
      fromY: bin.y,
      dx: 0,
      dy: 0
    };
    dragTarget = { x: bin.x, y: bin.y };
    // Best effort: a synthetic or already-released pointer must not break the drag.
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* capture is an optimisation, not a requirement */
    }
  }

  function moveDrag(event: PointerEvent) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const dx = Math.round((event.clientX - dragging.startX) / dragging.cellW);
    // Row 0 is the front of the drawer, drawn at the bottom, so moving the
    // pointer up the screen moves the bin away from the front.
    const dy = -Math.round((event.clientY - dragging.startY) / dragging.cellH);
    dragging.dx = dx;
    dragging.dy = dy;
    dragTarget = { x: dragging.fromX + dx, y: dragging.fromY + dy };
  }

  function endDrag(event: PointerEvent, bin: DrawerBin) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const target = dragTarget;
    dragging = null;
    dragTarget = null;
    if (!target) return;
    if (target.x === bin.x && target.y === bin.y) return;

    const others = bins.filter((entry) => entry.location_id !== bin.location_id);
    if (!fitsInGrid(target.x, target.y, bin.base_w, bin.base_h, bin.rotation, cols, rows)) {
      message = { kind: 'error', text: `“${bin.name}” does not fit at that cell.` };
      return;
    }
    if (!areaIsFree(occupiedCells(others), target.x, target.y, bin.w, bin.h)) {
      message = { kind: 'error', text: 'That space is already taken by another bin.' };
      return;
    }
    void persist(
      others.concat([{ ...bin, x: target.x, y: target.y }]),
      `“${bin.name}” moved to cell ${target.x},${target.y}`
    );
  }

  /**
   * Portrait or landscape — a toggle, not a four-step cycle. The bin tries to
   * stay where it is (clamped inside the grid); if that will not fit it takes
   * the first free space of the new footprint instead of refusing outright.
   */
  async function toggleOrientation(bin: DrawerBin) {
    if (bin.base_w === bin.base_h) {
      message = { kind: 'error', text: `“${bin.name}” is square, so turning it changes nothing.` };
      return;
    }
    const rotation = bin.rotation === 0 ? 90 : 0;
    const [w, h] = effectiveFootprint(bin.base_w, bin.base_h, rotation);
    const others = bins.filter((entry) => entry.location_id !== bin.location_id);
    const taken = occupiedCells(others);

    const x = Math.min(Math.max(bin.x, 0), cols - w);
    const y = Math.min(Math.max(bin.y, 0), rows - h);
    let target = x >= 0 && y >= 0 && areaIsFree(taken, x, y, w, h) ? { x, y } : null;
    if (!target) target = findFreeOrigin(taken, w, h, cols, rows);
    if (!target) {
      message = { kind: 'error', text: `No free ${w}x${h} space for “${bin.name}” in this drawer.` };
      return;
    }

    await persist(
      others.concat([{ ...bin, x: target.x, y: target.y, rotation, w, h }]),
      `“${bin.name}” is now ${rotation === 90 ? 'landscape' : 'portrait'}`
    );
  }

  /** Arrow keys nudge a focused bin one cell; R turns it. */
  function onBinKeydown(event: KeyboardEvent, bin: DrawerBin) {
    const moves: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: 1 },
      ArrowDown: { x: 0, y: -1 }
    };
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      void toggleOrientation(bin);
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const target = { x: bin.x + move.x, y: bin.y + move.y };
    const others = bins.filter((entry) => entry.location_id !== bin.location_id);
    if (!fitsInGrid(target.x, target.y, bin.base_w, bin.base_h, bin.rotation, cols, rows)) {
      message = { kind: 'error', text: `“${bin.name}” cannot move any further that way.` };
      return;
    }
    if (!areaIsFree(occupiedCells(others), target.x, target.y, bin.w, bin.h)) {
      message = { kind: 'error', text: `“${bin.name}” is blocked by another bin.` };
      return;
    }
    void persist(
      others.concat([{ ...bin, x: target.x, y: target.y }]),
      `“${bin.name}” moved to cell ${target.x},${target.y}`
    );
  }

  const binStyle = (bin: DrawerBin) => {
    const shown = dragging?.id === bin.location_id && dragTarget ? dragTarget : { x: bin.x, y: bin.y };
    return [
      `left: ${(shown.x / cols) * 100}%`,
      `bottom: ${(shown.y / rows) * 100}%`,
      `width: ${(bin.w / cols) * 100}%`,
      `height: ${(bin.h / rows) * 100}%`
    ].join('; ');
  };
</script>

<svelte:head>
  <title>Map · {location.name} · Inventory</title>
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
      {#if cols > 0}
        <span class="badge">{cols} × {rows} grid</span>
      {/if}
    </div>
    <h1 class="detail-title">{location.name}</h1>
  </div>
</div>

<nav class="tabs" aria-label="Location views">
  <a href={h(`/locations/${location.id}`)}><Icon name="pin" size={14} /> Overview</a>
  <a class="active" href={h(`/locations/${location.id}/map`)} aria-current="page">
    <Icon name="dashboard" size={14} /> Map
  </a>
</nav>

{#if message}
  <div class="alert" class:alert-success={message.kind === 'ok'} class:alert-error={message.kind === 'error'} role="status" style="margin-bottom: 18px;">
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

{#if cols === 0 || rows === 0}
  <div class="card">
    <div class="card-head"><h2>Set up a drawer map</h2></div>
    <div class="card-body">
      <p class="muted small" style="margin-bottom: 14px;">
        A map splits this container into cells so each bin can be given a position. Give it the
        grid it physically holds — a Bisley drawer with 42 mm Gridfinity bins is 5 wide by 8 deep.
      </p>
      <form method="POST" action="?/setGrid" class="form-grid">
        <div class="field">
          <label class="label" for="cols">Cells across</label>
          <input class="input" id="cols" name="cols" type="number" min="1" max="64" value="5" required />
        </div>
        <div class="field">
          <label class="label" for="rows">Cells front to back</label>
          <input class="input" id="rows" name="rows" type="number" min="1" max="64" value="8" required />
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit"><Icon name="check" size={15} /> Create map</button>
        </div>
      </form>
    </div>
  </div>
{:else}
  <div class="map-layout">
    <div class="card">
      <div class="card-head">
        <h2>Grid</h2>
        <div class="map-head-actions">
          {#if data.staging}
            <button
              class="btn btn-sm"
              class:btn-primary={showUnsorted}
              type="button"
              onclick={toggleUnsorted}
              aria-pressed={showUnsorted}
              title="Show the items that are not filed yet"
            >
              <Icon name="box" size={14} />
              Unsorted ({data.staging.items.length})
            </button>
          {/if}
          <span class="badge">{layout.used_cells} of {cols * rows} cells used</span>
        </div>
      </div>

      {#if selectedBin}
        <div class="map-toolbar">
          <span class="map-toolbar-name">{selectedBin.name}</span>
          <span class="badge badge-outline mono">{selectedBin.base_w}×{selectedBin.base_h}</span>
          <span class="badge">{selectedBin.rotation === 90 ? 'landscape' : 'portrait'}</span>
          <button
            class="btn btn-sm"
            type="button"
            onclick={() => toggleOrientation(selectedBin)}
            disabled={busy || selectedBin.base_w === selectedBin.base_h}
            title={selectedBin.base_w === selectedBin.base_h
              ? 'A square bin keeps the same footprint when turned'
              : 'Turn between portrait and landscape'}
          >
            <Icon name="rotate" size={14} /> Turn
          </button>
          <button class="btn btn-sm btn-ghost" type="button" onclick={() => (selected = null)}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div class="map-contents">
          {#if selectedBin.items.length === 0}
            <p class="small muted">Empty — put stock in from the loose list below.</p>
          {:else}
            <p class="map-contents-head">
              <span>{plural(selectedBin.items.length, 'item')} in this bin</span>
              <span class="muted">{formatNumber(selectedBin.unit_count)} total</span>
            </p>
            <ul class="map-contents-list">
              {#each selectedBin.items as item (item.id)}
                <li>
                  <a class="link" href={h(`/items/${item.id}`)}>{item.name}</a>
                  <span class="small muted nowrap">{formatNumber(item.quantity)} {item.unit}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <div class="card-body">
        <p class="map-edge">Back</p>
        <div
          class="map-grid"
          bind:this={gridEl}
          style={`--cols: ${cols}; --rows: ${rows};`}
          role="group"
          aria-label={`${cols} by ${rows} drawer map`}
          onpointerdown={(event) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.map-bin')) selected = null;
          }}
        >
          {#each cells as index (index)}
            <div class="map-cell" aria-hidden="true"></div>
          {/each}

          {#each bins as bin (bin.location_id)}
            <button
              type="button"
              class="map-bin"
              class:dragging={dragging?.id === bin.location_id}
              class:invalid={dragging?.id === bin.location_id && dragTarget !== null &&
                !fitsInGrid(dragTarget.x, dragTarget.y, bin.base_w, bin.base_h, bin.rotation, cols, rows)}
              class:selected={selected === bin.location_id}
              style={binStyle(bin)}
              onpointerdown={(event) => beginDrag(event, bin)}
              onpointermove={moveDrag}
              onpointerup={(event) => endDrag(event, bin)}
              onpointercancel={() => { dragging = null; dragTarget = null; }}
              onfocus={() => (selected = bin.location_id)}
              onclick={() => (selected = bin.location_id)}
              onkeydown={(event) => onBinKeydown(event, bin)}
              title={`${bin.name} — ${bin.w}×${bin.h} at cell ${bin.x},${bin.y}`}
            >
              <span class="map-bin-name">{bin.name}</span>
              <span class="map-bin-meta">
                {#if bin.code}<span class="mono">{bin.code}</span>{/if}
                {#if bin.item_count > 0}
                  <span>{plural(bin.item_count, 'item')}</span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
        <p class="map-edge">Front</p>
      </div>
      <div class="card-foot map-legend">
        <span class="small muted">
          Drag a bin, or focus it and use the arrow keys. <kbd>R</kbd> turns it between portrait and
          landscape; select a bin to move loose items into it.
        </span>
      </div>
    </div>

    <div class="map-side">
      {#if showUnsorted}
        <div class="card">
          <div class="card-head">
            <h2>Unsorted</h2>
            <span class="badge">
              {data.staging ? plural(data.staging.items.length, 'item') : 'not set'}
            </span>
          </div>
          <div class="card-body">
            {#if !data.staging}
              <p class="small muted">
                No location is marked as unsorted yet. Open a location — <em>Sorting Tray</em> is the
                obvious one — and use <strong>Mark as unsorted</strong> on its page.
              </p>
            {:else}
              <p class="small muted" style="margin-bottom: 10px;">
                {#if selectedBin}
                  Filing into <strong>{selectedBin.name}</strong>.
                {:else}
                  Filing into this drawer, loose. Select a bin to file straight into it instead.
                {/if}
              </p>
              {#if data.staging.items.length === 0}
                <p class="small muted">Nothing is waiting to be filed.</p>
              {:else}
                <ul class="map-list">
                  {#each data.staging.items as item (item.id)}
                    <li>
                      <span class="map-loose-name">
                        <a class="link" href={h(`/items/${item.id}`)}>{item.name}</a>
                        <span class="small muted">
                          {#if item.loose_quantity !== item.quantity}
                            {formatNumber(item.loose_quantity)} of {formatNumber(item.quantity)}
                            {item.unit} here
                          {:else}
                            {formatNumber(item.quantity)} {item.unit}
                          {/if}
                        </span>
                      </span>
                      <form
                        class="map-loose-form"
                        method="POST"
                        action="?/fileItem"
                        onsubmit={(event) => fileItem(event, item)}
                      >
                        <input type="hidden" name="item_id" value={item.id} />
                        <input type="hidden" name="bin_id" value={selectedBin?.location_id ?? ''} />
                        <input
                          class="input map-qty"
                          type="number"
                          name="quantity"
                          min="1"
                          max={item.loose_quantity}
                          step="any"
                          value={item.loose_quantity}
                          aria-label={`How many of ${item.name} to file`}
                        />
                        <button
                          class="icon-btn"
                          type="submit"
                          disabled={busy}
                          title={selectedBin
                            ? `File into ${selectedBin.name}`
                            : 'File into this drawer'}
                          aria-label={selectedBin
                            ? `File ${item.name} into ${selectedBin.name}`
                            : `File ${item.name} into this drawer`}
                        >
                          <Icon name="arrowRight" size={15} />
                        </button>
                      </form>
                    </li>
                  {/each}
                </ul>
                <form method="POST" action="?/fileAll" onsubmit={confirmFileAll} style="margin-top: 12px;">
                  <button class="btn btn-sm" type="submit">
                    <Icon name="box" size={14} /> File all into this drawer
                  </button>
                </form>
              {/if}
            {/if}
          </div>
        </div>
      {/if}

      <div class="card">
        <div class="card-head"><h2>Add a bin</h2></div>
        <div class="card-body">
          <form method="POST" action="?/addBin" class="form-grid">
            <div class="field">
              <label class="label" for="bin-name">Name</label>
              <input class="input" id="bin-name" name="name" type="text" required maxlength="120" placeholder="47 µF family" />
            </div>
            <div class="field">
              <label class="label" for="bin-code">Short code</label>
              <input class="input" id="bin-code" name="code" type="text" maxlength="60" placeholder="optional" />
            </div>
            <div class="field">
              <label class="label" for="bin-w">Cells wide</label>
              <input class="input" id="bin-w" name="w" type="number" min="1" max={cols} value="1" required />
            </div>
            <div class="field">
              <label class="label" for="bin-h">Cells deep</label>
              <input class="input" id="bin-h" name="h" type="number" min="1" max={rows} value="1" required />
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit"><Icon name="plus" size={15} /> Add and place</button>
            </div>
          </form>
          <p class="small muted" style="margin-top: 10px;">
            The bin is dropped into the first free space of its size. Anything that does not fit
            waits in the unplaced list below.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Unplaced bins</h2>
          <span class="badge">{plural(layout.unplaced_bins.length, 'bin')}</span>
        </div>
        <div class="card-body">
          {#if layout.unplaced_bins.length === 0}
            <p class="small muted">Every bin has a cell.</p>
          {:else}
            <ul class="map-list">
              {#each layout.unplaced_bins as bin (bin.id)}
                <li>
                  <a class="link" href={h(`/locations/${bin.id}`)}>{bin.name}</a>
                  <span class="row" style="gap: 6px;">
                    {#if bin.code}<span class="mono small muted">{bin.code}</span>{/if}
                    <span class="small muted">
                      {bin.grid_w ?? 1}×{bin.grid_h ?? 1}
                    </span>
                    <form method="POST" action="?/placeBin">
                      <input type="hidden" name="location_id" value={bin.id} />
                      <button class="btn btn-sm" type="submit">Place</button>
                    </form>
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>

      {#if layout.loose_items.length > 0}
        <div class="card">
          <div class="card-head">
            <h2>Loose items</h2>
            <span class="badge">{plural(layout.loose_items.length, 'item')}</span>
          </div>
          <div class="card-body">
            <p class="small muted" style="margin-bottom: 10px;">
              {#if selectedBin}
                These sit directly in the drawer rather than in a bin. The box is how many go into
                <strong>{selectedBin.name}</strong>; leave it at the full amount to put them all away.
              {:else}
                These sit directly in the drawer rather than in a bin. Select a bin on the map, then
                move items into it from here.
              {/if}
            </p>
            <ul class="map-list">
              {#each layout.loose_items as item (item.id)}
                <li>
                  <span class="map-loose-name">
                    <a class="link" href={h(`/items/${item.id}`)}>{item.name}</a>
                    <span class="small muted">
                      {#if item.loose_quantity !== item.quantity}
                        {formatNumber(item.loose_quantity)} of {formatNumber(item.quantity)} {item.unit}
                        here
                      {:else}
                        {formatNumber(item.quantity)} {item.unit}
                      {/if}
                    </span>
                  </span>
                  {#if selectedBin}
                    <form
                      class="map-loose-form"
                      method="POST"
                      action="?/assignItem"
                      onsubmit={(event) => assignItem(event, item, selectedBin)}
                    >
                      <input type="hidden" name="item_id" value={item.id} />
                      <input type="hidden" name="bin_id" value={selectedBin.location_id} />
                      <input
                        class="input map-qty"
                        type="number"
                        name="quantity"
                        min="1"
                        max={item.loose_quantity}
                        step="any"
                        value={item.loose_quantity}
                        aria-label={`How many of ${item.name} to put into ${selectedBin.name}`}
                      />
                      <button
                        class="icon-btn"
                        type="submit"
                        disabled={busy}
                        title={`Move into ${selectedBin.name}`}
                        aria-label={`Move ${item.name} into ${selectedBin.name}`}
                      >
                        <Icon name="arrowRight" size={15} />
                      </button>
                    </form>
                  {:else}
                    <span class="small faint">no bin selected</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        </div>
      {/if}

      {#if location.child_count > 0 && data.rearrangeTargets.length > 0}
        <div class="card">
          <div class="card-head"><h2>Rearrange</h2></div>
          <div class="card-body">
            <p class="small muted" style="margin-bottom: 12px;">
              Move every bin here somewhere else — another drawer, or the unsorted area while you
              shuffle. Bins keep their size, rotation and contents; they lose their position because
              cells belong to a particular grid.
            </p>
            <form
              class="form-grid"
              method="POST"
              action="?/moveAllBins"
              onsubmit={confirmMoveAllBins}
            >
              <div class="field">
                <label class="label" for="move-target">
                  Move {plural(location.child_count, 'bin')} to
                </label>
                <select class="select" id="move-target" name="target_location_id" required>
                  {#each data.rearrangeTargets as target (target.id)}
                    <option value={target.id}>{target.label}</option>
                  {/each}
                </select>
              </div>
              <div class="form-actions">
                <button class="btn" type="submit"><Icon name="arrowRight" size={15} /> Move bins</button>
              </div>
            </form>
          </div>
        </div>
      {/if}

      <div class="card">
        <div class="card-head"><h2>Grid size</h2></div>
        <div class="card-body">
          <form method="POST" action="?/setGrid" class="form-grid">
            <div class="field">
              <label class="label" for="grid-cols">Cells across</label>
              <input class="input" id="grid-cols" name="cols" type="number" min="1" max="64" value={cols} required />
            </div>
            <div class="field">
              <label class="label" for="grid-rows">Cells deep</label>
              <input class="input" id="grid-rows" name="rows" type="number" min="1" max="64" value={rows} required />
            </div>
            <div class="form-actions">
              <button class="btn" type="submit">Resize grid</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .map-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }

  @media (max-width: 1080px) {
    .map-layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .map-layout > .card {
    width: fit-content;
    max-width: 100%;
  }

  .map-side {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .map-edge {
    margin: 0 0 8px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--faint);
  }

  .map-grid {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
    /* Square cells: the map keeps the drawer's real proportions, but its height
       is capped so a deep drawer still fits on screen. */
    width: min(100%, calc(min(58vh, 700px) * var(--cols) / var(--rows)));
    aspect-ratio: var(--cols) / var(--rows);
    gap: 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }

  .map-cell {
    border-right: 1px dashed var(--border);
    border-bottom: 1px dashed var(--border);
  }

  .map-bin {
    position: absolute;
    margin: 3px;
    padding: 6px 7px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 2px;
    text-align: left;
    font: inherit;
    font-size: 11.5px;
    line-height: 1.25;
    color: var(--accent-text);
    background: var(--accent-soft);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: var(--radius-sm);
    overflow: hidden;
    cursor: grab;
    touch-action: none;
  }

  .map-bin:hover {
    border-color: var(--accent);
  }

  .map-bin:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .map-bin.dragging {
    cursor: grabbing;
    opacity: 0.85;
    box-shadow: var(--shadow);
    z-index: 3;
  }

  .map-bin.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft), 0 0 0 3px var(--accent);
  }

  .map-bin.invalid {
    background: var(--danger-soft);
    border-color: var(--danger);
    color: var(--danger);
  }

  .map-bin-name {
    font-weight: 650;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  .map-bin-meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 10px;
    color: var(--muted);
  }

  .map-head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .map-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }

  .map-toolbar-name {
    font-weight: 650;
    font-size: 13px;
  }

  .map-contents {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }

  .map-contents-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .map-contents-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 168px;
    overflow-y: auto;
    font-size: 12.5px;
  }

  .map-contents-list li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: baseline;
  }

  .map-loose-form {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }

  .map-qty {
    width: 68px;
    padding: 4px 6px;
    font-size: 12px;
    text-align: right;
  }

  .map-loose-name {
    display: flex;
    gap: 6px;
    align-items: baseline;
    min-width: 0;
  }

  .map-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .map-list li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    justify-content: space-between;
  }

  .map-legend kbd {
    font-family: var(--mono);
    font-size: 10.5px;
    padding: 1px 5px;
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--surface-2);
  }
</style>
