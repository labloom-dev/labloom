{#if ready}<Screen />{/if}

<script lang="ts">
    import { onMount, type Component } from "svelte";
    import { visits } from "./activity.svelte";
    let { tabId, screen: Screen }: { tabId: string; screen: Component } = $props();
    let ready = $state(false);
    onMount(() => visits.register(tabId, {
        changed: () => [],
        read: async () => {
            ready = true;
        }
    }));
</script>