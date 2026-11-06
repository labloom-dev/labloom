<div class="group-header" class:focused={tabState.focusedGroupId === group.id} bind:this={header}>
    <button class="group-tool" aria-label="后退" title="后退" disabled={navigationHistory.index <= 0} onclick={() => navigateHistory(-1)}>←</button>
    <button class="group-tool" aria-label="前进" title="前进" disabled={navigationHistory.index >= navigationHistory.entries.length - 1} onclick={() => navigateHistory(1)}>→</button>
    <Tabs.List class="tab-list">
        {#each group.tabs as tab (tab.id)}
            <div class="tab" class:active={group.activeTabId === tab.id} draggable="true" role="presentation" ondragstart={event => { event.dataTransfer?.setData("application/x-labloom-tab", tab.id); }} ondragover={event => { if (event.dataTransfer?.types.includes("application/x-labloom-tab")) event.preventDefault(); }} ondrop={event => { event.preventDefault(); const id = event.dataTransfer?.getData("application/x-labloom-tab"); if (id) moveTab(id as TabID, group.id, group.tabs.indexOf(tab)); }}>
                <Tabs.Trigger value={tab.id}>{tab.title}</Tabs.Trigger>
                <button class="close-tab" aria-label={`关闭${tab.title}`} title={`关闭${tab.title}`} onclick={event => closeTab(event, tab.id)}>
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html close_svg}
                </button>
            </div>
        {/each}
    </Tabs.List>

    <button class="group-tool" title="新建知识页面" aria-label="新建知识页面" bind:this={addButton} onclick={openDraft}>
        <Icon name="plus" size={15} />
    </button>
    <button class="group-tool" title="左右分栏" aria-label="左右分栏" onclick={() => splitGroup(group.id, "horizontal")}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html split_right}
    </button>
    <button class="group-tool" title="上下分栏" aria-label="上下分栏" onclick={() => splitGroup(group.id, "vertical")}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html split_down}
    </button>
    <button class="group-tool" title="合并分栏" aria-label="合并分栏" disabled={tabState.groups.length === 1} onclick={() => closeGroup(group.id)}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html close_svg}
    </button>
</div>


<style>
    .group-header {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        min-height: 45px;
        gap: 5px;
        padding: 7px 12px 0;
        background: var(--c-tab-header-background);
        border-bottom: 1px solid var(--c-tab-header-border);
    }
    .group-header.focused {
        border-bottom-color: #bcaa82;
    }
    .group-header > :global(.tab-list) {
        display: flex;
        align-items: stretch;
        align-self: stretch;
        overflow-x: auto;
        min-width: 0;
        flex: 1;
        gap: 5px;
        scrollbar-width: none;
    }
    .tab {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        gap: 4px;
        padding: 0 7px 0 13px;
        border: 1px solid transparent;
        border-bottom: 0;
        border-radius: 9px 9px 0 0;
        color: var(--c-muted);
    }
    .tab.active {
        border-color: #bcaa82;
        background: var(--c-paper);
        color: var(--c-ink);
    }
    .tab :global([data-tabs-trigger]) {
        max-width: 180px;
        height: 35px;
        padding-right: 8px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        font-weight: 700;
    }
    button {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        flex-shrink: 0;
        border-radius: 6px;
        color: var(--c-muted);
    }
    button:hover:not(:disabled) {
        background: var(--c-gold-light);
        color: var(--c-ink);
    }
    button :global(svg) {
        width: 15px;
        height: 15px;
    }
    .close-tab {
        width: 20px;
        height: 20px;
    }
    .close-tab :global(svg) {
        width: 12px;
        height: 12px;
    }
    .group-tool {
        margin-bottom: 6px;
    }
</style>


<script lang="ts">
    import Icon from "../utils/Icon.svelte";
    import { openDraft } from "../layout/navigation";
    import { navigateHistory, navigationHistory } from "../layout/history.svelte";
    import { moveTab } from "./api";
    import { savePage } from "../Knowledge/state.svelte";
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
        const tab = group.tabs.find(tab => tab.id === id);
        const button = event.currentTarget as HTMLButtonElement;
        const restoreFocus = button.parentElement?.contains(document.activeElement);
        if (tab?.type === "page" && !await savePage(tab.pageId)) return;
        if (!removeTab(id) || !restoreFocus) return;
        await tick();
        const activeTrigger = header?.querySelector<HTMLButtonElement>("[data-tabs-trigger][data-state='active']");
        (activeTrigger ?? addButton)?.focus();
    }
</script>