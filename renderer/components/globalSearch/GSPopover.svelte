<script module lang="ts">
    import { type PageMatch, type PageSummary, type PageSearchResult } from "../../../shared/types/content";
    import { type Command } from "../../../shared/content/commands";
    type PageOption = Pick<PageSummary, "id" | "title" | "kind"> & { match?: PageMatch; openedAt?: number };
    export type SearchChoice = { page: string; otherGroup: boolean } | { command: Command };
</script>

<script lang="ts">
    import { commands, menus } from "../../../shared/content/commands";
    import { isBuiltin } from "../../../shared/attrs/builtins";
    import { commandLabel, t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import { kindIcons } from "../Knowledge/labels";
    import Input from "../base/Input.svelte";
    import ListRow from "../base/ListRow.svelte";
    import Highlight from "./Highlight.svelte";

    type Lookup = { keyword: string; status: "waiting" | "ready" | "failed" | "cancelled"; enter?: { otherGroup: boolean } };
    let { query = $bindable(""), input = $bindable(), search, recent, formatTime, disabled, onchoose }: {
        query?: string; input?: HTMLInputElement;
        search: (keyword: string, offset: number) => Promise<{ items: PageSearchResult[]; total: number }>;
        recent: () => Promise<PageOption[]>; formatTime: (ms: number) => string;
        disabled: (id: Command) => boolean; onchoose: (choice: SearchChoice) => void;
    } = $props();
    const uid = $props.id(), listId = uid + "-results";
    const commandIds: Command[] = menus.flatMap<Command>(menu => [...menu.items]);
    let list: HTMLDivElement, pages = $state.raw<PageOption[]>([]), selected = $state(0), shown = $state("");
    let pending = $state(false), more = $state(false), error = $state<ErrorValue>("");
    let offset = 0;
    const lookup = $derived<Lookup>({ keyword: query.trim(), status: "waiting" });
    const commandMode = $derived(query.startsWith(">"));
    const needle = $derived(commandMode ? query.slice(1).trim() : shown);
    const options = $derived(commandMode ? commandIds.map(id => ({
        id, title: commandLabel(id), detail: commands[id].shortcut, snippet: "", icon: undefined, disabled: disabled(id), choice: { command: id } as SearchChoice
    })).filter(row => row.title.toLocaleLowerCase().includes(needle.toLocaleLowerCase())) : pages.map(page => ({
        id: page.id, title: page.title || t("shell.untitled"), icon: kindIcons[page.kind], detail: detail(page),
        snippet: page.match && page.match.field !== "title" ? page.match.snippet : "",
        disabled: false, choice: { page: page.id, otherGroup: false } as SearchChoice
    })));

    function detail(page: PageOption): string {
        const match = page.match;
        if (!match) return page.openedAt === undefined ? "" : formatTime(page.openedAt);
        if (match.field === "attribute") return isBuiltin(match.id) ? t(`attributeName.${match.id}`) : match.name;
        return t(match.field === "title" ? "quickOpen.title" : "quickOpen.body");
    }
    $effect(() => {
        const current = lookup, commandsOnly = commandMode;
        more = false; error = ""; pending = !commandsOnly;
        if (commandsOnly) {
            selected = 0;
            if (list) list.scrollTop = 0;
        }
        const timer = commandsOnly ? undefined : setTimeout(() => void load(current, false), current.keyword ? 120 : 0);
        return () => {
            current.status = "cancelled"; clearTimeout(timer);
        };
    });

    function isCurrent(current: Lookup): boolean {
        return current.status !== "cancelled" && current === lookup;
    }
    async function load(current: Lookup, append: boolean): Promise<void> {
        const { keyword } = current;
        pending = true;
        try {
            const result = keyword ? await search(keyword, append ? offset : 0) : { items: await recent(), total: 0 };
            if (!isCurrent(current)) return;
            if (append) {
                const existing = new Set(pages.map(page => page.id));
                pages = [...pages, ...result.items.filter(page => !existing.has(page.id))];
            }
            else {
                pages = result.items; selected = 0;
                list.scrollTop = 0;
            }
            offset = (append ? offset : 0) + result.items.length;
            more = !!result.items.length && offset < result.total;
            shown = keyword; error = "";
            if (!append) {
                current.status = "ready";
                if (current.enter && result.items.length) onchoose({ page: result.items[0].id, otherGroup: current.enter.otherGroup });
            }
        }
        catch (problem) {
            if (isCurrent(current)) {
                if (!append) current.status = "failed";
                error = failure(problem); more = false;
            }
        }
        finally {
            if (isCurrent(current)) pending = false;
        }
    }
    function nextPage(): void {
        if (more && !pending && lookup.status === "ready") void load(lookup, true);
    }
    function choose(index: number, otherGroup: boolean): void {
        const option = options[index];
        if (!option || option.disabled || (!commandMode && lookup.status !== "ready")) return;
        const choice = option.choice;
        onchoose("page" in choice ? { ...choice, otherGroup } : choice);
    }
    function move(index: number): void {
        selected = Math.max(0, Math.min(options.length - 1, index));
        list.children[selected]?.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (selected === options.length - 1) nextPage();
    }
    function screen(direction: number): number {
        const rows = [...list.querySelectorAll<HTMLElement>("[data-result]")], row = rows[selected];
        if (!row) return 0;
        const target = row.offsetTop + direction * list.clientHeight;
        const next = rows.findIndex(item => item.offsetTop >= target);
        return next < 0 ? rows.length - 1 : next;
    }
    function keydown(event: KeyboardEvent): void {
        if (event.isComposing || event.key === "Process") return;
        switch (event.key) {
            case "ArrowDown": move(selected + 1); break;
            case "ArrowUp": move(selected - 1); break;
            case "PageDown": move(screen(1)); break;
            case "PageUp": move(screen(-1)); break;
            case "Enter":
                if (!commandMode && lookup.status === "waiting") lookup.enter = { otherGroup: event.ctrlKey };
                else choose(selected, event.ctrlKey);
                break;
            default: return;
        }
        event.preventDefault(); event.stopPropagation();
    }
</script>

<div class="quick-open">
    <div class="search-input" class:pending>
        <Input bind:input bind:value={query} label={t("quickOpen.input")} placeholder={t("quickOpen.input")}
            inputProps={{ role: "combobox", autocomplete: "off", spellcheck: false, "aria-expanded": true, "aria-controls": listId,
                "aria-autocomplete": "list", "aria-activedescendant": options[selected] ? uid + "-" + selected : undefined, onkeydown: keydown }} />
    </div>
    <div class="search-results" id={listId} role="listbox" aria-label={t("quickOpen.results")} aria-busy={pending} bind:this={list}
        onscroll={() => {
            if (list.scrollTop + list.clientHeight >= list.scrollHeight - 1) nextPage();
        }}>
        {#each options as row, i (row.id)}
            <div data-result>
                <ListRow title={row.title} icon={row.icon} selected={selected === i} focused={selected === i}
                    buttonProps={{ id: uid + "-" + i, role: "option", tabindex: -1, "aria-selected": selected === i, "aria-disabled": row.disabled,
                        onpointermove: () => selected = i, onmousedown: event => event.preventDefault() }}
                    onclick={event => choose(i, event.ctrlKey)}>
                    <span class="result-copy"><span class="result-heading"><span class="result-title"><Highlight text={row.title} keyword={needle} /></span>
                        <span class="result-detail">{row.detail}</span></span>
                        {#if row.snippet}<span class="result-snippet"><Highlight text={row.snippet} keyword={needle} /></span>{/if}
                    </span>
                </ListRow>
            </div>
        {/each}
    </div>
    {#if error}<p role="alert">{message(error)}</p>
    {:else if !options.length && !pending}<p>{t(commandMode ? "quickOpen.noCommands" : "quickOpen.noPages")}</p>{/if}
</div>

<style>
    .quick-open { display: flex; flex-direction: column; min-width: 0; max-height: inherit; padding: var(--ui-space-2); color: var(--ui-text); }
    .search-input { display: grid; flex: none; position: relative; margin: var(--ui-space-1) var(--ui-space-1) var(--ui-space-2); }
    .pending::after { content: ""; position: absolute; inset: auto 0 0; height: var(--ui-active-border); background: var(--ui-accent); transform-origin: left; animation: progress 1s ease-in-out infinite alternate; pointer-events: none; }
    @keyframes progress { from { transform: scaleX(.2); } to { transform: scaleX(1); } }
    .search-results { position: relative; overflow: auto; min-height: 0; max-height: var(--ui-search-list-height); }
    [data-result] :global(.ui-row) { height: auto; min-height: var(--ui-row-height); }
    [data-result] :global(.ui-row-main) { min-height: var(--ui-row-height); padding: var(--ui-space-1) var(--ui-space-3); gap: var(--ui-space-3); align-items: flex-start; }
    [data-result] :global(.ui-row-main > .icon) { margin-top: var(--ui-space-1); }
    [data-result] :global([aria-disabled="true"]) { color: var(--ui-text-disabled); cursor: default; }
    .result-copy { flex: 1; min-width: 0; }
    .result-heading { display: flex; min-width: 0; align-items: baseline; gap: var(--ui-space-4); }
    .result-title, .result-detail, .result-snippet { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .result-title { flex: 1; }
    .result-detail, .result-snippet, p { font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
    .result-detail { max-width: 50%; }
    .result-snippet { display: block; }
    p { margin: var(--ui-space-2) var(--ui-space-3); }
</style>