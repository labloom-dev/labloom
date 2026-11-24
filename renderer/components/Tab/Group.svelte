{#if group}
    <section
        class="group"
        data-group-id={groupId}
        tabindex="-1"
        aria-label={t("shell.editorGroup")}
        ondragover={acceptTabDrop}
        ondrop={event => dropTab(event, groupId)}
        onpointerdowncapture={focusPane}
        onfocusin={() => focusGroup(groupId)}
    >
        <Tabs.Root
            class="group-root"
            bind:value={getActiveTab, setActiveTab}
        >
            <GroupHeader {group} />
            <div class="group-content">
                {#if !group.tabs.length}
                    <div class="empty-group"><img src={icon} alt="" />
                        {#each ["newPage", "search", "settings"] as const as id (id)}<div data-paragraph>{commandLabel(id)} <kbd class="ui-shortcut">{commands[id].shortcut}</kbd></div>{/each}
                    </div>
                {/if}
                {#each group.tabs as tab (tab.id)}
                    <Tabs.Content value={tab.id} aria-hidden={group.activeTabId !== tab.id} tabindex={group.activeTabId === tab.id ? 0 : -1}>
                        {#if group.activeTabId === tab.id || visitedTabs.has(tab.id)}
                            <Content {tab} />
                        {/if}
                    </Tabs.Content>
                {/each}
            </div>
        </Tabs.Root>
    </section>
{/if}


<style>
    .group {
        display: flex;
        flex: 1;
        overflow: hidden;
        min-width: 0;
        min-height: 0;

        &:focus-visible {
            outline: var(--ui-focus-width) solid var(--ui-focus);
            outline-offset: calc(-1 * var(--ui-focus-width));
        }

        & > :global(.group-root) {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-width: 0;
            min-height: 0;
        }
    }
    .group-content {
        position: relative;
        flex: 1;
        overflow: clip;
        min-height: 0;
        background: var(--ui-surface-window);

        & > :global([data-tabs-content]) {
            position: absolute;
            inset: 0;
            overflow: auto;
            contain: layout paint;
        }
        /* Keep the layout and scroll position of visited documents between tab clicks. */
        & > :global([data-tabs-content][hidden]) {
            display: block;
            transform: translateX(-100%);
        }
    }
    .empty-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        padding: var(--ui-space-6);
        text-align: center;
    }
    .empty-group img { width: var(--ui-empty-logo-size); filter: grayscale(1); opacity: .22; margin-bottom: var(--ui-space-5); }
    .empty-group :where([data-paragraph]) { margin: var(--ui-space-2) 0; color: var(--ui-text-secondary); font: var(--ui-font-body)/1.3 var(--ui-font-family); }
</style>


<script lang="ts">
    import { acceptTabDrop, dropTab } from "./interactions";
    import icon from "../../assets/icon.png";
    import { commandLabel, t } from "../../i18n.svelte";
    import { commands } from "../../../shared/content/commands";
    import { Tabs } from "bits-ui";
    import GroupHeader from "./GroupHeader.svelte";
    import { definitionFor } from "./views";
    import Content from "./Content.svelte";
    import type { GroupID } from "./defs";
    import { activateTab, focusGroup } from "./api";
    import { tabState, visitedTabs } from "./state.svelte";

    let { groupId }: { groupId: GroupID } = $props();
    const group = $derived(tabState.groups.find(group => group.id === groupId));
    $effect.pre(() => {
        const tab = group?.tabs.find(tab => tab.id === group.activeTabId);
        if (tab && definitionFor(tab.view.type).keepMounted) visitedTabs.add(tab.id);
    });

    function focusPane(event: PointerEvent): void {
        const control = document.activeElement;
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
            if (control.closest("[data-group-id]")?.getAttribute("data-group-id") !== groupId && control !== event.target) control.blur();
        }
        const trigger = event.target instanceof Element && event.target.closest<HTMLElement>("[data-tabs-trigger]");
        const tab = trigger && group?.tabs.find(item => item.id === trigger.dataset.value);
        if (tab) activateTab(tab.id); else focusGroup(groupId);
    }

    function getActiveTab(): string {
        return group?.activeTabId ?? "";
    }

    function setActiveTab(value: string): void {
        const tab = group?.tabs.find(tab => tab.id === value);
        if (tab) activateTab(tab.id);
    }
</script>