<AttributeManager {definitions} />
<script lang="ts">
    import { onMount } from "svelte";
    import type { AttributeDefinition } from "../../../shared/types/attributes";
    import AttributeManager from "./AttributeManager.svelte";
    import { registerList } from "./page-visits";
    let { tabId }: { tabId: string } = $props();
    let definitions = $state<AttributeDefinition[]>([]);
    onMount(() => registerList(tabId, change => change.definition ? [change.definition] : [], async () => {
        definitions = await window.api.attributes.definitions();
    }));
</script>