{#key tab.id}
    {#if tab.type === "page"}
        <PageView {tab} />
    {:else if tab.type === "library" || tab.type === "papers"}
        <Library tabId={tab.id} initialView={tab.type === "papers" ? "papers" : "all"} />
    {:else if tab.type === "calendar"}
        <Calendar tabId={tab.id} />
    {:else if tab.type === "overview"}
        <Overview tabId={tab.id} />
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
    import Overview from "../tabs/Overview.svelte";
    import Settings from "../tabs/Settings.svelte";
    import PageView from "../Knowledge/PageView.svelte";
    import Library from "../Knowledge/Library.svelte";
    import Calendar from "../Knowledge/Calendar.svelte";
    import ReaderTest from "../tabs/ReaderTest.svelte";
    import FeedView from "../Feed/FeedView.svelte";
    import type { Tab } from "./defs";

    let { tab }: { tab: Tab } = $props();
</script>