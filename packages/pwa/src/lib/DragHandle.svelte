<script lang="ts">
  // The grip of a row in a `sortable` list: drag it to move the row, or focus it and use the
  // arrow keys.
  let { label }: { label: string } = $props();
</script>

<button type="button" class="grip" data-sort-handle aria-label={label}>
  <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
    <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" />
    <circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" />
    <circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
  </svg>
</button>

<style>
  .grip {
    flex: 0 0 auto;
    width: 32px;
    height: 44px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-dim);
    cursor: grab;
    /* The handle owns the gesture: the page must not scroll, select or show a callout. */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .grip:active { cursor: grabbing; color: var(--text); }
  svg { fill: currentColor; }
</style>
