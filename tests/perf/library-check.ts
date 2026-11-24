// Runs inside the actual Electron renderer with the application's preload and IPC.
export async function checkLibrary(papers: boolean): Promise<Record<string, number>> {
    const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    const frame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve));
    const paint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const p95 = (values: number[]): number => +values.toSorted((a, b) => a - b)[Math.ceil(values.length * .95) - 1].toFixed(1);
    const find = <T extends HTMLElement = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
    async function until<T>(read: () => T | undefined | null | false, name: string): Promise<T> {
        const start = performance.now();
        for (;;) {
            const value = read();
            if (value) return value;
            if (performance.now() - start > 15000) throw Error(name + ": " + document.body.innerText.slice(-800));
            await sleep(4);
        }
    }
    const active = "[data-tabs-content]:not([hidden]) .library ";
    const grid = (): HTMLElement => find(active + "[role=grid]")!;
    const sink = (): HTMLInputElement => find<HTMLInputElement>(active + "[data-library-keyboard]")!;
    const rows = (): HTMLElement[] => [...(grid()?.querySelectorAll<HTMLElement>(".library-row") ?? [])];
    const open = (): void => find(".activity [data-icon=" + (papers ? "book" : "library") + "]")!.closest("button")!.click();
    const close = async (): Promise<void> => {
        find(".tab.active .close-tab")!.click();
        await until(() => !find(active + "[role=grid]"), "close library");
    };
    const key = (key: string, options: KeyboardEventInit = {}): void => {
        sink().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
    };
    async function update(action: () => void): Promise<number> {
        let waiting = false, seen = false;
        const observer = new MutationObserver(events => {
            for (const event of events) if (event.oldValue === "true") seen = true;
            waiting ||= grid()?.getAttribute("aria-busy") === "true";
        });
        observer.observe(grid(), { attributes: true, attributeFilter: ["aria-busy"], attributeOldValue: true });
        try {
            const start = performance.now(); action();
            await until(() => (waiting || seen) && grid()?.getAttribute("aria-busy") === "false", "query update");
            await paint();
            return performance.now() - start;
        }
        finally {
            observer.disconnect();
        }
    }
    await until(() => find(".activity [data-icon=book]"), "application start");
    const opens: number[] = [], sorts: number[] = [], searches: number[] = [];
    const total = papers ? 5000 : 10000;
    for (let i = 0; i <= 20; i++) {
        const start = performance.now();
        open();
        await until(() => grid()?.getAttribute("aria-rowcount") === String(total + 1) && grid().getAttribute("aria-busy") === "false" && rows()[0]?.dataset.kind && rows().at(-1)?.dataset.kind, "first viewport");
        await paint();
        if (i) opens.push(performance.now() - start);
        if (i < 20) await close();
    }
    const columns = papers ? ["title", "paper_authors", "paper_year", "paper_venue", "created_at"] : ["title", "kind", "tags", "modified_at"];
    for (let i = 0; i < 20; i++) sorts.push(await update(() => find(active + "[role=columnheader][data-column=\"" + columns[i % columns.length] + "\"] button")!.click()));
    const input = find<HTMLInputElement>(active + ".library-toolbar input")!;
    function query(text: string): void {
        input.value = text; input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text.at(-1) }));
    }
    for (const word of ["Coastal", "海洋观测", "Sampling", "10.1234"]) {
        for (let i = 1; i <= word.length; i++) searches.push(await update(() => query(word.slice(0, i))) - 200);
        await update(() => query(""));
    }
    if (rows().length >= 80 || grid().scrollHeight < total * 20) throw Error("Virtual list size");
    rows()[0].click();
    key("End");
    await until(() => rows().at(-1)?.getAttribute("aria-rowindex") === String(total + 1) && rows().at(-1)?.dataset.kind, "last batch");
    key("Home"); await paint();
    key("ArrowDown", { shiftKey: true });
    await until(() => rows().filter(r => r.ariaSelected === "true").length === 2, "range selection");
    const before = rows().find(r => r.ariaSelected === "true")?.dataset.pageId;
    key("End", { isComposing: true });
    key("Process", { keyCode: 229 });
    if (before !== rows().find(r => r.ariaSelected === "true")?.dataset.pageId) throw Error("IME moved selection");
    sink().dispatchEvent(new CompositionEvent("compositionend", { data: "海洋", bubbles: true }));
    await until(() => rows().some(r => r.ariaSelected === "true" && r.querySelector("[data-column=title] .cell-label")?.textContent?.trim().startsWith("海洋")), "committed type-ahead");
    key("Home");
    const arrow: number[] = [];
    let last = await frame();
    for (let i = 0; i < 150; i++) {
        key("ArrowDown", { repeat: i > 0 }); const next = await frame();
        arrow.push(next - last); last = next;
    }
    return { open: p95(opens), sort: p95(sorts), search: p95(searches), arrow: p95(arrow) };
}

export async function checkLibraryDeletion(papers: boolean): Promise<number> {
    const active = "[data-tabs-content]:not([hidden]) .library ", total = papers ? 5000 : 10000;
    const find = (selector: string): HTMLElement | null => document.querySelector(selector);
    const paint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const until = async (get: () => HTMLElement | null): Promise<HTMLElement> => {
        const limit = performance.now() + 30000;
        for (;;) {
            const el = get();
            if (el) return el;
            if (performance.now() > limit) throw Error("Bulk confirmation did not open");
            await new Promise(resolve => setTimeout(resolve, 4));
        }
    };
    const key = (value: string, opts: KeyboardEventInit = {}): void => {
        find(active + "[data-library-keyboard]")!.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...opts }));
    };
    const started = performance.now(); key("a", { ctrlKey: true }); key("Delete");
    const dialog = await until(() => find("[role=dialog].confirmation") ?? find(".shade[role=dialog] .confirmation"));
    await paint(); const deletion = performance.now() - started;
    if (!find(active + "aside")?.textContent?.includes(String(total))) throw Error("Partial select all");
    if (papers && !(dialog.textContent?.includes("批注 00001") && dialog.textContent.includes("Annotation 09991"))) throw Error("Missing dependent annotations from recycle preview");
    dialog.querySelector("button")!.click();
    find(".tab.active .close-tab")!.click();
    await paint();
    return +deletion.toFixed(1);
}