<svelte:window onkeydown={onkeydown} />

<Popover.Root bind:open>
    <Popover.Trigger>
        {#snippet child({ props })}
            <button {...props} class="trigger">
                <span class="search-icon">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html search}
                </span>
                <span class="search-label">搜索你的知识花园…</span>
                <kbd>{modifier} K</kbd>
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
                        <GSPopover onclose={() => open = false} />
                    </div>
                </div>
            {/snippet}
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>


<style>
    .trigger {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: 38px;
        padding: 0 13px;
        border: var(--border-width) solid var(--c-search-trigger-border);
        border-radius: 10px;
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
        border: 1.5px solid var(--c-ink);
        border-radius: 12px;
        background-color: var(--c-surface);
        color: var(--c-popover-text);
        box-shadow: 4px 5px 0 var(--c-ink);
        z-index: 50;
    }
    .search-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
        font-size: 11px;
    }
    kbd {
        white-space: nowrap;
        font-size: 9px;
    }
    @media (max-width: 600px) {
        kbd {
            display: none;
        }
    }
</style>


<script lang="ts">
    import { Popover } from "bits-ui";
    import GSPopover from "./GSPopover.svelte";
    import search from "../../assets/carbon--search.svg?raw";

    let open = $state(false);
    const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

    function onkeydown(event: KeyboardEvent): void {
        if ((event.ctrlKey || event.metaKey) && event.code === "KeyK") {
            event.preventDefault();
            open = !open;
        }
    }
</script>