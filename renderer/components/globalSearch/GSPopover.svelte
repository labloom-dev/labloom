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
    import SearchList from "./SearchList.svelte";

    type Lookup = { keyword: string; status: "waiting" | "ready" | "failed" | "cancelled"; enter?: { otherGroup: boolean } };
    let { query = $bindable(""), input = $bindable(), search, recent, formatTime, disabled = () => false, onchoose, onpage, onbrowse, label = t("quickOpen.input") }: {
        query?: string; input?: HTMLInputElement;
        search: (keyword: string, offset: number) => Promise<{ items: PageSearchResult[]; total: number }>;
        recent: () => Promise<PageOption[]>; formatTime: (ms: number) => string;
        disabled?: (id: Command) => boolean; onchoose?: (choice: SearchChoice) => void; label?: string;
        onpage?: (page: PageOption) => void; onbrowse?: (page: PageOption) => void;
    } = $props();
    const commandIds: Command[] = menus.flatMap<Command>(menu => [...menu.items]);
    let pages = $state.raw<PageOption[]>([]), selected = $state(0), shown = $state("");
    let pending = $state(false), more = $state(false), error = $state<ErrorValue>("");
    let offset = 0;
    const lookup = $derived<Lookup>({ keyword: query.trim(), status: "waiting" });
    const commandMode = $derived(!onpage && query.startsWith(">"));
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
            }
            offset = (append ? offset : 0) + result.items.length;
            more = !!result.items.length && offset < result.total;
            shown = keyword; error = "";
            if (!append) {
                current.status = "ready";
                if (current.enter && result.items.length) choose(0, current.enter.otherGroup);
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
    function choose(index: number, otherGroup: boolean, keyboard = false): void {
        if (!commandMode && lookup.status === "waiting") {
            if (keyboard) lookup.enter = { otherGroup };
            return;
        }
        const option = options[index];
        if (!option || option.disabled || (!commandMode && lookup.status !== "ready")) return;
        const choice = option.choice;
        if ("page" in choice && onpage) {
            onpage(pages[index]); return;
        }
        onchoose?.("page" in choice ? { ...choice, otherGroup } : choice);
    }
</script>

<SearchList {options} {label} bind:query bind:input bind:selected {needle} {pending} error={message(error)}
    empty={t(commandMode ? "quickOpen.noCommands" : "quickOpen.noPages")} onchoose={choose} onmore={nextPage}
    onbranch={onbrowse ? index => {
        if (lookup.status === "ready" && pages[index]) onbrowse?.(pages[index]);
    } : undefined} />