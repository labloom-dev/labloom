{#key tab.id}
    {#if tab.type === "page"}
        <Editor />
    {:else if tab.type === "overview"}
        <div>overview</div>
    {:else if tab.type === "about"}
        <About />
    {:else if tab.type === "settings"}
        <Settings />
    {:else if tab.type === "reader-test"}
        <ReaderTest />
    {:else if tab.type === "feed"}
        <FeedView />
    {:else}
        <div>Unknown tab type!</div>
    {/if}
{/key}


<script lang="ts">
    import About from "../tabs/About.svelte";
    import Settings from "../tabs/Settings.svelte";
    import Editor from "../Editor/Editor.svelte";
    import ReaderTest from "../tabs/ReaderTest.svelte";
    import FeedView from "../Feed/FeedView.svelte";
    import type { Tab } from "./defs";

    let { tab }: { tab: Tab } = $props();
</script>