<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';

  /**
   * A number field with its own −/+ buttons.
   *
   * Quantity fields need to allow fractions (2.5 m of wire) but step in whole
   * numbers, and `step="any"` leaves the browser's native spinner doing whatever
   * it likes — some browsers step by the smallest decimal, others do nothing.
   * The buttons here always move by `step`, and the field still accepts a typed
   * decimal because the input stays free-form.
   */
  let {
    id,
    name,
    value = '',
    min,
    max,
    step = 1,
    placeholder = '',
    required = false,
    label = 'value',
    compact = false
  }: {
    id?: string;
    name: string;
    value?: string | number;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    required?: boolean;
    /** Used in the buttons' accessible names, e.g. "quantity". */
    label?: string;
    compact?: boolean;
  } = $props();

  // The field owns its value from here on; the prop only seeds it. Binding a
  // number input reports a number once the user types, so this holds either.
  let current = $state<string | number>(
    untrack(() => (value === undefined || value === null ? '' : value))
  );

  function nudge(direction: 1 | -1) {
    const raw = String(current ?? '').trim();
    const parsed = Number(raw);
    const base = raw === '' || !Number.isFinite(parsed) ? (min ?? 0) : parsed;
    let next = base + direction * step;
    if (max !== undefined && next > max) next = max;
    if (min !== undefined && next < min) next = min;
    // Avoid 0.30000000000000004 in the field after a fractional step.
    next = Math.round(next * 1e6) / 1e6;
    current = String(next);
  }
</script>

<div class="number-stepper" class:compact>
  <button
    type="button"
    class="number-stepper-btn"
    onclick={() => nudge(-1)}
    aria-label={`Decrease ${label} by ${step}`}
    title={`Decrease by ${step}`}
  >
    <Icon name="minus" size={14} />
  </button>
  <input
    {id}
    class="input number-stepper-input"
    type="number"
    {name}
    bind:value={current}
    {min}
    {max}
    step="any"
    {placeholder}
    {required}
    aria-label={label}
  />
  <button
    type="button"
    class="number-stepper-btn"
    onclick={() => nudge(1)}
    aria-label={`Increase ${label} by ${step}`}
    title={`Increase by ${step}`}
  >
    <Icon name="plus" size={14} />
  </button>
</div>
