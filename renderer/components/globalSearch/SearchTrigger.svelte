<script lang="ts">
    import { type HTMLButtonAttributes } from "svelte/elements";
    import { commandLabel } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    let props: HTMLButtonAttributes = $props();
</script>

<Button {...props} class="search-trigger" icon="search" aria-keyshortcuts="Control+p">{commandLabel("search")}</Button>

<style>
    :global(.ui-control.search-trigger) { width: 100%; border-radius: var(--ui-radius-panel); background: var(--ui-surface-input); color: var(--ui-text-secondary); }
    :global(.ui-control.search-trigger:hover) { border-color: var(--ui-text-secondary); color: var(--ui-text); }
</style>