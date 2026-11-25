import type { SavedTabs } from "../../shared/workspace/tabs";

/** Runs with the actual preload, page sessions and application controls. */
export async function readerWorkflow(paperId: string, fileId: string, dropNames: string[]): Promise<void> {
    const root = "[data-tabs-content]:not([hidden]) ";
    const find = <T extends HTMLElement = HTMLElement>(selector: string): T | null => selector.startsWith(root)
        ? [...document.querySelectorAll<T>(selector)].find(el => el.getClientRects().length > 0) ?? null
        : document.querySelector<T>(selector);
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    async function until<T>(read: () => T | false | null | undefined | Promise<T | false | null | undefined>, label: string): Promise<T> {
        const start = performance.now();
        for (;;) {
            const value = await read();
            if (value) return value;
            if (performance.now() - start > 8000) throw Error(label + ": " + document.body.innerText.slice(-350));
            await wait(16);
        }
    }
    const key = (el: HTMLElement, key: string, extra: KeyboardEventInit = {}): void => {
        el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
    };
    const tab = (value: string): HTMLElement => find(root + ".paper-sidebar-tabs-list [data-value=" + value + "]")!;
    const paper = (): ReturnType<typeof window.api.pages.get> => window.api.pages.get(paperId);
    const workspace = { kind: "workspace" as const }, source = { kind: "page" as const, id: paperId };
    const list = (): HTMLElement => find(root + ".annotation-list")!;
    const viewer = (): HTMLElement => find(root + ".paper-panel .viewer")!;
    const title = (): HTMLInputElement => find<HTMLInputElement>(root + ".paper-title input")!;
    const changeTitle = (value: string): void => {
        title().focus();
        title().select();
        if (!document.execCommand("insertText", false, value)) throw Error("Could not edit the title");
        title().blur();
    };
    const openMenu = (text: string): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>("[role^=menuitem]")]
        .find(item => item.textContent?.trim().startsWith(text));
    const confirm = async (): Promise<void> => {
        (await until(() => find(":popover-open [role=alertdialog] .ui-dialog-actions button:last-child"), "confirmation")).click();
    };
    const sidebar = (): HTMLElement | null => find(root + ".paper-sidebar");

    tab("info").click();
    const firstTitle = (await until(title, "title field")).value;
    changeTitle("Reader title A");
    await until(async () => (await paper()).title === "Reader title A", "saved title");
    title().focus();
    key(title(), "z", { ctrlKey: true });
    await until(() => title()?.value === firstTitle, "title undo");
    key(title(), "y", { ctrlKey: true });
    await until(() => title()?.value === "Reader title A", "title redo");

    const quoteRef = await window.api.pages.create(workspace, "Backlink to the reader", { links: [paperId] });
    await until(() => find(root + ".paper-info .editor-backlinks summary"), "backlink in info");
    find(root + ".paper-info .editor-backlinks summary")!.click();
    await until(() => find(root + ".paper-info .editor-backlinks button")?.textContent?.includes(quoteRef.title), "reference link title");

    const groupActions = await until(() => find<HTMLButtonElement>(".group-header [aria-label='More Editor Group Actions']"), "tab menu");
    groupActions.focus();
    key(groupActions, "ArrowDown");
    await until(() => openMenu("Move to Recycle Bin"), "page menu open");
    if (openMenu("Properties")) throw Error("Duplicate properties menu item");
    key(document.activeElement as HTMLElement, "Escape");
    (await until(() => find(".group-header button[aria-label=Properties]"), "properties icon")).click();
    await until(() => !sidebar(), "closed sidebar from menu");
    viewer().focus();
    key(viewer(), "p", { ctrlKey: true, altKey: true });
    await until(sidebar, "open sidebar via shortcut");
    if (getComputedStyle(viewer()).outlineStyle !== "none") throw Error("A focused PDF has an outline");

    const sash = find(root + ".paper-sash [role=separator]")!;
    const width = sidebar()!.clientWidth;
    key(sash, "ArrowLeft");
    await until(() => sidebar()?.clientWidth === width + 1, "sidebar resize");

    tab("annotations").click();
    await until(() => list()?.clientHeight && list().querySelector(".annotation-row"), "annotation list ready");
    await until(async () => {
        const saved = await window.api.workspace.loadTabs() as SavedTabs | null;
        const pageTab = saved?.groups.flatMap(group => group.tabs).find(item => item.view.type === "page" && item.view.params.page.id === paperId);
        return pageTab?.view.type === "page" && pageTab.view.params.showProperties === true &&
            pageTab.view.params.paperSidebar === "annotations" && pageTab.view.params.infoWidth === width + 1;
    }, "saved sidebar settings");
    list().scrollTop = 0;
    await until(() => list()?.querySelector(".annotation-row")?.getAttribute("data-page-number") === "1", "annotation list start");
    const first = list().querySelector<HTMLElement>(".annotation-row")!;
    first.click();
    await until(() => first.getAttribute("aria-selected") === "true", "selected first annotation");
    key(list(), "ArrowDown", { isComposing: true });
    if (first.getAttribute("aria-selected") !== "true") throw Error("IME changed annotation selection");
    key(list(), "ArrowDown");
    const row = await until(() => list()?.querySelector<HTMLElement>(".annotation-row[aria-selected=true]") !== first &&
        list().querySelector<HTMLElement>(".annotation-row[aria-selected=true]"), "selection by arrow");
    const annotation = row.dataset.annotationId!;
    await until(() => viewer().querySelector(`[data-highlight-id="${annotation}"][data-selected]`), "selection highlighted in PDF");
    const mark = await until(() => viewer().querySelector<HTMLElement>(`[data-highlight-id="${first.dataset.annotationId}"]`), "first highlight");
    mark.click();
    await until(() => first.getAttribute("aria-selected") === "true", "PDF selects annotation row");
    await until(() => find(".annotation-popover .tiptap"), "single click opens the annotation");
    find(".annotation-popover [aria-label=Close]")!.click();
    await until(() => !find(".annotation-popover"), "close the first annotation");

    row.click();
    await until(() => row.getAttribute("aria-selected") === "true", "reselect annotation for editing");
    key(list(), "Enter");
    const paragraph = await until(() => find<HTMLElement>(".annotation-popover .tiptap[contenteditable=true] [data-body]"), "inline annotation editor");
    const popup = paragraph.closest<HTMLElement>(".annotation-popover")!;
    const selectedMark = viewer().querySelector<HTMLElement>(`[data-highlight-id="${annotation}"][data-selected]`)!;
    const viewport = viewer().getBoundingClientRect(), anchor = selectedMark.getBoundingClientRect();
    if (anchor.bottom <= viewport.top || anchor.top >= viewport.bottom) throw Error("The list opened a note before scrolling to its highlight");
    paragraph.closest<HTMLElement>(".tiptap")!.focus();
    window.getSelection()?.collapse(paragraph, paragraph.childNodes.length);
    if (!document.execCommand("insertText", false, "Popup editor update")) throw Error("Could not type in annotation");
    await until(() => find(".annotation-popover .tiptap")?.textContent?.includes("Popup editor update"), "popup text input");
    popup.querySelector<HTMLElement>("[aria-label=\"Green highlight\"]")!.click();
    await until(async () => (await window.api.pages.get(annotation)).attributes.annotation_color === "green", "change color from note header");
    await wait(80);
    find(".annotation-popover [aria-label=Close]")!.click();
    await until(() => !find(".annotation-popover"), "close annotation editor");
    await until(async () => (await window.api.pages.get(annotation)).excerpt.includes("Popup editor update"), "popup annotation saved");
    await until(() => row.textContent?.includes("Popup editor update"), "annotation excerpt updates");

    key(list(), "F10", { shiftKey: true });
    const recolor = await until(() => openMenu("Change color"), "annotation context menu");
    key(recolor, "ArrowRight");
    (await until(() => openMenu("Pink"), "annotation colors")).click();
    await until(async () => (await window.api.pages.get(annotation)).attributes.annotation_color === "pink", "color saved");

    const paperTab = find(".tab.active [data-tabs-trigger]")!;
    key(list(), "Enter", { ctrlKey: true });
    const editor = await until(() => find<HTMLElement>(root + ".page-view .tiptap"), "opened annotation as a page");
    const noteBody = editor.querySelector<HTMLElement>("[data-body]")!;
    editor.focus();
    window.getSelection()?.collapse(noteBody, 0);
    document.execCommand("insertText", false, "Another tab. ");
    await until(async () => (await window.api.pages.get(annotation)).excerpt.includes("Another tab."), "standalone annotation saved");
    paperTab.click();
    await until(() => list()?.clientHeight && list().querySelector(`[data-annotation-id="${annotation}"]`)?.textContent?.includes("Another tab."), "live excerpt from another tab");

    list().focus();
    key(list(), "Enter");
    (await until(() => find<HTMLButtonElement>(".annotation-popover [aria-label='Delete']:not(:disabled)"), "delete in note header")).click();
    await confirm();
    await until(async () => (await window.api.pages.get(annotation)).attributes.deleted, "annotation deletion");
    await until(() => !find(".annotation-popover"), "deleted note closed");

    const position = await until(async () => {
        const saved = (await paper()).attributes.reading_position as Record<string, { page: number }> | null;
        return saved?.[fileId]?.page === 1 && saved[fileId];
    }, "reading position");
    if (position.page !== 1) throw Error("PDF did not restore the selected page");

    const transfer = new DataTransfer();
    for (const file of find<HTMLInputElement>("#reader-drop-fixture")!.files!) transfer.items.add(file);
    if (Array.from(transfer.files, file => file.name).join(",") !== dropNames.join(",")) throw Error("Drop fixture unavailable");
    const drop = find(root + ".pdf-area")!;
    drop.dispatchEvent(new DragEvent("dragover", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    if (!drop.classList.contains("dropping")) {
        await until(() => drop.classList.contains("dropping"), "drag highlight");
    }
    drop.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    await until(async () => ((await paper()).attributes.paper_files as string[]).length === 3, "two attachments in one drop");
    await until(() => find(":popover-open .toast.error")?.textContent?.includes("Broken.pdf"), "failed file reported");
    find(":popover-open .toast.error button")?.click();
    const select = await until(() => find(root + ".toolbar [aria-label='PDF file']"), "PDF selector in toolbar");
    select.focus();
    key(select, "ArrowDown");
    await until(() => [...document.querySelectorAll<HTMLElement>("[role=option]")].find(option => option.textContent?.trim() === "Other.pdf"), "other PDF option");
    key(select, "End");
    key(select, "Enter");
    await until(() => select.textContent?.includes("Other.pdf"), "switched PDF");
    await until(() => list()?.textContent?.trim() === "No annotations", "annotation list scoped to current PDF");
    select.focus();
    key(select, "ArrowDown");
    await until(() => [...document.querySelectorAll<HTMLElement>("[role=option]")].find(option => option.textContent?.trim() === "Reader benchmark.pdf"), "original PDF option");
    key(select, "Home");
    key(select, "Enter");
    await until(() => list()?.querySelector("[data-annotation-id]"), "switch back to first PDF");
    await until(() => viewer().querySelector(".page[data-page-number='1'] .canvasWrapper canvas"), "render original PDF again");

    const firstFixture = "23400000-0000-4000-8000-00000000000a";
    const outside = await window.api.pages.create(workspace, "Retains the first annotation", { links: [firstFixture] });
    const privateText = "23400000-0000-4000-8000-000000000013";
    tab("info").click();
    await until(() => title()?.getClientRects().length && title(), "focused title before recycling");
    title().focus();
    title().select();
    document.execCommand("insertText", false, "Draft before recycling");
    const sessionsPath = "/components/Knowledge/page-sessions.ts";
    const { write } = await import(sessionsPath) as typeof import("../../renderer/components/Knowledge/page-sessions");
    if (document.activeElement !== title() || title().value !== "Draft before recycling") throw Error("Draft field not active");
    const trash = await write(() => window.api.pages.trash([paperId], workspace));
    if ((await paper()).title !== "Draft before recycling") throw Error("Workspace flush lost draft, field=" + title().value + " stored=" + (await paper()).title);
    if (trash.status !== "confirmation") throw Error("Paper trash preview missing");
    await write(() => window.api.pages.trash([paperId], workspace, trash.preview.token));
    tab("annotations").click();
    await until(() => find(root + ".page-status") && list().querySelector(".annotation-row") && viewer().querySelector("canvas"), "recycled paper remains readable");
    tab("info").click();
    await until(() => title()?.readOnly, "recycled title is read-only");
    tab("annotations").click();
    (await until(() => list()?.clientHeight && list(), "visible recycled annotation list")).scrollTop = 0;
    const lockedRow = await until(() => list()?.querySelector<HTMLElement>("[data-annotation-id=\"" + firstFixture + "\"]"), "kept annotation row");
    lockedRow.click();
    key(list(), "Delete");
    if (find(":popover-open [role=alertdialog]")) throw Error("Deletion prompt opened in trash");
    key(list(), "Enter");
    const readonly = await until(() => find<HTMLElement>(".annotation-popover .tiptap[contenteditable=false] [data-body]"), "read-only popup");
    const range = document.createRange();
    range.selectNodeContents(readonly);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    if (!window.getSelection()?.toString().includes("sampling conditions")) throw Error("Read-only annotation text is not selectable: body=" + readonly.textContent + ", selection=" + window.getSelection()?.toString() + ", user-select=" + getComputedStyle(readonly).userSelect);
    if (document.execCommand("insertText", false, "Disallowed")) throw Error("Read-only annotation accepted editing");
    find(".annotation-popover [aria-label=Close]")!.click();
    await until(() => !find(".annotation-popover"), "close readonly popup");
    const keptMark = await until(() => viewer().querySelector<HTMLElement>("[data-highlight-id=\"" + firstFixture + "\"]"), "highlight after recycling");
    keptMark.click();
    await until(() => find(".annotation-popover .tiptap[contenteditable=false]"), "read-only PDF popup from highlight");
    const actions = [...document.querySelectorAll<HTMLButtonElement>(".annotation-popover .swatch-button, .annotation-popover [aria-label='Delete']")];
    if (actions.length !== 5 || actions.some(button => !button.disabled)) throw Error("Read-only PDF popup enabled annotation changes");
    find(".annotation-popover [aria-label=Close]")!.click();
    await until(() => !find(".annotation-popover"), "close note from highlight");
    const rowBounds = lockedRow.getBoundingClientRect();
    lockedRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rowBounds.left + 4, clientY: rowBounds.top + 2 }));
    const openKept = await until(() => openMenu("Open in tab"), "read-only context menu");
    if (openKept.hasAttribute("data-disabled") || !openMenu("Change color")?.hasAttribute("data-disabled") ||
        !openMenu("Delete")?.hasAttribute("data-disabled")) throw Error("Incorrect read-only context actions");
    openKept.click();
    await until(() => find(root + ".tiptap[contenteditable=true]"), "retained annotation is writable in a separate tab");
    (await until(() => find(".group-header button[aria-label=Properties]"), "annotation properties icon")).click();
    const original = await until(() => [...document.querySelectorAll<HTMLElement>(root + ".property button")].find(button => button.textContent?.includes("in the recycle bin")), "recycled original linked");
    original.click();
    await until(() => find(root + ".paper-panel .viewer"), "open recycled original through its properties link");
    await until(() => list()?.clientHeight, "back to recycled paper");
    const lostRow = await until(() => list()?.querySelector<HTMLElement>("[data-annotation-id=\"" + privateText + "\"]"), "dependent note row");
    lostRow.click();
    lostRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await until(() => find(".annotation-popover .tiptap[contenteditable=false]"), "double-click opens dependent note");
    find(".annotation-popover [aria-label=Close]")!.click();
    await until(() => !find(".annotation-popover"), "closed dependent note popup");
    key(list(), "Enter", { ctrlKey: true });
    await until(() => find(root + ".tiptap[contenteditable=false]") && find(root + ".page-status button"), "dependent annotation is read-only with restore in its tab");
    paperTab.click();
    await until(() => find(root + ".page-status button"), "restore paper button");
    await window.api.pages.restore([paperId], source);
    await until(() => !find(root + ".page-status button"), "paper restored");
    if (!(await window.api.pages.get(outside.id)).attributes.links?.includes(firstFixture)) throw Error("Retaining note changed");

    const navigation = "/components/layout/navigation.ts";
    const { openPage, openTarget } = await import(navigation) as typeof import("../../renderer/components/layout/navigation");
    const empty = await window.api.pages.create(workspace, "Reader with no PDF", {}, undefined, "paper");
    openPage(empty.id);
    const add = await until(() => [...document.querySelectorAll<HTMLButtonElement>(root + ".empty-pdf button")]
        .find(button => button.textContent?.trim() === "Add PDF"), "no PDF action");
    const emptyPanel = add.closest(".paper-panel")!;
    emptyPanel.querySelector<HTMLElement>(".paper-sidebar-tabs-list [data-value=\"annotations\"]")!.click();
    await until(() => emptyPanel.querySelector(".annotation-list")?.textContent?.trim() === "No annotations", "no annotations without a PDF");
    add.click();
    await until(() => emptyPanel.querySelector(".viewer .textLayer span"), "add PDF from the empty page");
    emptyPanel.querySelector<HTMLElement>(".paper-sidebar-tabs-list [data-value=\"info\"]")!.click();
    const closingTitle = await until(() => emptyPanel.querySelector<HTMLInputElement>(".paper-title input"), "title before closing reader");
    closingTitle.focus();
    closingTitle.select();
    document.execCommand("insertText", false, "Saved on close");
    key(closingTitle, "w", { ctrlKey: true });
    await until(async () => (await window.api.pages.get(empty.id)).title === "Saved on close", "save title when closing the tab");

    const attribute = "custom:" + crypto.randomUUID();
    await window.api.attributes.define(attribute, { id: attribute, name: "Preview PDF", type: "file", metadata: {} });
    const note = await window.api.pages.create(workspace, "Attachment preview", { [attribute]: null });
    const paths = await window.api.attachments.choose("file", false);
    const staged = await window.api.attachments.stagePaths(paths, false, true);
    const files = await window.api.papers.attachImported(staged.files.map(file => file.id), note.id, attribute, { kind: "page", id: note.id });
    if (files?.[0]?.originalName !== "Other.pdf") throw Error("Attachment note PDF import failed");
    openPage(note.id);
    const noteEditor = await until(() => [...document.querySelectorAll<HTMLElement>(root + ".page-view .tiptap[contenteditable=true]")]
        .find(element => element.getClientRects().length && element.textContent?.includes(note.title)), "note with attachment");
    noteEditor.focus();
    const noteView = noteEditor.closest(".page-view")!, noteGroup = noteEditor.closest("[data-group-id]")!;
    if (!noteView.querySelector("aside")) {
        (await until(() => noteGroup.querySelector<HTMLElement>(".group-header button[aria-label=Properties]"), "properties icon for attachment note")).click();
    }
    (await until(() => noteView.querySelector<HTMLElement>("aside .file-name"), "preview attachment button")).click();
    await until(() => find(".attachment-reader .textLayer span"), "attachment rendered in preview");
    const zoom = find(".attachment-reader [aria-label=Zoom]")!;
    zoom.focus();
    key(zoom, "ArrowDown");
    await until(() => find(".attachment-reader [role=listbox]"), "zoom menu inside preview dialog");
    key(zoom, "Escape");
    const preview = find(".attachment-reader .viewer")!;
    preview.focus();
    key(preview, "f", { ctrlKey: true });
    const search = find<HTMLInputElement>(".attachment-reader input[type=search]")!;
    if (document.activeElement !== search) throw Error("Find shortcut did not focus the PDF search box");
    document.execCommand("insertText", false, "HELLO");
    await until(() => find(".attachment-reader [aria-live=polite]")?.textContent === "1/1", "find text in preview");
    find(".attachment-reader header button")!.click();
    await until(() => !find(".attachment-reader[open]"), "close attachment preview");
    paperTab.click();
    await until(() => find(root + ".paper-panel .toolbar [aria-label='PDF file']"), "return to benchmark paper");

    const pageNumber = find<HTMLInputElement>(root + ".paper-panel [aria-label='Page number']")!;
    pageNumber.value = "42";
    pageNumber.dispatchEvent(new InputEvent("input", { bubbles: true }));
    key(pageNumber, "Enter");
    await until(async () => {
        const saved = (await paper()).attributes.reading_position as Record<string, { page: number }> | null;
        return saved?.[fileId]?.page === 42;
    }, "saved distant reading position");
    find(".tab.active .close-tab")!.click();
    await until(() => !find(root + ".paper-panel"), "closed reader before restoring its position");
    openPage(paperId);
    await until(() => find(root + ".paper-panel .page[data-page-number='42'] .textLayer span"), "reopened at saved reading position");
    const again = await window.api.pages.trash([paperId], workspace);
    if (again.status !== "confirmation") throw Error("Missing purge preparation");
    await window.api.pages.trash([paperId], workspace, again.preview.token);
    const purge = await window.api.pages.purge([paperId]);
    if (purge.status !== "confirmation") throw Error("Missing purge confirmation");
    await window.api.pages.purge([paperId], purge.token);
    openPage(firstFixture);
    const retained = await until(() => [...document.querySelectorAll<HTMLElement>(root + ".tiptap[contenteditable=true]")]
        .find(element => element.getClientRects().length && element.textContent?.includes("Check the sampling conditions")), "retained annotation after paper purge");
    retained.focus();
    key(retained, "p", { ctrlKey: true, altKey: true });
    const property = await until(() => [...document.querySelectorAll<HTMLElement>(root + ".property")].find(row => row.textContent?.includes("Original paper deleted")), "deleted original shown");
    if (property.querySelector("button")) throw Error("Deleted original still links to PDF");
    await openTarget({ kind: "page", id: paperId });
    await until(() => document.body.innerText.includes("Target has been deleted"), "cannot follow the permanently deleted page link");

    const created = await window.api.pages.create(workspace, "History in a recycled tab");
    openPage(created.id);
    async function historyKey(shortcut: string, deleted: boolean): Promise<void> {
        const editor = await until(() => [...document.querySelectorAll<HTMLElement>(root + `.tiptap[contenteditable=${!deleted}]`)]
            .find(element => element.getClientRects().length && element.textContent?.includes(created.title) &&
                (!deleted || !!element.closest(".page-view")?.querySelector(".page-status button:not(:disabled)"))), "history tab ready");
        editor.focus();
        key(editor, shortcut, { ctrlKey: true });
        await until(async () => (await window.api.pages.get(created.id)).attributes.deleted !== deleted, "history changed recycling");
    }
    await historyKey("z", false);
    await historyKey("y", true);
    const change = { pageId: created.id, batch: 0, blocks: [], attributes: { independent: false } };
    const pageSource = { kind: "page" as const, id: created.id };
    const independence = await window.api.pages.commitEdit(change, pageSource);
    if (independence.status !== "confirmation") throw Error("Missing independence change preview");
    await window.api.pages.commitEdit(change, pageSource, independence.preview.token);
    await historyKey("z", true);
    await historyKey("y", false);
}