<Popover.Root>
    <Popover.Trigger>
        {#snippet child({ props })}
            <button {...props} class="trigger">
                <span class="search-icon">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html search}
                </span>
                <span>搜索…</span>
            </button>
        {/snippet}
    </Popover.Trigger>
    <Popover.Portal>
        <Popover.Content
            side="bottom"
            align="center"
            sideOffset={16}
            collisionPadding={12}
        >
            {#snippet child({ wrapperProps, props })}
                <div {...wrapperProps}>
                    <div {...props} class="popover-content">
                        <GSPopover />
                    </div>
                </div>
            {/snippet}
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>


<style>
    .trigger {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: 70%;
        border: var(--border-width) solid var(--c-search-trigger-border);
        border-radius: 6px;
        background-color: var(--c-search-trigger-background);
        color: var(--c-search-trigger-text);
        font: inherit;
        font-size: 13px;
    }
    .trigger:hover, .trigger[data-state="open"] {
        border-color: var(--c-search-trigger-border-hover);
        background-color: var(--c-surface);
    }
    .trigger:focus-visible {
        outline: var(--focus-width) solid var(--c-accent);
        outline-offset: var(--focus-offset);
    }
    .search-icon {
        display: flex;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
    }
    .search-icon :global(svg) {
        width: 100%;
        height: 100%;
    }
    .popover-content {
        display: flex;
        flex-direction: column;
        width: min(576px, calc(100vw - 2 * 12px));
        max-height: min(512px, var(--bits-popover-content-available-height));
        overflow: hidden;
        border: var(--border-width) solid var(--c-popover-border);
        border-radius: 12px;
        background-color: var(--c-surface);
        color: var(--c-popover-text);
        box-shadow:
            0 12px 32px -12px var(--c-popover-shadow),
            0 2px 8px var(--c-popover-shadow-soft);
        z-index: 50;
    }
</style>


<script lang="ts">
    import { Popover } from "bits-ui";
    import GSPopover from "./GSPopover.svelte";
    import search from "../../assets/carbon--search.svg?raw";
</script>