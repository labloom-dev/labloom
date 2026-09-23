<Layout node={tabState.layout} />


<script lang="ts">
    import { untrack } from "svelte";
    import { addTab } from "./api";
    import type { Tab } from "./defs";
    import Layout from "./Layout.svelte";
    import { tabState } from "./state.svelte";

    const { initialTabs = [] }: { initialTabs?: Tab[] } = $props();

    untrack(() => {
        const group = tabState.groups[0];
        if (tabState.groups.length !== 1 || group.tabs.length !== 0) return;
        for (const tab of initialTabs) addTab(group.id, tab, false);
    });
</script>