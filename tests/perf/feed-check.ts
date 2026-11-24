export async function measureFeed(): Promise<Record<string, number>> {
    const active = "[data-tabs-content]:not([hidden]) ";
    const list = (): HTMLElement => document.querySelector(active + ".feed-view .virtual-list")!;
    const rows = (): HTMLElement[] => [...(list()?.querySelectorAll<HTMLElement>("[data-list-row]") ?? [])];
    const paint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    const p95 = (samples: number[]): number => +samples.sort((a, b) => a - b)[Math.ceil(samples.length * .95) - 1].toFixed(1);
    const open = (icon: string): void => document.querySelector(".activity [data-icon=" + icon + "]")!.closest("button")!.click();
    async function wait(test: () => unknown, label: string): Promise<void> {
        const end = performance.now() + 15000;
        while (!test()) {
            if (performance.now() > end) throw Error("Timed out: " + label);
            await sleep(4);
        }
    }
    const populated = (viewport: HTMLElement | null): boolean => !!viewport?.querySelector("[data-list-label]") && viewport.ariaBusy === "false";
    const feedReady = (): boolean => populated(list());
    const overviewReady = (): boolean => {
        const lists = [...document.querySelectorAll<HTMLElement>(active + ".overview .virtual-list")];
        return lists.length === 3 && lists.every(populated);
    };
    async function close(selector: string): Promise<void> {
        document.querySelector<HTMLElement>(".tab.active .close-tab")!.click();
        await wait(() => !document.querySelector(active + selector), "close " + selector);
    }
    async function opening(icon: string, selector: string, ready: () => boolean, keepLast: boolean): Promise<number> {
        const values: number[] = [];
        for (let i = 0; i <= 20; i++) {
            const start = performance.now();
            open(icon);
            await wait(ready, icon + " first rows");
            await paint();
            if (i) values.push(performance.now() - start);
            if (i < 20 || !keepLast) await close(selector);
        }
        return p95(values);
    }
    await wait(overviewReady, "default overview");
    await close(".overview");
    const overview = await opening("home", ".overview", overviewReady, false);
    const first = await opening("rss", ".feed-view", feedReady, true);
    if (rows().length > 45 || list().scrollHeight < 400000) throw Error("The full feed is not virtualized");
    const scope: number[] = [], filter: number[] = [], order: number[] = [], search: number[] = [], reader: number[] = [];

    async function update(action: () => void, debounce = 0): Promise<number> {
        const viewport = list();
        let requested = false;
        const observer = new MutationObserver(records => requested ||= viewport.ariaBusy === "true" || records.some(record => record.oldValue === "true"));
        observer.observe(viewport, { attributes: true, attributeFilter: ["aria-busy"], attributeOldValue: true });
        try {
            const start = performance.now();
            action();
            await wait(() => requested && feedReady(), "updated feed");
            await paint();
            return performance.now() - start - debounce;
        }
        finally {
            observer.disconnect();
        }
    }
    function key(target: HTMLElement, key: string): void {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    function chooseScope(value: string): void {
        document.querySelector<HTMLElement>(active + ".feed-sources [data-scope=\"" + CSS.escape(value) + "\"]")!.click();
    }
    const sources = [...document.querySelectorAll<HTMLElement>(active + ".feed-sources [data-scope]")];
    const source = sources.find(row => row.textContent?.includes("观测站 1"))!;
    const trigger = document.querySelector<HTMLElement>(active + ".feed-toolbar .ui-select")!;
    for (let i = 0; i < 20; i++) {
        scope.push(await update(() => chooseScope(i % 2 === 0 ? source.dataset.scope! : "all")));
        trigger.focus();
        key(trigger, "ArrowDown");
        await wait(() => document.querySelector("[data-select-content]"), "read options");
        filter.push(await update(() => {
            key(trigger, "Home");
            if (i % 2 === 0) key(trigger, "ArrowDown");
            key(trigger, "Enter");
        }));
        order.push(await update(() => document.querySelector<HTMLElement>(active + ".feed-toolbar button[aria-label=\"" + (i % 2 ? "最早在前" : "最新在前") + "\"]")!.click()));
    }
    const input = document.querySelector<HTMLInputElement>(active + ".feed-toolbar input")!;
    function text(value: string): void {
        input.value = value;
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value.at(-1) }));
    }
    for (const term of ["Coastal", "观测与测量"]) {
        for (let i = 1; i <= term.length; i++) search.push(await update(() => text(term.slice(0, i)), 300));
        await update(() => text(""), 300);
    }
    for (let i = 0; i < 20; i++) {
        const row = rows()[i % 2 === 0 ? 0 : 8];
        const expected = row.querySelector<HTMLElement>(".title [data-list-label]")!.textContent;
        const start = performance.now();
        row.click();
        await wait(() => document.querySelector(active + ".feed-reader h2")?.textContent === expected && document.querySelector(active + ".feed-content img"), "long article markup");
        await paint();
        reader.push(performance.now() - start);
        await sleep(150);
    }
    return { overview, first, scope: p95(scope), filter: p95(filter), order: p95(order), search: p95(search), reader: p95(reader) };
}

export async function keyFrames(): Promise<{ frames: number[]; keys: number; chosen: string }> {
    const list = document.querySelector<HTMLElement>("[data-tabs-content]:not([hidden]) .feed-view .virtual-list")!;
    const frame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve));
    const selected = (): string => document.getElementById(list.getAttribute("aria-activedescendant") ?? "")?.dataset.listRow ?? "";
    list.focus();
    let keys = 0;
    const observe = (event: KeyboardEvent): void => {
        if (event.isTrusted && event.key === "ArrowDown") keys++;
    };
    list.addEventListener("keydown", observe);
    try {
        performance.mark("feed-keys-start");
        console.info("FEED_KEYS start");
        const frames: number[] = [];
        let last = await frame();
        for (let i = 0; i < 150; i++) {
            const next = await frame();
            frames.push(next - last); last = next;
        }
        console.info("FEED_KEYS stop");
        performance.mark("feed-keys-end");
        return { frames, keys, chosen: selected() };
    }
    finally {
        list.removeEventListener("keydown", observe);
    }
}

