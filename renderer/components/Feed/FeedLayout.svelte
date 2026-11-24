<script lang="ts">
    import type { Snippet } from "svelte";
    import type { FeedParams } from "../../../shared/workspace/feed";
    import { t } from "../../i18n.svelte";
    import Resizer from "../utils/Resizer.svelte";

    let { params, fixed, reading, onwidth, heading, toolbar, sources, list, reader }: {
        params: FeedParams; fixed: boolean; reading: boolean; onwidth: (patch: Pick<FeedParams, "sourcesWidth" | "listWidth">) => void;
        heading?: Snippet; toolbar: Snippet<[showScope: boolean, compact: boolean]>; sources: Snippet; list: Snippet; reader: Snippet<[single: boolean]>;
    } = $props();
    let width = $state(0);
    const minSources = 148, minList = 224, minReader = 320, sash = 4;
    const showSources = $derived(!fixed && (!width || width >= 860));
    const single = $derived(width > 0 && width < 600);
    const maxSources = $derived(Math.max(minSources, Math.min((width || 1000) * .35, width - minList - minReader - 2 * sash)));
    const sourceWidth = $derived(Math.min(maxSources, Math.max(minSources, params.sourcesWidth ?? 200)));
    const listSpace = $derived((width || 1000) - (showSources ? sourceWidth + sash : 0));
    const maxList = $derived(Math.max(minList, listSpace - minReader - sash));
    const listWidth = $derived(Math.min(maxList, Math.max(minList, params.listWidth ?? 320)));
</script>

<section class="feed-view" bind:clientWidth={width}>
    {@render heading?.()}
    {@render toolbar(!fixed && !showSources, width > 0 && width < 520)}
    <div class="feed-body">
        {#if showSources}
            <div class="sources" style:width={sourceWidth + "px"}>{@render sources()}</div>
            <Resizer direction="vertical" label={t("feed.sourceWidth")} origin={sourceWidth} min={minSources} max={maxSources}
                changeCB={value => onwidth({ sourcesWidth: Math.round(value) })} />
        {/if}
        <div class="list-pane" class:single hidden={single && reading} style:width={single ? undefined : listWidth + "px"}>{@render list()}</div>
        {#if !single}
            <Resizer direction="vertical" label={t("feed.listWidth")} origin={listWidth} min={minList} max={maxList}
                changeCB={value => onwidth({ listWidth: Math.round(value) })} />
        {/if}
        <div class="reader-pane" hidden={single && !reading}>{@render reader(single)}</div>
    </div>
</section>

<style>
    .feed-view, .feed-body, .list-pane, .reader-pane { min-width: 0; min-height: 0; display: flex; }
    .feed-view { height: 100%; flex: 1; flex-direction: column; background: var(--ui-surface-window); color: var(--ui-text); font: var(--ui-font-body)/var(--ui-row-height) var(--ui-font-family); }
    .feed-body, .list-pane.single, .reader-pane { flex: 1; }
    .sources { flex: none; min-height: 0; display: flex; background: var(--ui-surface-panel); }
    .list-pane, .reader-pane { flex-direction: column; }
    [hidden] { display: none; }
</style>