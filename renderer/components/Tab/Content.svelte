{#key tab.id}
    {#if tab.type === "page"}
        <Editor />
    {:else if tab.type === "overview"}
        <div>overview</div>
    {:else if tab.type === "about"}
        <div>about</div>
    {:else if tab.type === "settings"}
        <div>settings</div>
    {:else if tab.type === "reader-test"}
        <ReaderTest />
    {:else}
        <div>Unknown tab type!</div>
    {/if}
{/key}


<script lang="ts">
    import Editor from "../Editor/Editor.svelte";
    import ReaderTest from "../tabs/ReaderTest.svelte";
    import type { Tab } from "./defs";

    let { tab }: { tab: Tab } = $props();
</script>