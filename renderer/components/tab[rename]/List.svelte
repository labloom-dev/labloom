{#each tabs.items as tab (tab.id)}
    <button onclick={() => {
        tabs.activeId = tab.id;
        console.log("rewfgsrfdnfhgcjgtrefwdqsdesf");
    }}>
        348972882634723
    </button>
{/each}


<script lang="ts">
    import { getTabs } from "./tab";
    const tabs = getTabs();
</script>