<script lang="ts">
    import type { Snippet } from "svelte";

    let { children, class: className }: { children: Snippet; class?: string } = $props();
</script>

<header class={["titlebar", className]}>{@render children()}</header>

<style>
    .titlebar {
        -webkit-app-region: drag;
        align-items: center;
        height: var(--ui-titlebar-height);
        flex: none;
        --system-controls: max(var(--ui-space-3), calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)));
        padding-inline-start: max(var(--ui-space-3), env(titlebar-area-x, 0px));
        background: var(--ui-titlebar-background);
        color: var(--ui-titlebar-foreground);
        border-bottom: var(--ui-stroke) solid var(--ui-divider);
    }
</style>