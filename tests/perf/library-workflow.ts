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
    const library = "[data-tabs-content]:not([hidden]) .library ";
    const row = (): HTMLElement | null => el(library + "[data-kind=paper]");
    const info = (): HTMLElement | null => el(library + "[data-history-page]");
    const author = (): HTMLTextAreaElement | null => info()?.querySelector("textarea[aria-label=作者]") ?? null;
    const key = (target: HTMLElement, value: string, options: KeyboardEventInit = {}): void => {
        target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value, ...options }));
    };
    const input = (node: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
        node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const button = (scope: ParentNode, text: string): HTMLButtonElement => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text)!;
    el(".activity [data-icon=book]")!.closest("button")!.click();
    (await until(row, "paper results")).click();
    if (el(library + ".library-toolbar [aria-pressed]")?.getAttribute("aria-pressed") !== "false" || el(library + ".library-status")?.textContent?.includes("文献")) throw Error("Built-in paper type is shown as a filter");
    const field = await until(author, "paper properties"), id = info()!.dataset.historyPage!, old = field.value;
    field.focus(); input(field, "Library workflow A");
    await until(() => row()?.innerText.includes("Library workflow A"), "table updated by inspector");
    key(field, "z", { ctrlKey: true });
    await until(() => author()?.value === old, "inspector undo");
    key(field, "y", { ctrlKey: true });
    await until(() => author()?.value === "Library workflow A", "inspector redo");
    const sink = (): HTMLElement => el(library + "[data-library-keyboard]")!;
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
    const tagQuery = await until(() => el<HTMLInputElement>(".filters input[type=search]"), "tag filter");
    input(tagQuery, "Climate");
    const tag = await until(() => [...document.querySelectorAll<HTMLElement>(".filters [role=checkbox]")].find(item => item.textContent?.trim() === "Climate"), "tag option");
    tag.click(); key(tag, "Escape");
    await until(() => Number(el(library + "[role=grid]")?.getAttribute("aria-rowcount")) < 5001 && button(el(library + ".library-status")!, "Climate"), "filtered total");
    button(el(library + ".library-status")!, "Climate").click();
    await until(() => el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "5001", "remove filter");
    const importButton = await until(() => button(toolbar, "导入 PDF"), "import PDF button");
    importButton.click();
    await until(() => el(library + "aside > [data-paragraph]")?.textContent?.includes("2"), "multiple PDF selection");
    await until(() => el(".notice.error details")?.textContent?.includes("broken.pdf"), "per-file failure");
    el(".notice.error button")?.click();
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
    let reads = 0;
    const observer = new MutationObserver(records => reads += records.filter(r => r.oldValue === "true").length);
    observer.observe(el(library + "[role=grid]")!, { attributes: true, attributeFilter: ["aria-busy"], attributeOldValue: true });
    importedPages.set(tabId, [keep, gone]);
    await until(() => !importedPages.has(tabId) && info()?.dataset.historyPage === keep, "missing import cleared after one read");
    await wait(250);
    observer.disconnect();
    if (reads !== 1 || el(library + "[aria-selected=true]")?.dataset.pageId !== keep) throw Error("Import reread count or surviving selection: " + reads);
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
    const scope = await until(() => el(library + ".library-toolbar .ui-select"), "library scope");
    scope.focus(); key(scope, "ArrowDown");
    await until(() => [...document.querySelectorAll<HTMLElement>("[role=option]")].find(o => o.textContent?.trim() === "回收站"), "recycle bin option");
    key(scope, "End"); key(scope, "Enter");
    const purge = await until(() => button(el(library + ".library-toolbar")!, "永久删除全部结果"), "purge filtered results");
    await until(() => !purge.disabled && el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "2", "only the recycled paper");
    purge.click();
    const confirmation = await until(() => el(".confirmation"), "filtered purge confirmation");
    if (!confirmation.textContent?.includes("1个页面") || confirmation.textContent.includes(note.title)) throw Error("Incorrect purge scope");
    confirmation.querySelectorAll("footer button")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await until(() => purge.disabled && el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "1", "empty filtered trash disabled");
    if (!(await window.api.pages.get(note.id)).attributes.deleted) throw Error("Unrelated recycled page lost");

    if (!bulkPapers) return null;
    const source = { kind: "workspace" } as const;
    const bulkTrash = await window.api.pages.trash(bulkPapers, source);
    if (bulkTrash.status !== "confirmation" || bulkTrash.preview.direct.length !== 5000 || bulkTrash.preview.recycled.length !== 1000) {
        throw Error("Expected 5000 papers and 1000 dependent annotations");
    }
    if ((await window.api.pages.trash(bulkPapers, source, bulkTrash.preview.token)).status !== "saved") {
        throw Error("Could not move the benchmark papers to the recycle bin");
    }
    await until(() => !purge.disabled && el(library + "[role=grid]")?.getAttribute("aria-rowcount") === "5001", "bulk recycle results");
    const start = performance.now();
    purge.click();
    const preview = await until(() => el(".confirmation"), "bulk permanent deletion confirmation");
    await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const elapsed = performance.now() - start, message = preview.textContent ?? "";
    if (!message.includes("6000个页面") || !message.includes("批注 00001") || !message.includes("Annotation 09991") || message.includes(note.title)) {
        throw Error("Incorrect bulk purge confirmation scope");
    }
    preview.querySelector("button")!.click();
    return +elapsed.toFixed(1);
}