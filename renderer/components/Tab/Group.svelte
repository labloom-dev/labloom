{#if group}
    <section
        class="group"
        onpointerdown={() => focusGroup(groupId)}
        onfocusin={() => focusGroup(groupId)}
    >
        <Tabs.Root
            class="tabs-root"
            bind:value={getActiveTab, setActiveTab}
        >
            <GroupHeader {group} />
            <div class="group-content">
                {#each group.tabs as tab (tab.id)}
                    <Tabs.Content value={tab.id}>
                        {#if group.activeTabId === tab.id}
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
        min-width: 0;
        min-height: 0;
        overflow: hidden;
    }
    .group > :global(.tabs-root) {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        min-height: 0;
    }
    .group-content {
        flex: 1;
        min-height: 0;
        overflow: auto;
    }
    .group-content > :global([data-tabs-content]) {
        height: 100%;
    }
</style>


<script lang="ts">
    import { Tabs } from "bits-ui";
    import GroupHeader from "./GroupHeader.svelte";
    import Content from "./Content.svelte";
    import type { GroupID } from "./defs";
    import { activateTab, focusGroup } from "./api";
    import { tabState } from "./state.svelte";

    let { groupId }: { groupId: GroupID } = $props();
    const group = $derived(tabState.groups.find(group => group.id === groupId));

    function getActiveTab(): string {
        return group?.activeTabId ?? "";
    }

    function setActiveTab(value: string): void {
        const tab = group?.tabs.find(tab => tab.id === value);
        if (tab) activateTab(tab.id);
    }
</script>