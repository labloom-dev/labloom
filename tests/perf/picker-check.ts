import type { Editor } from "@tiptap/core";

type Percentiles = { samples: number; p50: number; p95: number; max: number };
type Measurements = { fixedPage: string; open: Percentiles; filter: Percentiles; down: Percentiles; pageDown: Percentiles; mounted: number;
    references: { rows: number; requests: number; singleResolveCalls: number; roundTripMs: number; paintMs: number } };

// Runs in the isolated app window. Dispatch DOM events explicitly so a real input method is never driven.
export async function checkPicker(ids: { origin: string; large: string; references: string }): Promise<Measurements> {
    const delay = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));
    const paint = (): Promise<void> => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    function assert(ok: unknown, detail: string): asserts ok {
        if (!ok) throw new Error(detail);
    }
    async function wait<T>(read: () => T, label: string): Promise<NonNullable<T>> {
        const until = performance.now() + 10000;
        for (;;) {
            const value = read();
            if (value) return value;
            if (performance.now() > until) throw new Error("Timed out: " + label);
            await delay(2);
        }
    }
    const find = <T extends HTMLElement = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
    const key = (element: HTMLElement, key: string, init: KeyboardEventInit = {}): boolean =>
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    const type = (input: HTMLInputElement, text: string): void => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    function composing(element: HTMLElement, keys: string[], native = true): void {
        assert(document.activeElement === element, "Expected focus on " + element.outerHTML.slice(0, 120) + ", active " + document.activeElement?.outerHTML.slice(0, 120));
        for (const flag of [{ isComposing: true }, { keyCode: 229 }, { isComposing: true, keyCode: 229 }]) {
            for (const name of keys) {
                let delivered = false;
                const observe = (): void => {
                    delivered = true;
                };
                element.addEventListener("keydown", observe, { once: true });
                const allowed = key(element, name, { ...flag, shiftKey: name === "F10", ctrlKey: name === "/" });
                element.removeEventListener("keydown", observe);
                assert(delivered, "Composition did not reach " + element.tagName + " for " + name);
                if (native) assert(allowed, "Control cancelled native composition for " + name);
            }
        }
        assert(document.activeElement === element, "Composition unexpectedly moved focus");
    }

    const pinned = await wait(() => [...document.querySelectorAll<HTMLElement>("[data-panel-node=page]")].find(el => el.dataset.panelKey?.endsWith(ids.origin)), "pinned test page");
    pinned.click();
    const dom = await wait(() => {
        const el = find<HTMLElement & { editor: Editor }>("[data-tabs-content]:not([hidden]) .tiptap");
        return el?.editor && el.isContentEditable && !el.closest("[inert],[hidden]") && el;
    }, "editable page");
    const editor = dom.editor;
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize + 4);
    editor.view.focus();
    // The first 229 can precede compositionstart. ProseMirror must see it after a deletion key.
    const keyState = (editor.view as typeof editor.view & { input: { lastKeyCode: number } }).input;
    key(dom, "Backspace", { keyCode: 8 });
    assert(keyState.lastKeyCode === 8, "ProseMirror did not record Backspace");
    key(dom, "Process", { keyCode: 229 });
    assert(Number(keyState.lastKeyCode) === 229, "ProseMirror retained a stale Backspace");
    dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    composing(dom, ["Process", "F10", "ContextMenu", "/", "ArrowDown", "Enter", "Escape"], false);
    assert(!find("[role=menu],.target-picker"), "Composition opened an editor menu");
    dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await delay(80);
    find<HTMLButtonElement>(".group-header [aria-label=属性]")!.click();
    const property = await wait(() => find<HTMLTextAreaElement>(".properties textarea"), "property textarea");
    await wait(() => !property.disabled && !property.closest("[inert],[hidden]"), "editable property");
    property.focus();
    composing(property, ["Process", "Enter", "Escape", "ArrowDown"]);
    const select = find<HTMLButtonElement>(".properties .ui-select")!;
    select.focus();
    composing(select, ["ArrowDown", "Enter"]);
    assert(select.getAttribute("aria-expanded") === "false", "Composition opened the property select");
    key(select, "ArrowDown");
    await wait(() => find(".ui-options [data-highlighted]"), "open property select");
    const highlighted = find(".ui-options [data-highlighted]");
    composing(select, ["ArrowDown", "Enter", "Escape"]);
    await paint();
    assert(find(".ui-options [data-highlighted]") === highlighted && select.getAttribute("aria-expanded") === "true", "Composition changed the open select");
    key(select, "Escape");
    await wait(() => !find(".ui-options"), "dismiss select");
    const add = find<HTMLButtonElement>(".properties button")!;
    add.click();
    const propertySearch = await wait(() => find<HTMLInputElement>(".property-picker input"), "property search");
    await wait(() => document.activeElement === propertySearch, "property input focus");
    const active = propertySearch.getAttribute("aria-activedescendant");
    composing(propertySearch, ["Process", "ArrowDown", "ArrowUp", "Enter", "Escape"]);
    await paint();
    assert(propertySearch.isConnected && propertySearch.getAttribute("aria-activedescendant") === active, "Composition changed the property picker");
    key(propertySearch, "Escape");
    await wait(() => !find(".property-picker"), "close properties picker");
    editor.view.focus();
    key(dom, "/", { ctrlKey: true, code: "Slash" });
    const item = await wait(() => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(el => el.textContent.includes("在后面放入同步块")), "sync action");
    await paint();
    item.focus();
    composing(item, ["ArrowDown", "Enter", "Escape"]);
    await paint();
    assert(item.isConnected && document.activeElement === item && !find(".target-picker"), "Composition changed the block menu: " + document.activeElement?.outerHTML.slice(0, 160) + " connected=" + item.isConnected);
    item.click();
    const input = (): HTMLInputElement | null => find<HTMLInputElement>(".target-picker input");
    let field = await wait(input, "page search");
    await wait(() => document.activeElement === field, "search focus");
    composing(field, ["Process", "ArrowDown", "ArrowRight", "Enter", "Escape"]);
    await paint();
    assert(input() === field, "Composition changed the page picker");
    const selectPage = async (title: string): Promise<void> => {
        field = await wait(input, "page input");
        type(field, title);
        await wait(() => field.placeholder === "搜索页面…" && !!find(".target-picker [role=option]")?.textContent.includes(title), "page result " + title);
    };
    const option = (): HTMLElement | null => find(".target-picker [role=option]");
    const selected = (): HTMLElement | null => document.getElementById(input()?.getAttribute("aria-activedescendant") ?? "");
    function stats(samples: number[]): Percentiles {
        const sorted = [...samples].sort((a, b) => a - b);
        const percentile = (p: number): number => +sorted[Math.ceil(p * sorted.length) - 1].toFixed(2);
        return { samples: sorted.length, p50: percentile(.5), p95: percentile(.95), max: percentile(1) };
    }
    const pages = window.api.pages, read = pages.blockList, resolve = pages.resolve, timings: number[] = [];
    let individual = 0, readId = "";
    pages.blockList = async id => {
        readId = id;
        const start = performance.now(), result = await read(id);
        timings.push(performance.now() - start);
        return result;
    };
    pages.resolve = (...args) => {
        individual++;
        return resolve(...args);
    };
    console.info("CHECK Editor, property textarea, property picker, block menu and page picker received composing keydowns.");
    const entry: number[] = [], filter: number[] = [], down: number[] = [], pageDown: number[] = [];
    let mounted = 0;
    for (let i = 0; i <= 20; i++) {
        await selectPage("Large page");
        const start = performance.now();
        key(field, "ArrowRight");
        await wait(() => {
            const view = find(".target-picker [role=listbox]"), rows = view?.querySelectorAll("[role=option]");
            if (!view?.clientHeight || !rows || rows.length < 3 || rows[0].getAttribute("aria-setsize") !== "9999") return false;
            return selected() && rows[rows.length - 1].getBoundingClientRect().bottom >= view.getBoundingClientRect().bottom - 1;
        }, "visible 10,000-block outline");
        await paint();
        assert(readId === ids.large, "Benchmarked a different page");
        const shownMs = performance.now() - start;
        if (i) entry.push(shownMs);
        if (i === 0 || i % 5 === 0) console.info("CHECK Outline trial " + i + ": " + shownMs.toFixed(1) + "ms");
        mounted = Math.max(mounted, document.querySelectorAll(".target-picker [role=option]").length);
        field = input()!;
        if (i === 0) {
            const before = selected();
            composing(field, ["ArrowDown", "PageDown", "ArrowLeft", "Enter", "Escape"]);
            await paint();
            assert(selected() === before && field.isConnected, "Composition changed the block list");
        }
        for (const query of ["r", "re", "res", "rese", "resea", "resear", "researc", "research"]) {
            const start = performance.now();
            type(field, query);
            await wait(() => option()?.querySelector("strong")?.textContent?.toLowerCase() === query, "painted filter " + query);
            await paint();
            if (i) filter.push(performance.now() - start);
        }
        if (i === 1) {
            async function move(name: string, samples: number[], count: number): Promise<void> {
                for (let n = 0; n < count; n++) {
                    const prior = Number(selected()?.getAttribute("aria-posinset")), start = performance.now();
                    key(field, name, { repeat: n > 0 });
                    await wait(() => Number(selected()?.getAttribute("aria-posinset")) > prior, name);
                    const pos = selected()!.getBoundingClientRect(), view = find(".target-picker [role=listbox]")!.getBoundingClientRect();
                    assert(pos.top >= view.top - 1 && pos.bottom <= view.bottom + 1, "Keyboard selection scrolled outside the list");
                    await paint();
                    samples.push(performance.now() - start);
                }
            }
            console.info("CHECK Measuring repeated navigation");
            await move("ArrowDown", down, 90);
            await move("PageDown", pageDown, 30);
            const prior = Number(selected()?.getAttribute("aria-posinset"));
            key(field, "PageUp");
            await wait(() => Number(selected()?.getAttribute("aria-posinset")) < prior, "PageUp");
        }
        type(field, "");
        key(field, "Backspace");
        await wait(() => input()?.placeholder === "搜索页面…", "back to pages");
    }
    assert(mounted > 1 && mounted < 40, "List mounted " + mounted + " rows");
    await selectPage("500 references");
    timings.length = 0; individual = 0;
    const start = performance.now();
    key(field, "ArrowRight");
    await wait(() => option()?.textContent.includes("Reference target 0"), "resolved labels");
    await paint();
    const elapsed = performance.now() - start;
    field = input()!;
    type(field, "target 497");
    await wait(() => option()?.getAttribute("aria-setsize") === "1" && option()?.textContent.includes("Reference target 497"), "filter by resolved title");
    assert(readId === ids.references && timings.length === 1 && individual === 0, "Reference labels must share one read");
    key(field, "Escape");
    await wait(() => !find(".target-picker"), "close completed picker");
    editor.view.focus();
    key(dom, "p", { ctrlKey: true, code: "KeyP" });
    const search = await wait(() => find<HTMLInputElement>(".search-popup input"), "global search");
    type(search, "research");
    await wait(() => find(".search-popup [aria-setsize='30']"), "first global search page");
    const results = find(".search-popup [role=listbox]")!;
    results.scrollTop = results.scrollHeight;
    await wait(() => find(".search-popup [aria-setsize='60']"), "scroll-loaded second page");
    key(search, "ArrowDown");
    await wait(() => document.getElementById(search.getAttribute("aria-activedescendant") ?? "")?.getAttribute("aria-posinset") === "2", "selection brought back into view");
    // All pages have the same body phrase; these search hits have the extra snippet line.
    type(search, "ordinary research");
    await wait(() => find(".search-popup .result-snippet strong"), "two-line global search rows");
    key(search, "PageDown");
    await paint();
    const hit = document.getElementById(search.getAttribute("aria-activedescendant") ?? "");
    assert(hit && Number(hit.getAttribute("aria-posinset")) > 1 && hit.getBoundingClientRect().bottom <= results.getBoundingClientRect().bottom + 1, "Global search PageDown did not reveal the two-line hit");
    key(search, "Escape");
    return { fixedPage: ids.large, open: stats(entry), filter: stats(filter), down: stats(down), pageDown: stats(pageDown), mounted,
        references: { rows: 500, requests: timings.length, singleResolveCalls: individual, roundTripMs: +timings[0].toFixed(2), paintMs: +elapsed.toFixed(2) } };
}