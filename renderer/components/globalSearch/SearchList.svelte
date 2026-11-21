<script module lang="ts">
    import type { IconName } from "../utils/Icon.svelte";
    export type SearchRow = { id: string; title: string; detail?: string; snippet?: string; icon?: IconName; disabled?: boolean; depth?: number };
</script>

<script lang="ts">
    import { isComposingKey } from "../../../shared/content/commands";
    import { t } from "../../i18n.svelte";
    import Input from "../base/Input.svelte";
    import ListRow from "../base/ListRow.svelte";
    import Highlight from "./Highlight.svelte";
    let { options, label, query = $bindable(""), input = $bindable(), selected = $bindable(0), needle = query.trim(),
        pending = false, error = "", empty = "", onchoose, onbranch, onback, onmore }: {
        options: SearchRow[]; label: string; query?: string; input?: HTMLInputElement; selected?: number; needle?: string;
        pending?: boolean; error?: string; empty?: string; onchoose: (index: number, otherGroup: boolean, keyboard: boolean) => void;
        onbranch?: (index: number) => void; onback?: () => void; onmore?: () => void;
    } = $props();
    const uid = $props.id(), listId = uid + "-results";
    let list: HTMLDivElement;
    let scroll = $state(0), viewport = $state(0), rowHeight = $state(0), snippetHeight = $state(0);
    // A snippet adds one line. These offsets cover both search hits and single-line block rows.
    const offsets = $derived.by(() => {
        const result = [0];
        for (const row of options) result.push(result[result.length - 1] + rowHeight + (row.snippet ? snippetHeight : 0));
        return result;
    });
    function indexAt(y: number): number {
        let low = 0, high = options.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (offsets[middle + 1] <= y) low = middle + 1;
            else high = middle;
        }
        return Math.min(low, Math.max(0, options.length - 1));
    }
    function firstStartingAtOrAfter(y: number): number {
        const index = indexAt(y);
        return offsets[index] < y ? index + 1 : index;
    }
    const start = $derived(rowHeight ? indexAt(scroll) : 0);
    const end = $derived(Math.min(options.length, rowHeight && viewport ? firstStartingAtOrAfter(scroll + viewport) : 1));
    $effect.pre(() => {
        void query;
        scroll = 0;
        if (list) list.scrollTop = 0;
    });
    function move(index: number): void {
        if (!options.length) return;
        selected = Math.max(0, Math.min(options.length - 1, index));
        const top = offsets[selected], bottom = offsets[selected + 1];
        if (top < list.scrollTop) list.scrollTop = top;
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
        scroll = list.scrollTop;
        if (selected === options.length - 1) onmore?.();
    }
    function screen(direction: number): number {
        return Math.min(options.length - 1, firstStartingAtOrAfter(offsets[selected] + direction * list.clientHeight));
    }
    function keys(event: KeyboardEvent): void {
        if (isComposingKey(event)) return;
        switch (event.key) {
            case "ArrowDown": move(selected + 1); break;
            case "ArrowUp": move(selected - 1); break;
            case "PageDown": move(screen(1)); break;
            case "PageUp": move(screen(-1)); break;
            case "Enter": onchoose(selected, event.ctrlKey, true); break;
            case "ArrowRight": if (!onbranch) return; onbranch(selected); break;
            case "Backspace":
            case "ArrowLeft": if (query || !onback) return; onback(); break;
            default: return;
        }
        event.preventDefault(); event.stopPropagation();
    }
</script>

