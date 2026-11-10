<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    action,
    targetName,
    targetId,
    kind = 'photo',
    title = 'Upload'
  }: {
    action: string;
    targetName: 'item_id' | 'location_id';
    targetId: string;
    kind?: 'photo' | 'document' | 'auto';
    title?: string;
  } = $props();

  // svelte-ignore state_referenced_locally
  let selectedKind = $state(kind === 'auto' ? 'photo' : kind);
</script>

<form class="upload-zone" method="POST" {action} enctype="multipart/form-data">
  <input type="hidden" name={targetName} value={targetId} />
  <div class="row-between">
    <strong class="small">{title}</strong>
    {#if kind === 'auto'}
      <select class="select" name="kind" bind:value={selectedKind} style="width:auto;height:32px;font-size:12px;padding:0 28px 0 9px;">
        <option value="photo">Photo</option>
        <option value="document">Document</option>
      </select>
    {:else}
      <input type="hidden" name="kind" value={kind} />
    {/if}
  </div>
  <input type="file" name="file" required accept={selectedKind === 'photo' ? 'image/*' : undefined} />
  <input class="input" name="caption" placeholder="Caption (optional)" style="height:34px;font-size:12.5px;" />
  <button class="btn btn-sm" type="submit">
    <Icon name="upload" size={14} />
    Upload
  </button>
</form>
