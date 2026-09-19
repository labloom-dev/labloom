<div class="tab-list">
    {#each group?.tabs ?? [] as tab (tab.id)}
        <div class="tab" class:active={group?.activeTabId === tab.id}>
            <button aria-pressed={group?.activeTabId === tab.id} onclick={() => activateTab(tab.id)}>{tab.title}</button>
            <button aria-label={`关闭 ${tab.title}`} onclick={() => removeTab(tab.id)}>×</button>
        </div>
    {/each}
</div>

<style>
    .tab-list { display: flex; overflow-x: auto; min-width: 0; flex: 1; }
    .tab { display: flex; flex-shrink: 0; border-top: 2px solid transparent; }
    .tab.active { border-top-color: #557cdb; }
</style>

<script lang="ts">
    import { activateTab, removeTab } from "./api";
    import type { GroupID } from "./defs";
    import { tabState } from "./state.svelte";

    let { groupId }: { groupId: GroupID } = $props();
    const group = $derived(tabState.groups.find(group => group.id === groupId));
</script>