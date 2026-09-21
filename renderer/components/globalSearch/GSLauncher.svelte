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
        border: var(--border-width) solid var(--color-search-trigger-border);
        border-radius: var(--radius-medium);
        background-color: var(--color-search-trigger-background);
        color: var(--color-search-trigger-text);
        font: inherit;
        font-size: 13px;
    }
    .trigger:hover, .trigger[data-state="open"] {
        border-color: var(--color-search-trigger-border-hover);
        background-color: var(--color-surface);
    }
    .trigger:focus-visible {
        outline: var(--focus-width) solid var(--color-accent);
        outline-offset: var(--focus-offset);
    }
    .search-icon {
        display: flex;
        width: var(--icon-size-small);
        height: var(--icon-size-small);
        flex-shrink: 0;
    }
    .search-icon :global(svg) {
        width: 100%;
        height: 100%;
    }
    .popover-content {
        display: flex;
        flex-direction: column;
        width: min(var(--search-popover-width), calc(100vw - 2 * var(--search-popover-viewport-gap)));
        max-height: min(var(--search-popover-max-height), var(--bits-popover-content-available-height));
        overflow: hidden;
        border: var(--border-width) solid var(--color-popover-border);
        border-radius: var(--radius-large);
        background-color: var(--color-surface);
        color: var(--color-popover-text);
        box-shadow: var(--shadow-popover);
        z-index: 50;
    }
</style>


<script lang="ts">
    import { Popover } from "bits-ui";
    import GSPopover from "./GSPopover.svelte";
    import search from "../../assets/carbon--search.svg?raw";
</script>