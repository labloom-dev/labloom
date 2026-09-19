{#if active}
    {#key active.id}
        {#if active.type === "page"}
            <Editor />
        {:else if active.type === "overview"}
            <div>overview</div>
        {:else if active.type === "about"}
            <div>about</div>
        {:else if active.type === "settings"}
            <div>settings</div>
        {:else}
            <div>Unknown tab type!</div>
        {/if}
    {/key}
{/if}


<script lang="ts">
    import Editor from "../Editor/Editor.svelte";
    import type { GroupID } from "./defs";
    import { tabState } from "./state.svelte";

    let { groupId }: { groupId: GroupID } = $props();
    const group = $derived(tabState.groups.find(group => group.id === groupId));
    const active = $derived(
        group?.tabs.find(tab => tab.id === group.activeTabId)
    );
</script>