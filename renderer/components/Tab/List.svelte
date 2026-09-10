{#each tabs.items as tab (tab.id)}
    <button onclick={() => {
        tabs.activeId = tab.id;
    }}>
        {tab.title}
    </button>
{/each}


<script lang="ts">
    import { getTabs } from "./definitions";
    const tabs = getTabs();
</script>