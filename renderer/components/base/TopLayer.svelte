<script lang="ts">
    import { type Snippet } from "svelte";
    import { showLayer } from "./top-layer";

    let { props, children, onEscape }: { props?: Record<string, unknown>; children: Snippet; onEscape?: (event: KeyboardEvent) => void } = $props();
</script>

<div {...props} popover="manual" class="layer" {@attach element => showLayer(element, onEscape)}>{@render children()}</div>

<style>
    .layer { position: fixed; inset: auto; margin: 0; padding: 0; border: 0; color: inherit; background: transparent; overflow: visible; max-width: none; max-height: none; }
</style>