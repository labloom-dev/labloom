import type { TableParams } from "../../shared/workspace/table";
import type { ViewQuery } from "../../shared/workspace/query";

// Executed in the isolated development renderer through the same tab and IPC APIs as the controls.
export async function checkView(params: TableParams, groupFields: [string, string]): Promise<Record<string, number>> {
    const tabApi = "/components/Tab/api.ts", tabStore = "/components/Tab/state.svelte.ts";
    const { addTab, getTabID, setViewParams, removeTab } = await import(tabApi) as typeof import("../../renderer/components/Tab/api");
    const { tabState } = await import(tabStore) as typeof import("../../renderer/components/Tab/state.svelte");
    const paint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const frame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve));
    const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    const p95 = (samples: number[]): number => +samples.toSorted((a, b) => a - b)[Math.ceil(samples.length * .95) - 1].toFixed(1);
    const prefix = "[data-tabs-content]:not([hidden]) .library ";
    const find = <T extends HTMLElement = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
    const grid = (): HTMLElement | null => find(prefix + ".library-grid");
    const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(prefix + ".library-row")];
    const sink = (): HTMLInputElement => find<HTMLInputElement>(prefix + "[data-library-keyboard]")!;
    async function until<T>(read: () => T | null | undefined | false, label: string): Promise<T> {
        const start = performance.now();
        for (;;) {
            const value = read();
            if (value) return value;
            if (performance.now() - start > 25000) throw Error(label + ": " + document.body.innerText.slice(-850));
            await pause(4);
        }
    }
    const key = (target: HTMLElement, key: string, options: KeyboardEventInit = {}): void => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
    };
    const input = (target: HTMLInputElement, value: string): void => {
        target.value = value;
        target.dispatchEvent(new InputEvent("input", { bubbles: true, data: value.at(-1) }));
    };
    let tabId = "", query = structuredClone(params.query);
    function change(patch: Partial<ViewQuery>): void {
        query = { ...query, ...patch };
        setViewParams(tabId, { ...params, query });
    }
    async function updated(action: () => void, label: string): Promise<number> {
        const element = grid()!;
        let busy = false;
        const observer = new MutationObserver(events => {
            busy ||= element.ariaBusy === "true" || events.some(event => event.oldValue === "true");
        });
        observer.observe(element, { attributes: true, attributeOldValue: true, attributeFilter: ["aria-busy"] });
        const start = performance.now();
        try {
            action();
            await until(() => busy && element.ariaBusy === "false", label);
            await paint();
            return performance.now() - start;
        }
        finally {
 observer.disconnect();
}
    }

    await until(() => find(".activity [data-icon=library]"), "renderer startup");
    const open: number[] = [], filters: number[] = [], sorts: number[] = [], groups: number[] = [], search: number[] = [];
    for (let i = 0; i <= 20; i++) {
        tabId = getTabID();
        const start = performance.now();
        addTab(tabState.focusedGroupId, { id: tabId, view: { type: "library", params } });
        await until(() => grid()?.ariaBusy === "false" && rows()[0]?.dataset.kind && find(prefix + ".group-row"), "grouped first viewport");
        await paint();
        if (i) open.push(performance.now() - start);
        if (i < 20) {
            removeTab(tabId);
            await until(() => !grid(), "close table");
        }
    }
    const [initialDate, text, multi] = query.conditions, [firstSort, secondSort] = query.sort;
    for (let i = 0; i < 20; i++) filters.push(await updated(() => change({ conditions: [
        initialDate, { ...text, values: [i % 2 ? "study" : "protocol"] }, multi
    ] }), "change condition"));
    for (let i = 0; i < 20; i++) sorts.push(await updated(() => change({
        sort: [{ ...firstSort, direction: i % 2 ? "desc" : "asc" }, secondSort]
    }), "change sort"));
    for (let i = 0; i < 20; i++) groups.push(await updated(() => change({
        group: { field: { kind: "attribute", id: groupFields[(i + 1) % 2] }, collapsed: [] }
    }), "change group"));
    const field = find<HTMLInputElement>(prefix + ".library-toolbar input")!;
    for (const word of ["Coastal", "海洋观测", "Sampling", "10.1234"]) {
        for (let i = 1; i <= word.length; i++) search.push(await updated(() => input(field, word.slice(0, i)), "change search") - 200);
        await updated(() => input(field, ""), "clear search");
    }
    console.info("View query timings", JSON.stringify({ open: p95(open), filter: p95(filters), sort: p95(sorts), group: p95(groups), search: p95(search) }));

    await updated(() => change({ group: { field: { kind: "attribute", id: groupFields[1] }, collapsed: [] } }), "choose multiselect grouping");
    const headings = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(prefix + ".group-row button")];
    const first = headings()[0];
    first.click();
    await until(() => first.getAttribute("aria-expanded") === "false", "fold group");
    key(sink(), "ArrowRight");
    await until(() => first.getAttribute("aria-expanded") === "true", "keyboard expand group");
    const beforeArrow = grid()!.scrollTop;
    const arrow: number[] = [];
    let previous = await frame();
    for (let i = 0; i < 150; i++) {
        key(sink(), "ArrowDown", { repeat: i > 0 }); const next = await frame();
        arrow.push(next - previous); previous = next;
    }
    if (grid()!.scrollTop <= beforeArrow + grid()!.clientHeight || !find(prefix + ".sticky-group")) throw Error("Grouped keyboard sampling did not scroll");
    key(sink(), "Home");
    const deleteStart = performance.now();
    key(sink(), "a", { ctrlKey: true }); key(sink(), "Delete");
    const confirm = await until(() => find(":popover-open [role=alertdialog]"), "unique grouped deletion");
    await paint();
    const deletion = +(performance.now() - deleteStart).toFixed(1);
    confirm.querySelector("button")!.click();
    await until(() => !find(":popover-open [role=alertdialog]"), "close delete confirmation");

    const created: number[] = [];
    for (let i = 0; i <= 20; i++) {
        const start = performance.now();
        find(prefix + "[data-table-create]")!.click();
        const editor = await until(() => {
            const field = find<HTMLInputElement>(prefix + "[data-cell-editor] input");
            return field && document.activeElement === field && field;
        }, "new title input");
        if (i) created.push(performance.now() - start);
        const row = editor.closest<HTMLElement>("[data-page-id]")!;
        if (!i) {
            const page = await window.api.pages.get(row.dataset.pageId!);
            if (!(page.attributes[groupFields[1]] as string[]).includes("a")) throw Error("New row lost its condition value");
        }
        key(editor, "Escape");
        await until(() => !find(prefix + "[data-cell-editor]"), "cancel new title");
        await until(() => !find<HTMLButtonElement>(prefix + "[data-table-create]")?.disabled, "new row written");
    }

    if (text.field.kind !== "attribute") throw Error("Study notes column missing from fixture");
    const column = "[data-column=\"" + CSS.escape(text.field.id) + "\"]";
    await updated(() => change({ group: undefined, sort: [{ field: text.field, direction: "asc" }, firstSort] }), "set reorderable sort");
    const edits: number[] = [];
    for (let i = 0; i <= 20; i++) {
        key(sink(), "Home");
        await paint();
        const row = rows()[3], id = row.dataset.pageId!, value = "Study " + (1000 - i);
        row.click();
        key(sink(), "F2", { isComposing: true });
        if (find(prefix + "[data-cell-editor]")) throw Error("IME triggered cell editing");
        if (!i) {
            key(sink(), "F2");
            const title = await until(() => find<HTMLInputElement>(prefix + "[data-cell-editor] input"), "F2 title editor");
            key(title, "Escape");
            await until(() => !find(prefix + "[data-cell-editor]"), "escape title edit");
        }
        row.querySelector<HTMLElement>(column)!.click();
        const editor = await until(() => find<HTMLInputElement>(prefix + column + " [data-cell-editor] input"), "text cell editor");
        input(editor, value);
        const start = performance.now();
        key(editor, "Enter");
        await until(() => grid()?.ariaBusy === "false" && rows()[0].dataset.pageId === id &&
            rows()[0].querySelector(column + " .cell-label")?.textContent === value, "saved attribute and repositioned row");
        await paint();
        if (i) edits.push(performance.now() - start);
    }
    await updated(() => change({ group: { field: { kind: "attribute", id: groupFields[1] }, collapsed: [] } }), "restore groups for wheel");
    return { open: p95(open), filter: p95(filters), sort: p95(sorts), group: p95(groups), search: p95(search),
        arrow: p95(arrow), deletion, create: p95(created), edit: p95(edits) };
}