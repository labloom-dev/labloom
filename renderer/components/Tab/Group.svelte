{#if group}
    <section
        class="group"
        onpointerdown={() => focusGroup(groupId)}
        onfocusin={() => focusGroup(groupId)}
    >
        <Tabs.Root
            class="group-root"
            bind:value={getActiveTab, setActiveTab}
        >
            <GroupHeader {group} />
            <div class="group-content">
                {#if !group.tabs.length}
                    <div class="empty-group"><div class="empty-art"><Bloom /></div><h2>留一片空白，给下一个想法。</h2><p>打开一个页面，或开始新的阅读。</p><button class="button primary" onclick={() => addTab(groupId, { id: getTabID(), title: "我的花园", type: "overview" })}>打开我的花园</button></div>
                {/if}
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
        overflow: hidden;
        min-width: 0;
        min-height: 0;

        & > :global(.group-root) {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-width: 0;
            min-height: 0;
        }
    }
    .group-content {
        flex: 1;
        overflow: auto;
        min-height: 0;
        background-color: var(--c-cream);
        background-image: radial-gradient(var(--c-dots, #d9cfb9) .85px, transparent .85px);
        background-size: 18px 18px;

        & > :global([data-tabs-content]) {
            height: 100%;
        }
    }
    .empty-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        padding: 30px;
        text-align: center;
    }
    .empty-art {
        width: min(180px, 70%);
    }
    h2 {
        font-size: 19px;
    }
    p {
        margin: 0 0 24px;
        color: var(--c-muted);
        font-size: 12px;
    }
</style>


<script lang="ts">
    import Bloom from "../utils/Bloom.svelte";
    import { Tabs } from "bits-ui";
    import GroupHeader from "./GroupHeader.svelte";
    import Content from "./Content.svelte";
    import type { GroupID } from "./defs";
    import { activateTab, focusGroup, addTab, getTabID } from "./api";
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