{#key tab.id}
    {#if tab.type === "page"}
        <PageView pageId={tab.pageId} />
    {:else if tab.type === "overview"}
        <Overview />
    {:else if tab.type === "about"}
        <About />
    {:else if tab.type === "settings"}
        <Settings />
    {:else if tab.type === "reader-test"}
        <Library initialView="papers" />
    {:else if tab.type === "feed"}
        <FeedView />
    {:else if tab.type === "knowledge"}
        <Library />
    {:else if tab.type === "calendar"}
        <Calendar />
    {:else if tab.type === "assistant"}
        <Assistant />
    {/if}
{/key}


<script lang="ts">
    import Overview from "../tabs/Overview.svelte";
    import Settings from "../tabs/Settings.svelte";
    import About from "../tabs/About.svelte";
    import Assistant from "../Knowledge/Assistant.svelte";
    import PageView from "../Knowledge/PageView.svelte";
    import Library from "../Knowledge/Library.svelte";
    import Calendar from "../Knowledge/Calendar.svelte";
    import FeedView from "../Feed/FeedView.svelte";
    import type { Tab } from "./defs";

    let { tab }: { tab: Tab } = $props();
</script>