export async function checkFeedPaperState(): Promise<void> {
    const active = "[data-tabs-content]:not([hidden]) .feed-view ";
    const source = { kind: "workspace" } as const, pages = window.api.pages;
    const find = (selector: string): HTMLElement | null => document.querySelector(active + selector);
    const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    async function wait(test: () => unknown, label: string): Promise<void> {
        const end = performance.now() + 10000;
        while (!test()) {
            if (performance.now() > end) throw Error("Timed out: " + label);
            await sleep(10);
        }
    }
    document.querySelector(".activity [data-icon=rss]")!.closest("button")!.click();
    await wait(() => find(".virtual-list")?.ariaBusy === "false" && find("[data-list-row] [data-list-label]"), "feed paper rows");
    const list = find(".virtual-list")!;
    const firstRow = (): HTMLElement | null => find("[data-list-row][aria-posinset=\"1\"]");
    list.scrollTop = 100000;
    await wait(() => !firstRow() && find("[data-list-row] [data-list-label]"), "rows away from the top");
    list.scrollTop = 48;
    await wait(() => firstRow() && find("[data-list-row] .saved"), "linked rows rendered after returning near the top");

    const target = find("[data-list-row] .saved")!.closest<HTMLElement>("[data-list-row]")!;
    const itemId = target.dataset.listRow!;
    const article = await window.api.feed.getItem(itemId);
    const paperId = article.paperId!;
    const topOfList = list.getBoundingClientRect().top;
    const selected = Array.from(list.querySelectorAll<HTMLElement>("[data-list-row]:not(:has(.saved)) .title:not(.unread)"))
        .map(title => title.closest<HTMLElement>("[data-list-row]")!)
        .find(row => row.getBoundingClientRect().top >= topOfList)!;
    selected.click();
    await wait(() => selected.ariaSelected === "true" && find(".feed-reader h2")?.textContent === selected.querySelector(".title [data-list-label]")?.textContent, "different article open");
    const top = list.scrollTop;
    if (!top) throw Error("Expected a nonzero scroll position");
    const menuItem = (text: string): boolean => Array.from(document.querySelectorAll("[role=menuitem] .ui-menu-label")).some(item => item.textContent === text);
    const openMenu = (): void => {
        const box = target.getBoundingClientRect();
        target.dispatchEvent(new MouseEvent("contextmenu", { clientX: box.left + 8, clientY: box.top + 8, bubbles: true, cancelable: true }));
    };
    const closeMenu = async (): Promise<void> => {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await wait(() => !document.querySelector("[role=menu]"), "menu closed");
    };
    const trash = async (): Promise<void> => {
        const preview = await pages.trash([paperId], source);
        if (preview.status === "confirmation" && (await pages.trash([paperId], source, preview.preview.token)).status !== "saved") {
            throw Error("Could not trash the linked paper");
        }
    };
    const badge = (): boolean => !!target.querySelector(".saved");
    const toolbarOpen = (): boolean => !!find(".feed-reader [aria-label=\"打开文献页\"]");

    openMenu();
    await wait(() => badge() && menuItem("打开文献页"), "original badge and menu");
    await trash();
    await wait(() => !badge() && menuItem("加入文献库"), "recycled badge and menu for the unopened article");
    await pages.restore([paperId], source);
    await wait(() => badge() && menuItem("打开文献页"), "restored badge and menu");
    if (selected.ariaSelected !== "true" || target.ariaSelected === "true" || list.scrollTop !== top) {
        throw Error("A paper status change moved the scroll position or selection");
    }
    await closeMenu();

    target.click();
    await wait(() => toolbarOpen(), "linked paper toolbar");
    const openedAt = list.scrollTop;
    await trash();
    await wait(() => !badge() && !toolbarOpen() && !!find(".reader-status")?.textContent?.includes("回收站"), "recycled reader status");
    await window.api.history.apply(source, "undo");
    await wait(() => badge() && toolbarOpen() && !find(".reader-status"), "restored reader via undo");
    await trash();
    const preview = await pages.purge([paperId]);
    if (preview.status !== "confirmation" || (await pages.purge([paperId], preview.token)).status !== "deleted") throw Error("Could not permanently delete the linked paper");
    await wait(() => !badge() && !toolbarOpen() && !!find(".reader-status")?.textContent?.includes("不在当前工作区"), "missing reader status");
    openMenu();
    await wait(() => menuItem("加入文献库"), "missing paper menu");
    await closeMenu();
    if (target.ariaSelected !== "true" || list.scrollTop !== openedAt) throw Error("Permanently deleting a paper moved the selected article");
    await sleep(250);
}

export async function renameUnrelatedPaper(id: string): Promise<void> {
    const page = await window.api.pages.get(id);
    const title = page.blocks[page.titleBlockId];
    const result = await window.api.pages.commitEdit({
        pageId: id, batch: 0, blocks: [{ ...title, payload: { ...title.payload, inline: [{ type: "text", text: "Unrelated paper title" }] } }]
    }, { kind: "page", id });
    if (result.status !== "saved" || (await window.api.pages.get(id)).title !== "Unrelated paper title") throw Error("Unrelated title edit did not save");
    await new Promise(resolve => setTimeout(resolve, 300));
}