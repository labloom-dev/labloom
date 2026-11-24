<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import type { PageBlockList, PageSummary, Target } from "../../../shared/types/content";
    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import Popover from "../base/Popover.svelte";
    import GSPopover from "../globalSearch/GSPopover.svelte";
    import SearchList from "../globalSearch/SearchList.svelte";
    import { search, recent, blockList } from "../globalSearch/page-search";
    import { blockIcons } from "./labels";

    type Location = { x: number; y: number; left: number; right: number; bottom: number };
    const pageSearch = { search, recent, blockList };
    type Source = typeof pageSearch;
    let { mode = "reference", position, source = pageSearch, onselect, onclose }: {
        mode?: "reference" | "sync" | "page"; position?: Location; source?: Source;
        onselect: (target: Target, label: string) => void; onclose: () => void;
    } = $props();
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let page = $state.raw<PageBlockList | null>(null), pageQuery = $state(""), filter = $state(""), selected = $state(0);
    let input = $state<HTMLInputElement>(), loading = $state(false), error = $state<ErrorValue>("");
    let generation = 0;
    let browsing: string | undefined;
    const anchor = {
        getBoundingClientRect(): DOMRect {
            if (position) {
                const width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-editor-preview-width"));
                const x = Math.max(position.left, Math.min(position.x, position.right - Math.min(width, position.right - position.left)));
                return new DOMRect(x, Math.min(position.y, position.bottom), 0, 0);
            }
            const search = document.querySelector<HTMLElement>(".search-trigger")?.getBoundingClientRect();
            return new DOMRect(search ? search.left + search.width / 2 : window.innerWidth / 2, search?.top ?? 0, 0, 0);
        }
    };
    const ordered = $derived.by(() => {
        const empty = t("editor.emptyBlock"), missing = t("editor.missingReference");
        return (page?.rows ?? []).map((block, index) => {
            const title = block.text || (block.type === "blocked_reference" ? missing : empty);
            return { id: String(index), blockId: block.id, title, searchText: title.toLocaleLowerCase(), icon: blockIcons[block.type], depth: block.depth };
        });
    });
    const needle = $derived(filter.trim().toLocaleLowerCase());
    const rows = $derived(needle ? ordered.filter(row => row.searchText.includes(needle)) : ordered);
    const opened = $derived(!!page);
    $effect(() => {
        void opened; const field = input; if (field) field.focus({ preventScroll: true });
    });
    onDestroy(() => {
        generation++;
    });
    onMount(() => window.api?.pages.onChanged(change => {
        if (browsing && (change.recycledPages?.includes(browsing) || change.purged?.includes(browsing))) back();
    }));
    async function browse(item: Pick<PageSummary, "id">): Promise<void> {
        const request = ++generation;
        browsing = item.id;
        loading = true; error = "";
        try {
            const result = await source.blockList(item.id);
            if (request !== generation) return;
            filter = ""; selected = 0; page = result;
        }
        catch (problem) {
            if (generation === request) error = failure(problem);
        }
        finally {
            if (generation === request) loading = false;
        }
    }
    function back(): void {
        generation++; browsing = undefined; page = null; filter = ""; selected = 0; loading = false; error = "";
    }
    function finish(target?: Target, title = ""): void {
        generation++;
        if (target) onselect(target, title);
        else onclose();
    }
    let open = $state(true);
    function toggle(value: boolean): void {
        open = value; if (!value) finish();
    }
    const content = $derived({
        class: position ? "target-picker inline-picker" : "target-picker title-picker", customAnchor: anchor,
        style: position ? `max-width: min(calc(100vw - 2 * var(--ui-space-3)), ${position.right - position.left}px)` : undefined,
        sideOffset: position ? 4 : 0, collisionPadding: { left: 8, right: 8, bottom: 8 }, trapFocus: true,
        onOpenAutoFocus: (event: Event) => {
            event.preventDefault(); void tick().then(() => input?.focus({ preventScroll: true }));
        },
        onCloseAutoFocus: (event: Event) => {
            event.preventDefault();
            if (origin?.isConnected) origin.focus({ preventScroll: true });
        }
    });
</script>

<Popover label={t("editor.choosePage")} bind:open={() => open, toggle} align={position ? "start" : "center"} contentProps={content}>
    {#if page}
        <SearchList bind:query={filter} bind:input bind:selected options={rows} label={t("editor.blocks", { title: page.title || t("shell.untitled") })}
            empty={t("editor.noBlocks")} onback={back} onchoose={index => {
                const row = rows[index]; if (row) finish({ kind: "block", id: row.blockId }, row.title);
            }} />
    {:else}
        <GSPopover bind:input bind:query={pageQuery} search={source.search} recent={source.recent} formatTime={() => ""} label={t("editor.pages")}
            onbrowse={mode === "page" ? undefined : browse} onpage={item => mode === "sync" ? browse(item) : finish({ kind: "page", id: item.id }, item.title || t("shell.untitled"))} />
    {/if}
    {#if loading}<div class="progress" role="progressbar" aria-label={t("editor.loadingReference")}></div>{/if}
    {#if error}<div data-paragraph role="alert">{message(error)}</div>{/if}
</Popover>

<style>
    :global(.ui-popover.target-picker) { -webkit-app-region: no-drag; padding: 0; overflow: hidden; }
    :global(.title-picker) { width: min(var(--ui-search-width), calc(100vw - 2 * var(--ui-space-3))); }
    :global(.inline-picker) { width: var(--ui-editor-preview-width); }
    .progress { height: var(--ui-active-border); background: var(--ui-accent); }
    :where([data-paragraph]) { margin: var(--ui-space-2) var(--ui-space-3); font-size: var(--ui-font-small); color: var(--ui-danger); }
</style>