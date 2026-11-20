<script lang="ts">
    import { type Snippet } from "svelte";
    import Button from "../base/Button.svelte";
    let { groupKey, title, expanded, busy = false, ontoggle, children }: {
        groupKey: string; title: string; expanded: boolean; busy?: boolean; ontoggle: () => void; children: Snippet;
    } = $props();
</script>

<section aria-busy={busy}>
    <Button class="group-name" variant="text" icon={expanded ? "chevron-down" : "chevron-right"} data-panel-node="group" data-panel-key={groupKey}
        aria-expanded={expanded} tabindex={-1} onclick={ontoggle}>{title}</Button>
    {#if expanded}<div class="panel-rows">{@render children()}</div>{/if}
</section>

<style>
    section :global(.group-name) { display: flex; justify-content: flex-start; width: 100%; height: var(--ui-row-height); padding-inline: var(--ui-space-2); border: 0; border-radius: 0; border-top: var(--ui-stroke) solid var(--ui-divider); font-size: var(--ui-font-small); font-weight: 700; }
    section :global(.group-name:focus-visible) { outline-offset: calc(-1 * var(--ui-focus-width)); }
    .panel-rows :global(.ui-row) { border-radius: 0; }
    .panel-rows :global(.ui-row-main) { padding-inline-start: var(--ui-space-6); }
    :global(.groups:focus-within) .panel-rows :global(.ui-row[data-selected]) { background: var(--ui-selected); color: var(--ui-text-selected); }
</style>