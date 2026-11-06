<div class="group-header" class:focused={tabState.focusedGroupId === group.id} bind:this={header}>
    <Tabs.List class="tab-list">
        {#each group.tabs as tab (tab.id)}
            <div class="tab" class:active={group.activeTabId === tab.id}>
                <Tabs.Trigger value={tab.id}>{tab.title}</Tabs.Trigger>
                <button onclick={event => closeTab(event, tab.id)}>
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html close_svg}
                </button>
            </div>
        {/each}
    </Tabs.List>

    <button onclick={() => splitGroup(group.id, "horizontal")}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html split_right}
    </button>
    <button onclick={() => splitGroup(group.id, "vertical")}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html split_down}
    </button>
    <button onclick={() => closeGroup(group.id)}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html close_svg}
    </button>
</div>


<style>
    .group-header {
        display: flex;
        flex-shrink: 0;
        background: var(--c-tab-header-background);
        border-bottom: var(--border-width) solid var(--c-tab-header-border);
    }
    .group-header.focused {
        border-bottom-color: var(--c-accent);
    }
    .group-header > :global(.tab-list) {
        display: flex;
        overflow-x: auto;
        min-width: 0;
        flex: 1;
    }
    .tab {
        display: flex;
        flex-shrink: 0;
        border-top: var(--focus-width) solid transparent;
    }
    .tab.active {
        border-top-color: var(--c-accent);
    }
    button {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        width: 16px;
    }
</style>


<script lang="ts">
    import { Tabs } from "bits-ui";
    import { tick } from "svelte";
    import type { TabGroup, TabID } from "./defs";
    import { closeGroup, removeTab, splitGroup } from "./api";
    import { tabState } from "./state.svelte";
    import split_right from "../../assets/custom--split-right.svg?raw";
    import split_down from "../../assets/custom--split-down.svg?raw";
    import close_svg from "../../assets/carbon--close.svg?raw";

    let { group }: { group: TabGroup } = $props();
    let header = $state<HTMLDivElement | null>(null);
    let addButton = $state<HTMLButtonElement | null>(null);

    async function closeTab(event: MouseEvent, id: TabID): Promise<void> {
        const button = event.currentTarget as HTMLButtonElement;
        const restoreFocus = button.parentElement?.contains(document.activeElement);
        if (!removeTab(id) || !restoreFocus) return;
        await tick();
        const activeTrigger = header?.querySelector<HTMLButtonElement>("[data-tabs-trigger][data-state='active']");
        (activeTrigger ?? addButton)?.focus();
    }
</script>