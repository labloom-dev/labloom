<AttributeManager {definitions} {readDefinitions} listWidth={params.listWidth} onresize={listWidth => onparams({ listWidth })} />

<script lang="ts">
    import { onMount } from "svelte";
    import type { AttributeDefinition } from "../../../shared/types/attributes";
    import type { ViewProps } from "../Tab/views";
    import AttributeManager from "./AttributeManager.svelte";
    import { registerList } from "./page-visits";

    let { tabId, params, onparams }: ViewProps<"attributes"> = $props();
    let definitions = $state<AttributeDefinition[]>([]);
    let requested = 0, applied = 0;

    async function readDefinitions(): Promise<AttributeDefinition[]> {
        const request = ++requested;
        const next = await window.api.attributes.definitions();
        if (request > applied) {
            applied = request;
            definitions = next;
        }
        return definitions;
    }

    onMount(() => registerList(tabId, change => change.definition ? [change.definition] : [], async () => {
        await readDefinitions();
    }));
</script>