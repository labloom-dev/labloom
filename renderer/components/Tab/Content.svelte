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
    import { getTabs } from "./definitions";

    const tabs = getTabs();
    const active = $derived(
        tabs.items.find(tab => tab.id === tabs.activeId)
    );
</script>