<div class="quick-open">
    <div class="search-input" class:pending>
        <Input bind:input bind:value={query} oninput={() => selected = 0} label={label} placeholder={label}
            inputProps={{ role: "combobox", autocomplete: "off", spellcheck: false, "aria-expanded": true, "aria-controls": listId,
                "aria-autocomplete": "list", "aria-activedescendant": selected >= start && selected < end ? uid + "-" + selected : undefined, onkeydown: keys }} />
    </div>
    <div class="search-results" id={listId} role="listbox" aria-label={t("quickOpen.results")} aria-busy={pending} bind:this={list} bind:clientHeight={viewport}
        onscroll={event => {
            const viewport = event.currentTarget;
            if (viewport !== list) return;
            scroll = viewport.scrollTop;
            if (scroll + viewport.clientHeight >= viewport.scrollHeight - 1) onmore?.();
        }}>
        <div class="row-metrics" aria-hidden="true" bind:offsetHeight={rowHeight} bind:offsetWidth={snippetHeight}></div>
        <div aria-hidden="true" style:height={offsets[start] + "px"}></div>
        {#each options.slice(start, end) as row, local (row.id)}
            {@const i = start + local}
            <div data-result style:height={(offsets[i + 1] - offsets[i]) + "px"} style:padding-inline-start={row.depth ? `calc(${row.depth} * var(--ui-space-5))` : undefined}>
                <ListRow title={row.title} icon={row.icon} selected={selected === i} focused={selected === i}
                    buttonProps={{ id: uid + "-" + i, role: "option", tabindex: -1, "aria-selected": selected === i, "aria-posinset": i + 1, "aria-setsize": options.length, "aria-disabled": !!row.disabled,
                        onpointermove: () => selected = i, onmousedown: event => event.preventDefault() }}
                    actions={onbranch ? [{ icon: "chevron-right", label: t("editor.browseBlocks"), onclick: () => onbranch?.(i) }] : []}
                    onclick={event => onchoose(i, event.ctrlKey, false)}>
                    <span class="result-copy"><span class="result-heading"><span class="result-title"><Highlight text={row.title} keyword={needle} /></span>
                        {#if row.detail}<span class="result-detail">{row.detail}</span>{/if}</span>
                        {#if row.snippet}<span class="result-snippet"><Highlight text={row.snippet} keyword={needle} /></span>{/if}
                    </span>
                </ListRow>
            </div>
        {/each}
        <div aria-hidden="true" style:height={(offsets[options.length] - offsets[end]) + "px"}></div>
    </div>
    {#if error}<p role="alert">{error}</p>
    {:else if !options.length && !pending && empty}<p>{empty}</p>{/if}
</div>

<style>
    .quick-open { --snippet-line-height: calc(var(--ui-font-small) + var(--ui-space-2)); display: flex; flex-direction: column; min-width: 0; max-height: inherit; padding: var(--ui-space-2); color: var(--ui-text); }
    .search-input { display: grid; flex: none; position: relative; margin: var(--ui-space-1) var(--ui-space-1) var(--ui-space-2); }
    .pending::after { content: ""; position: absolute; inset: auto 0 0; height: var(--ui-active-border); background: var(--ui-accent); transform-origin: left; animation: progress 1s ease-in-out infinite alternate; pointer-events: none; }
    @keyframes progress { from { transform: scaleX(.2); } to { transform: scaleX(1); } }
    .row-metrics { position: absolute; visibility: hidden; pointer-events: none; height: var(--ui-row-height); width: var(--snippet-line-height); }
    .search-results { position: relative; overflow: auto; overflow-anchor: none; min-height: 0; max-height: var(--ui-search-list-height); }
    [data-result] :global(.ui-row) { height: 100%; min-height: var(--ui-row-height); }
    [data-result] :global(.ui-row-main) { min-height: var(--ui-row-height); padding: var(--ui-space-1) var(--ui-space-3); gap: var(--ui-space-3); align-items: flex-start; }
    [data-result] :global(.ui-row-main > .icon) { margin-top: var(--ui-space-1); }
    [data-result] :global([aria-disabled="true"]) { color: var(--ui-text-disabled); cursor: default; }
    .result-copy { flex: 1; min-width: 0; }
    .result-heading { display: flex; min-width: 0; align-items: baseline; gap: var(--ui-space-4); }
    .result-title, .result-detail, .result-snippet { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .result-title { flex: 1; }
    .result-detail, .result-snippet, p { font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
    .result-detail { max-width: 50%; }
    .result-snippet { display: block; line-height: var(--snippet-line-height); }
    p { margin: var(--ui-space-2) var(--ui-space-3); }
</style>