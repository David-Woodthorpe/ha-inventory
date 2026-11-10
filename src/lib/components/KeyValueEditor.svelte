<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    initial = []
  }: {
    initial?: Array<{ key: string; value: string }>;
  } = $props();

  // svelte-ignore state_referenced_locally
  let rows = $state(
    initial.length ? initial.map((row) => ({ key: row.key, value: row.value })) : [{ key: '', value: '' }]
  );

  function addRow() {
    rows = [...rows, { key: '', value: '' }];
  }

  function removeRow(index: number) {
    rows = rows.filter((_, i) => i !== index);
    if (rows.length === 0) rows = [{ key: '', value: '' }];
  }
</script>

<div class="kv-editor">
  {#each rows as row, index}
    <div class="kv-row">
      <input class="input" name="custom_key" placeholder="e.g. tolerance" bind:value={row.key} />
      <input class="input" name="custom_value" placeholder="e.g. 5%" bind:value={row.value} />
      <button
        class="icon-btn danger"
        type="button"
        aria-label="Remove field"
        onclick={() => removeRow(index)}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  {/each}
  <div>
    <button class="btn btn-sm" type="button" onclick={addRow}>
      <Icon name="plus" size={14} />
      Add field
    </button>
  </div>
</div>
