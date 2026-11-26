// File objects are supplied by Chromium from the temporary workspace, through the real preload.
export async function libraryWorkflow(paths: string[], bulkPapers: string[] | null): Promise<number | null> {
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    async function until<T>(read: () => T | undefined | null | false, label: string): Promise<T> {
        const start = performance.now();
        for (;;) {
            const value = read();
            if (value) return value;
            if (performance.now() - start > 8000) throw Error(label + ": " + document.body.innerText.slice(-500));
            await wait(15);
        }
    }
    const el = <T extends HTMLElement = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
    let library = "[data-tabs-content]:not([hidden]) [data-table-view=papers] ";
    const row = (): HTMLElement | null => el(library + "[data-kind=paper]");
    const info = (): HTMLElement | null => el(library + "[data-history-page]");
    const author = (): HTMLTextAreaElement | null => info()?.querySelector("textarea[aria-label=作者]") ?? null;
    const key = (target: HTMLElement, value: string, options: KeyboardEventInit = {}): void => {
        target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value, ...options }));
    };
    const input = (node: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
        node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const button = (scope: ParentNode | null, text: string): HTMLButtonElement =>
        Array.from(scope?.querySelectorAll("button") ?? []).find(b => b.textContent?.trim() === text)!;
    function identity(icon: "book" | "library", label: string): boolean {
        const tab = el(".group-header.focused [data-tabs-trigger][data-state=active]");
        return tab?.textContent?.trim() === label && !!tab.querySelector(`[data-icon=${icon}]`) &&
            el(`.activity button:has([data-icon=${icon}])`)?.getAttribute("aria-pressed") === "true";
    }
    const knowledge = "[data-tabs-content]:not([hidden]) [data-table-view=library] ";
    el(".activity [data-icon=library]")!.closest("button")!.click();
    await until(() => el(knowledge + "[role=grid][aria-busy=false]"), "knowledge table");
    const tabsPath = "/components/Tab/api.ts";
    const { setViewParams } = await import(tabsPath) as typeof import("../../renderer/components/Tab/api");
    const knowledgeId = el(knowledge + "[role=grid]")!.closest<HTMLElement>("[data-tabs-content]")!.dataset.value!;
    setViewParams(knowledgeId, { query: { conditions: [{ field: { kind: "page-type" }, operator: "not-in", values: ["paper"] }], sort: [] } });
    await until(() => el(knowledge + "[data-table-filter-chip]") && !el(knowledge + "[data-table-import]"), "knowledge excludes PDF import");
    setViewParams(knowledgeId, { query: { conditions: [{ field: { kind: "page-type" }, operator: "in", values: ["paper"] }], sort: [] } });
    await until(() => identity("library", "知识库") && el(knowledge + "[data-table-import]") && el(knowledge + "[data-kind=paper]"), "paper-filtered knowledge identity");
    el(".activity [data-icon=book]")!.closest("button")!.click();
    (await until(row, "paper results")).click();
    if (!identity("book", "文献库") || el(library + "[data-table-filter-chip]") || !el(library + "[data-table-import]")) throw Error("Paper scope leaked into filters");
    const field = await until(author, "paper properties"), id = info()!.dataset.historyPage!, old = field.value;
    field.focus(); input(field, "Library workflow A");
    await until(() => row()?.innerText.includes("Library workflow A"), "table updated by inspector");
    key(field, "z", { ctrlKey: true });
    await until(() => author()?.value === old, "inspector undo");
    key(field, "y", { ctrlKey: true });
    await until(() => author()?.value === "Library workflow A", "inspector redo");
    const sink = (): HTMLElement => el(library + "[data-library-keyboard]")!;
    row()!.querySelector<HTMLElement>("[data-column=paper_authors]")!.click();
    const inline = await until(() => el<HTMLInputElement>(library + "[data-cell-editor] input"), "inline author editor");
    input(inline, "Inline author");
    key(inline, "Tab");
    const next = await until(() => el<HTMLInputElement>(library + "[data-column=paper_year] [data-cell-editor] input"), "next editable column");
    key(next, "Escape");
    await until(() => author()?.value === "Inline author", "inspector updated by direct edit");
    sink().focus();
    key(sink(), "z", { ctrlKey: true });
    await until(() => author()?.value === "Library workflow A", "workspace undo of direct edit");
    sink().focus();
    key(sink(), "p", { ctrlKey: true, altKey: true });
    await until(() => !el(library + "aside"), "close info");
    key(sink(), "p", { ctrlKey: true, altKey: true });
    await until(author, "reopen info");

    key(sink(), "Enter", { ctrlKey: true });
    await until(() => el(".group-header.focused") && el("[data-tabs-content]:not([hidden]) .paper-panel"), "side group");
    const other = await until(() => el<HTMLTextAreaElement>(".page-view textarea[aria-label=作者]"), "page properties");
    if (other.value !== "Library workflow A") throw Error("Page session did not read the inspector edit");
    other.focus(); input(other, "Library workflow B");
    await until(() => author()?.value === "Library workflow B", "live inspector while page is focused");
    await until(() => row()?.innerText.includes("Library workflow B"), "live split table while page is focused");
    author()!.focus(); input(author()!, "Library workflow C");
    await until(() => other.value === "Library workflow C", "live page while inspector is focused");

    sink().focus(); key(sink(), "F10", { shiftKey: true });
    const menu = await until(() => el(".ui-menu"), "row menu");
    if (!menu.textContent?.includes("Ctrl+Enter") || !menu.textContent.includes("Ctrl+Shift+K") || !menu.textContent.includes("Delete")) throw Error("Missing menu shortcut");
    key(menu.querySelector<HTMLElement>("[role=menuitem]")!, "Escape");
    await until(() => !el(".ui-menu"), "dismiss row menu");
    const header = el(library + "[role=columnheader]")!;
    header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 420, clientY: 115 }));
    const doi = await until(() => [...document.querySelectorAll<HTMLElement>("[role=menuitemcheckbox]")].find(e => e.textContent?.trim() === "DOI"), "column menu");
    if ([...document.querySelectorAll("[role=menuitemcheckbox]")].some(e => e.textContent?.trim() === "类型")) throw Error("Papers offer a page-type column");
    doi.click();
    await until(() => el(library + "[role=columnheader][data-column=paper_doi]"), "added DOI column");
    const head = el(library + "[data-column=title]")!, sash = head.querySelector<HTMLElement>("[role=separator]")!;
    sash.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await wait(50);
    const before = head.offsetWidth; key(sash, "ArrowRight");
    await until(() => head.offsetWidth === before + 1, "column width");
    const doiHeader = el(library + "[role=columnheader][data-column=paper_doi]")!, dt = new DataTransfer();
    doiHeader.querySelector("button")!.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    head.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    await until(() => el(library + "[role=columnheader]")?.dataset.column === "paper_doi", "column reorder");
    const toolbar = el(library + ".library-toolbar")!;
    button(toolbar, "筛选").click();
    const filter = await until(() => el(":popover-open .filter-list"), "filter popover");
    button(filter, "添加条件").click();
    const condition = await until(() => filter.querySelector("[data-filter-row]"), "first filter condition");
    condition.querySelector<HTMLButtonElement>(".ui-select")!.click();
    const tags = await until(() => [...document.querySelectorAll<HTMLElement>("[role=option]")].find(o => o.textContent?.trim() === "标签"), "tag field");
    if ([...document.querySelectorAll("[role=option]")].some(e => e.textContent?.trim() === "类型")) throw Error("Papers offer a page-type filter");
    tags.click();
    (await until(() => condition.querySelector<HTMLButtonElement>("button.choices"), "tag condition selector")).click();
    const tagQuery = await until(() => el<HTMLInputElement>(".table-filter-choices input[type=search]"), "tag filter search");
    input(tagQuery, "Climate");
    const tag = await until(() => [...document.querySelectorAll<HTMLElement>(".table-filter-choices [role=option]")].find(item => item.textContent?.trim() === "Climate"), "tag option");
    tag.click();
    key(tagQuery, "Escape");
    const chip = await until(() => [...document.querySelectorAll<HTMLElement>(library + "[data-table-filter-chip]")].find(item => item.textContent?.includes("Climate")), "tag filter chip");
    await until(() => Number(el(library + "[role=grid]")?.getAttribute("aria-rowcount")) < 5001, "filtered total");
    if (!identity("book", "文献库") || !el(library + "[data-table-import]")) throw Error("Paper identity changed after adding a user filter");
    chip.querySelectorAll("button")[1].click();
    await until(() => el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "5001", "remove filter");
    if (filter.isConnected) key(filter.querySelector("button")!, "Escape");
    const importButton = await until(() => button(toolbar, "导入 PDF"), "import PDF button");
    importButton.click();
    await until(() => el(library + "aside > [data-paragraph]")?.textContent?.includes("2"), "multiple PDF selection");
    await until(() => el(":popover-open .toast.error details")?.textContent?.includes("broken.pdf"), "per-file failure");
    el(":popover-open .toast.error button")?.click();
    const target = await until(() => [...document.querySelectorAll<HTMLElement>(library + "[data-kind=paper]")].find(r => r.getAttribute("aria-selected") === "true"), "imported row");
    const importedIds = [...document.querySelectorAll<HTMLElement>(library + "[aria-selected=true][data-page-id]")].map(r => r.dataset.pageId!);
    target.click();
    const attached = await until(() => info()?.querySelector(".library-attachments button"), "imported PDF attachment");
    if (!attached.textContent) throw Error("Unnamed attachment");
    const transfer = new DataTransfer(), fileInput = el<HTMLInputElement>("#library-file-fixture")!;
    for (const file of fileInput.files!) transfer.items.add(file);
    if (!transfer.files.length || window.getPathForFile(transfer.files[0]) !== paths[0]) throw Error("Missing native drop path");
    const box = target.getBoundingClientRect();
    const drag = (type: string, y: number): DragEvent => new DragEvent(type, { bubbles: true, cancelable: true, clientY: y, dataTransfer: transfer });
    target.dispatchEvent(drag("dragover", box.top + box.height / 2));
    await until(() => target.classList.contains("drop-row"), "row drop marker");
    target.dispatchEvent(drag("drop", box.top + box.height / 2));
    await until(() => (info()?.textContent ?? "").includes("notes.txt"), "row attachment import");
    if (el(library + "[role=grid]")?.getAttribute("aria-rowcount") !== "5003") throw Error("Row attachment created a page");
    // Another tab recycles one imported paper before the import selection can settle.
    const keep = target.dataset.pageId!, gone = importedIds.find(id => id !== keep)!;
    const trash = await window.api.pages.trash([gone], { kind: "workspace" });
    if (trash.status !== "confirmation") throw Error("Missing recycle preview");
    await window.api.pages.trash([gone], { kind: "workspace" }, trash.preview.token);
    await until(() => el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "5002", "concurrent recycle");
    const abstract = await until(() => info()?.querySelector<HTMLTextAreaElement>(".abstract textarea"), "empty editable abstract");
    if (abstract.value || info()?.querySelector(".property textarea[aria-label=摘要],.property .file-input")) throw Error("Duplicate abstract or attachments");
    abstract.focus();
    if (!document.execCommand("insertText", false, "Coastal observations\n第二行")) throw Error("Abstract text input failed");
    sink().focus();
    const deadline = performance.now() + 5000;
    while ((await window.api.pages.get(keep)).attributes.paper_abstract !== "Coastal observations\n第二行") {
        if (performance.now() > deadline) throw Error("Abstract was not saved on blur");
        await wait(20);
    }
    abstract.focus(); key(abstract, "z", { ctrlKey: true });
    await until(() => abstract.value === "", "undo abstract");
    key(abstract, "y", { ctrlKey: true });
    await until(() => abstract.value.includes("第二行"), "redo abstract");
    const attachmentList = info()!.querySelector<HTMLElement>(".library-attachments")!;
    const removeNote = [...attachmentList.querySelectorAll<HTMLButtonElement>("button[aria-label]")].find(b => b.ariaLabel?.includes("notes.txt") && !b.textContent?.trim());
    if (!removeNote || !button(attachmentList, "添加文件")) throw Error("Attachment management controls missing");
    removeNote.click();
    await until(() => !attachmentList.textContent?.includes("notes.txt"), "remove attachment");
    author()!.focus(); key(author()!, "z", { ctrlKey: true });
    await until(() => attachmentList.textContent?.includes("notes.txt"), "undo attachment removal");
    button(attachmentList, "清空附件").click();
    await until(() => attachmentList.querySelectorAll(".file-row").length === 0, "clear attachments");
    author()!.focus(); key(author()!, "z", { ctrlKey: true });
    await until(() => attachmentList.querySelectorAll(".file-row").length === 3, "restore cleared attachments");
    button(attachmentList, "添加文件").click();
    const extra = await until(() => button(attachmentList, "extra.txt"), "add attachment from the picker");
    const extraBox = extra.getBoundingClientRect();
    extra.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: extraBox.left, clientY: extraBox.top }));
    const external = await until(() => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(item => item.textContent?.includes("系统")), "open attachment externally");
    external.click();
    await until(() => !external.isConnected, "external action completed");
    const search = el<HTMLInputElement>(library + ".library-toolbar input")!;
    input(search, "not-an-imported-title");
    await until(() => el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "1", "filtered-out import");
    const modulePath = "/components/Knowledge/library-import.svelte.ts";
    const { importedPages } = await import(modulePath) as typeof import("../../renderer/components/Knowledge/library-import.svelte");
    const tabId = search.closest<HTMLElement>("[data-tabs-content]")!.dataset.value!;
    importedPages.set(tabId, [keep, gone]);
    await until(() => !importedPages.has(tabId) && info()?.dataset.historyPage === keep, "select surviving imported row");
    if (search.value !== "not-an-imported-title" || el(library + "[aria-selected=true]")?.dataset.pageId !== keep) throw Error("Import changed the current search or selected a recycled page");
    input(search, "");
    await until(() => el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "5002", "search cleared");
    const clipped = [...document.querySelectorAll<HTMLElement>(library + "[role=gridcell] .cell-label")].find(label => label.scrollWidth > label.clientWidth);
    if (!clipped) throw Error("Missing clipped cell");
    clipped.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await until(() => [...document.querySelectorAll<HTMLElement>(".ui-tooltip")].some(tip => tip.textContent?.trim() === clipped.textContent?.trim()), "full cell tooltip");
    el(library + "[role=grid]")!.dispatchEvent(new PointerEvent("pointerleave"));
    await window.api.settings.update({ appearance: { ...(await window.api.settings.get()).settings.appearance, theme: "dark", language: "en" } });
    await until(() => document.documentElement.dataset.theme === "dark" && document.documentElement.lang === "en", "dark theme");
    await wait(250);
    console.log("LIBRARY CAPTURE dark");
    await wait(500);
    await window.api.settings.update({ appearance: { ...(await window.api.settings.get()).settings.appearance, theme: "light", language: "zh-CN" } });
    await until(() => document.documentElement.dataset.theme === "light" && document.documentElement.lang === "zh-CN", "light theme");
    await wait(250);
    console.log("LIBRARY CAPTURE light");
    await wait(500);
    const openPDF = [...info()!.querySelectorAll<HTMLButtonElement>(".library-attachments button")].filter(b => b.textContent?.trim().endsWith(".pdf")).at(-1)!;
    const pageFiles = await window.api.papers.files((await window.api.pages.get(target.dataset.pageId!)).attributes.paper_files as string[]);
    const chosenFile = pageFiles.filter(file => file.mediaType === "application/pdf").at(-1)!;
    openPDF.click();
    await until(() => [...document.querySelectorAll<HTMLElement>(".paper-panel .toolbar .ui-select")].some(s => s.textContent?.includes(chosenFile.originalName)), "open chosen PDF in a new page tab");
    if (!(await window.api.pages.get(id)).attributes.paper_authors) throw Error("Missing saved edit");

    const note = await window.api.pages.create({ kind: "workspace" }, "Unrelated recycled note");
    const removeNotePage = await window.api.pages.trash([note.id], { kind: "workspace" });
    if (removeNotePage.status !== "confirmation") throw Error("Missing note preview");
    await window.api.pages.trash([note.id], { kind: "workspace" }, removeNotePage.preview.token);
    el(".activity [data-icon=book]")!.closest("button")!.click();
    const actions = await until(() => el<HTMLButtonElement>(".group-header.focused [data-tab-actions]"), "table tab actions");
    actions.click();
    const openTrash = await until(() => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(item => item.textContent?.trim() === "打开回收站"), "trash destination");
    openTrash.click();
    library = "[data-tabs-content]:not([hidden]) [data-table-view=trash] ";
    const purge = await until(() => button(el(library + ".library-toolbar")!, "清空回收站"), "clear trash");
    await until(() => !purge.disabled && el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "3", "trash includes all page kinds");
    if (el(library + "[data-table-filters]") || el(library + "[data-table-create]")) throw Error("Trash exposes table editing controls");
    const trashSearch = el<HTMLInputElement>(library + ".library-toolbar input")!;
    input(trashSearch, note.title);
    await until(() => el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "2" && el(library + "[data-page-id]")?.dataset.pageId === note.id, "trash search");
    input(trashSearch, "");
    await until(() => el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "3", "clear trash search");
    (await until(row, "recycled paper")).click();
    const title = await until(() => info()?.closest("[data-history-page]")?.querySelector<HTMLInputElement>("input[readonly]"), "read-only trash inspector");
    if (!title.readOnly) throw Error("Trash inspector editable");
    key(sink(), "F2");
    if (el(library + "[data-cell-editor]")) throw Error("Trash cell editable");
    key(sink(), "Delete");
    const confirmation = await until(() => el(":popover-open [role=alertdialog]"), "permanent deletion confirmation");
    if (!confirmation.textContent?.includes("1个页面") || confirmation.textContent.includes(note.title)) throw Error("Incorrect selected deletion scope");
    confirmation.querySelectorAll<HTMLButtonElement>(".ui-dialog-actions button")[1].click();
    await until(() => el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "2", "one page remains in the trash");
    (await until(() => el(library + "[data-page-id]"), "recycled note")).click();
    key(sink(), "Enter", { ctrlKey: true, shiftKey: true });
    await until(() => purge.disabled && el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "1", "restore from trash");
    if ((await window.api.pages.get(note.id)).attributes.deleted) throw Error("Restore left the note recycled");

    if (!bulkPapers) {
        library = "[data-tabs-content]:not([hidden]) [data-table-view=papers] ";
        el(".activity [data-icon=book]")!.closest("button")!.click();
        const grid = await until(() => el(library + "[role=grid][aria-busy=false]"), "reopened papers");
        const papersId = grid.closest<HTMLElement>("[data-tabs-content]")!.dataset.value!;
        const climate = (await window.api.attributes.definitions()).find(def => def.id === "tags")!.metadata.options!.find(option => option.name === "Climate")!.id;
        setViewParams(papersId, { query: { conditions: [{ field: { kind: "attribute", id: "tags" }, operator: "any", values: [climate] }], sort: [] } });
        await until(() => el(library + "[role=grid][aria-busy=false]") && el(library + "[data-table-filter-chip]"), "filtered papers for creation");
        const create = el<HTMLButtonElement>(library + "[data-table-create]")!;
        create.click();
        const title = await until(() => el<HTMLInputElement>(library + "[data-cell-editor] input"), "new paper title");
        const createdId = title.closest<HTMLElement>("[data-page-id]")!.dataset.pageId!;
        key(title, "Escape");
        await until(() => !create.disabled, "new paper written");
        const created = await window.api.pages.get(createdId);
        if (created.kind !== "paper" || !(created.attributes.tags as string[]).includes(climate)) throw Error("Paper creation lost its fixed kind or user condition");
        return null;
    }
    const source = { kind: "workspace" } as const;
    const bulkTrash = await window.api.pages.trash(bulkPapers, source);
    if (bulkTrash.status !== "confirmation" || bulkTrash.preview.direct.length !== 5000 || bulkTrash.preview.recycled.length !== 1000) {
        throw Error("Expected 5000 papers and 1000 dependent annotations");
    }
    if ((await window.api.pages.trash(bulkPapers, source, bulkTrash.preview.token)).status !== "saved") {
        throw Error("Could not move the benchmark papers to the recycle bin");
    }
    await until(() => !purge.disabled && el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "6001", "bulk recycle results");
    const start = performance.now();
    purge.click();
    const preview = await until(() => el(":popover-open [role=alertdialog]"), "bulk permanent deletion confirmation");
    await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const elapsed = performance.now() - start, message = preview.textContent ?? "";
    if (!message.includes("6000个页面") || !preview.querySelector("[role=listitem][aria-setsize=\"6000\"]") || message.includes(note.title)) {
        throw Error("Incorrect bulk purge confirmation scope");
    }
    preview.querySelector("button")!.click();
    return +elapsed.toFixed(1);
}