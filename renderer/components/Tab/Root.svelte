{@render children()}


<script lang="ts">
    import { type Snippet, untrack } from "svelte";
    import { setTabs, type Tab, type TabState } from "./definitions";

    let { initialTabs, children }: { initialTabs: Tab[]; children: Snippet } = $props();
    const activeState = $state<TabState>({
        items: untrack(() => [...initialTabs]),
        activeId: untrack(() => [...initialTabs])[0].id
    });

    setTabs(activeState);
</script>