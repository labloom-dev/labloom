<AttributeManager {definitions} {tabId} />
<script lang="ts">
    import { onMount } from "svelte";
    import type { AttributeDefinition } from "../../../shared/types/attributes";
    import AttributeManager from "./AttributeManager.svelte";
    import { registerList } from "./state.svelte";
    let { tabId }: { tabId: string } = $props();
    let definitions = $state<AttributeDefinition[]>([]);
    onMount(() => registerList(tabId, change => change.definition ? [change.definition] : [], async () => {
        definitions = await window.api.knowledge.definitions();
    }));
</script>