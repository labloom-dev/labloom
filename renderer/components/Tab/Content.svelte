{#key source.kind === "page" ? source.id : tab.id}
    <ViewComponent tabId={tab.id} params={tab.view.params} {source} onparams={params => setViewParams(tab.id, params)} />
{/key}

<script lang="ts">
    import { setViewParams } from "./api";
    import type { Tab } from "./defs";
    import { definitionFor } from "./views";

    let { tab }: { tab: Tab } = $props();
    const definition = $derived(definitionFor(tab.view.type));
    const ViewComponent = $derived(definition.component);
    const source = $derived(definition.history(tab.view.params));
</script>