import type { Editor } from "@tiptap/core";

export async function checkEditing(ids: { large: string; origin: string; geometry: string }): Promise<Record<string, number>> {
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    const paint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    function assert(value: unknown, message: string): asserts value {
        if (!value) throw new Error(message);
    }
    async function until<T>(read: () => T, message: string): Promise<NonNullable<T>> {
        const limit = performance.now() + 10000;
        for (;;) {
            const value = read();
            if (value) return value;
            if (performance.now() > limit) throw new Error(message);
            await wait(5);
        }
    }
    async function open(id: string): Promise<Editor> {
        (await until(() => document.querySelector<HTMLElement>(`[data-panel-key$="${id}"]`), "Missing pinned page")).click();
        return until(() => {
            const dom = document.querySelector<HTMLElement & { editor: Editor }>("[data-tabs-content]:not([hidden]) .tiptap");
            return dom?.isContentEditable && dom.editor?.state.doc.firstChild?.textContent === (id === ids.large ? "Large page" : id === ids.geometry ? "Drag checks" : "Picker checks") && dom.editor;
        }, "Editor did not mount");
    }
    const ed = await open(ids.large), dom = ed.view.dom;
    const at = ed.state.doc.firstChild!.nodeSize + 2;
    ed.commands.setTextSelection(at);
    ed.view.focus();
    assert(ed.state.doc.childCount === 10000 && getComputedStyle(dom).outlineStyle === "none", "Unexpected page size or keyboard focus outline");
    const menu = (): HTMLElement | null => document.querySelector(".suggestion-menu:popover-open");
    const press = (key: string): void => {
        dom.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    };
    const times: number[] = [], filters: number[] = [];
    for (let i = 0; i <= 24; i++) {
        ed.commands.setTextSelection(at);
        for (const [n, char] of Array.from("/code").entries()) {
            const start = performance.now();
            document.execCommand("insertText", false, char);
            await until(() => menu() && (n ? menu()!.innerText.includes("代码") || menu()!.innerText.includes("Code") : menu()!.querySelectorAll("button").length >= 12), "Slash results missing for " + char);
            await paint();
            if (i) (n ? filters : times).push(performance.now() - start);
        }
        assert(ed.view.hasFocus() && menu()?.querySelectorAll("button").length === 1, "Slash filtering lost focus or matched wrong block");
        press("Escape");
        assert(ed.state.doc.textBetween(at, at + 5) === "/code", "Escape erased the command");
        ed.view.dispatch(ed.state.tr.delete(at, at + 5));
        await paint();
    }
    function p95(rows: number[]): number {
        return Number(rows.sort((a, b) => a - b)[Math.ceil(rows.length * .95) - 1].toFixed(2));
    }
    const metrics: Record<string, number> = { open: p95(times), filter: p95(filters) };
    console.info("CHECK slash " + JSON.stringify(metrics));
    const key = (target: HTMLElement, name: string, extra: KeyboardEventInit = {}): void => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra }));
    };
    const pane = dom.closest<HTMLElement>("[data-tabs-content]")!, root = dom.closest<HTMLElement>(".editor-canvas")!;
    const original = Element.prototype.setPointerCapture;
    // Synthetic DOM pointer events have no OS capture slot. Deliver captured events to their receiver explicitly.
    Element.prototype.setPointerCapture = function (id: number): void {
        if (id !== 991) original.call(this, id);
    };
    const mouse = (target: HTMLElement, event: string, x: number, y: number): boolean => {
        return target.dispatchEvent(new PointerEvent(event, { pointerId: 991, pointerType: "mouse", isPrimary: true, bubbles: true, cancelable: true,
            button: event === "pointermove" ? -1 : 0, buttons: event === "pointerup" ? 0 : 1, clientX: x, clientY: y }));
    };
    const frame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve));
    async function frames(input: (index: number) => void, overlay?: string): Promise<{ interval: number; work: number }> {
        const intervals: number[] = [], costs: number[] = [];
        const schedule = window.requestAnimationFrame;
        let last = await frame();
        for (let i = 0; i < 100; i++) {
            let cost = 0, callbacks = 0;
            // Count the input handler, the gesture callback it schedules, and its DOM flush.
            // Waiting for the display's next refresh is measured separately by the frame interval.
            window.requestAnimationFrame = callback => schedule.call(window, time => {
                const begin = performance.now();
                callback(time);
                queueMicrotask(() => {
                    if (overlay) root.querySelector(overlay)?.getBoundingClientRect();
                    cost += performance.now() - begin;
                    callbacks++;
                });
            });
            try {
                const begin = performance.now();
                input(i);
                cost += performance.now() - begin;
            }
            finally {
                window.requestAnimationFrame = schedule;
            }
            const next = await frame();
            if (i > 2) {
                if (overlay) assert(callbacks > 0, "Pointer frame was not processed");
                intervals.push(next - last);
                costs.push(cost);
            }
            last = next;
        }
        return { interval: p95(intervals), work: p95(costs) };
    }
    metrics.idleFrame = (await frames(() => {})).interval;
    try {
        const handleCosts: number[] = [];
        for (const anchor of [1, 4900, 9900]) {
            const sample = dom.children[anchor] as HTMLElement;
            sample.scrollIntoView({ block: "start" }); await paint();
            for (let i = 0; i < 60; i++) {
                const rect = dom.children[anchor + i % 16].getBoundingClientRect();
                const x = i % 2 ? rect.right + 14 : rect.left - 14;
                const started = performance.now();
                mouse(root, "pointermove", x, rect.top + (i % 3 ? 9 : -1));
                handleCosts.push(performance.now() - started);
                await frame();
            }
        }
        metrics.handle = p95(handleCosts);
        pane.scrollTop = 0; await paint();
        const block = ed.state.doc.child(1), title = ed.state.doc.firstChild!.nodeSize;
        let content = block.content;
        for (let i = 2; i <= 501; i++) content = content.addToEnd(ed.state.doc.child(i));
        const end = ed.state.doc.resolve(title).posAtIndex(502);
        ed.view.dispatch(ed.state.tr.replaceWith(title, end, block.copy(content)));
        await paint(); console.info("CHECK seeded subtree");
        const first = dom.children[1] as HTMLElement, body = first.querySelector<HTMLElement>("[data-body]")!;
        const box = body.getBoundingClientRect();
        mouse(body, "pointermove", box.left + 6, box.top + 8);
        const grip = await until(() => root.querySelector<HTMLElement>(".handle button"), "No block handle");
        const gripBox = grip.getBoundingClientRect(), x = gripBox.left + 8;
        mouse(grip, "pointerdown", x, gripBox.top + 8);
        mouse(root, "pointermove", x + 7, gripBox.top + 12);
        const ghost = await until(() => document.querySelector<HTMLElement>(".editor-drag-ghost:popover-open"), "Dragged subtree has no ghost");
        await paint();
        assert(ghost.inert && getComputedStyle(ghost).pointerEvents === "none" && ghost.hasAttribute("data-clipped") &&
            ghost.querySelector("[data-block-id] [data-block-id]") && getComputedStyle(ghost).maskImage !== "none", "Tall ghost lost its children, clipping or fade");
        const originalRow = dom.children[1];
        assert(Number(getComputedStyle(originalRow).opacity) <= .5 && ghost.getBoundingClientRect().height <= 200 &&
            Math.abs(ghost.getBoundingClientRect().left - originalRow.getBoundingClientRect().left - 7) < 1, "Drag origin or source opacity is incorrect");
        assert(getComputedStyle(root, "::after").cursor === "grabbing", "Unstable drag cursor");
        console.info("CHECK handle pressed");
        pane.scrollTop = pane.scrollHeight;
        await paint();
        const tail = dom.lastElementChild!.getBoundingClientRect();
        const y = Math.min(tail.bottom - 2, pane.getBoundingClientRect().bottom - 4);
        const drag = await frames(i => mouse(root, "pointermove", x, y - 70 - (i % 6) * 23), ".drop-line");
        metrics.dragFrame = drag.interval; metrics.dragWork = drag.work;
        assert(root.querySelector(".drop-line") && ghost === document.querySelector(".editor-drag-ghost") && dom.children[1].classList.contains("moving-block"), "No live drop indicator");
        mouse(root, "pointermove", x, y);
        await frame();
        console.info("CHECK drop geometry " + JSON.stringify({ y, tail: tail.toJSON(), pane: pane.getBoundingClientRect().toJSON(), drop: root.querySelector(".drop-line")?.getBoundingClientRect().toJSON() }));
        const startMove = performance.now();
        mouse(root, "pointerup", x, y);
        await until(() => ed.state.doc.lastChild!.attrs.blockId === block.attrs.blockId, "Subtree did not move to page end");
        await paint(); metrics.move = Number((performance.now() - startMove).toFixed(1));
        assert(!ghost.isConnected && !root.querySelector(".moving-block") && !root.dataset.gesture, "Ghost remained after drop");
        assert(ed.state.doc.lastChild!.childCount === 501, "Move lost descendants");
        pane.scrollTop = 0; await paint();
        const bounds = dom.getBoundingClientRect(), region = pane.getBoundingClientRect(), left = bounds.left - 12, top = region.top + 90;
        mouse(root, "pointerdown", left, top);
        console.info("CHECK marquee started");
        const marquee = await frames(i => mouse(root, "pointermove", left + 130, top + 100 + (i % 5) * 28), ".marquee");
        metrics.marqueeFrame = marquee.interval; metrics.marqueeWork = marquee.work;
        assert(root.querySelector(".marquee") && dom.querySelector(".range-single") && getComputedStyle(root, "::after").cursor === "crosshair", "Marquee selection did not draw");
        mouse(root, "pointerup", left + 130, top + 210);
        key(dom, "a", { ctrlKey: true, code: "KeyA" }); await paint();
        const startDelete = performance.now();
        key(dom, "Delete");
        await until(() => dom.children.length === 1, "Selected blocks did not delete");
        await paint(); metrics.delete = Number((performance.now() - startDelete).toFixed(1));
        console.info("CHECK blocks " + JSON.stringify(metrics));
    }
    finally {
        Element.prototype.setPointerCapture = original;
    }
    const small = await open(ids.origin), field = small.view.dom;
    const pos = small.state.doc.firstChild!.nodeSize + 2;
    small.commands.setTextSelection(pos); small.view.focus();
    const input = (value: string): void => {
        for (const char of value) document.execCommand("insertText", false, char);
    };
    input("# ");
    await until(() => small.state.doc.child(1).attrs.kind === "heading_1", "Heading input did not convert");
    key(field, "Backspace");
    assert(small.state.doc.child(1).firstChild!.textContent.startsWith("# "), "Backspace did not restore literal");
    small.view.dispatch(small.state.tr.delete(pos, pos + 2));
    small.commands.setTextSelection(pos); input("## ");
    await until(() => small.state.doc.child(1).attrs.kind === "heading_2", "Second heading input failed");
    key(field, "z", { ctrlKey: true, code: "KeyZ" });
    await until(() => small.state.doc.child(1).attrs.kind === "paragraph" && small.state.doc.child(1).textContent.startsWith("## "), "Page undo did not preserve marker");
    console.info("CHECK conversion history");
    small.commands.setTextSelection(pos);
    input("[[");
    const picker = await until(() => document.querySelector<HTMLInputElement>(".target-picker input"), "Brackets did not open target picker");
    key(picker, "Escape");
    await until(() => !document.querySelector(".target-picker"), "Brackets picker did not close");
    assert(small.state.doc.child(1).textContent.startsWith("[["), "Cancel erased brackets");
    await paint();
    const canvas = field.closest<HTMLElement>(".editor-canvas")!, column = field.getBoundingClientRect();
    const beforeCount = small.state.doc.childCount, paragraph = field.querySelector<HTMLElement>(":scope > [data-kind=paragraph]")!.getBoundingClientRect();
    Element.prototype.setPointerCapture = function (id: number): void {
        if (id !== 991) original.call(this, id);
    };
    function clickMargin(x: number, y: number): void {
        mouse(canvas, "pointerdown", x, y); mouse(canvas, "pointerup", x, y);
    }
    try {
        assert(getComputedStyle(canvas).cursor === "text" && getComputedStyle(field.querySelector("summary")!).cursor === "pointer", "Blank space or backlink cursor is incorrect");
        clickMargin(column.left - 20, paragraph.top + 5); assert(small.state.selection.head === pos, "Left margin missed the line start");
        clickMargin(column.right + 20, paragraph.top + 5); assert(small.state.selection.$head.parentOffset === small.state.doc.child(1).firstChild!.content.size, "Right margin missed the line end");
        const title = field.children[0].getBoundingClientRect();
        clickMargin(column.left - 20, title.top + 3); assert(small.state.selection.head === 1, "Title margin missed");
        const bottom = field.closest<HTMLElement>("[data-tabs-content]")!.getBoundingClientRect().bottom - 12;
        clickMargin(column.right + 10, bottom); clickMargin(column.right + 10, bottom);
        assert(small.state.doc.childCount === beforeCount + 1 && small.state.doc.lastChild!.textContent === "", "Bottom margin did not reuse its empty paragraph");
    }
    finally {
        Element.prototype.setPointerCapture = original;
    }
    await paint();
    input("/"); await until(() => menu(), "Slash did not open on the bottom paragraph");
    input("h"); await paint(); input("1");
    await until(() => menu()?.querySelectorAll("button").length === 1, "Heading alias missing");
    key(field, "Enter");
    assert(small.state.doc.lastChild!.attrs.kind === "heading_1", "Slash did not convert the empty block");
    async function slashChoice(query: string): Promise<void> {
        input("/"); await until(() => menu(), "Slash did not open in a heading");
        for (const char of query) {
            input(char); await paint();
        }
        await until(() => menu()?.querySelectorAll("button").length === 1, "Unexpected slash match");
        key(field, "Enter"); await paint();
    }
    for (const level of [2, 3, 1]) {
        const id = small.state.doc.lastChild!.attrs.blockId;
        await slashChoice("h" + level);
        assert(small.state.doc.lastChild!.attrs.kind === "heading_" + level && small.state.doc.lastChild!.attrs.blockId === id, "Empty heading did not convert in place");
    }
    input("Keep "); await paint(); await slashChoice("h2");
    const previousHeading = small.state.doc.child(small.state.doc.childCount - 2);
    assert(previousHeading.textContent === "Keep " && previousHeading.attrs.kind === "heading_1" && small.state.doc.lastChild!.attrs.kind === "heading_2", "Nonempty heading did not insert a sibling");
    key(field, "Backspace"); assert(small.state.doc.lastChild!.attrs.kind === "paragraph", "Heading start did not unwrap");
    small.commands.setTextSelection(pos);
    key(field, "Escape"); key(field, "ArrowDown", { shiftKey: true }); await paint();
    const clipboard = new DataTransfer();
    field.dispatchEvent(new ClipboardEvent("copy", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    assert(JSON.parse(clipboard.getData("application/x-labloom-blocks")).slice.content.length === 2, "Multiblock clipboard did not contain both rows");
    key(field, "Escape");
    const parent = small.state.doc.child(1), child = small.state.doc.lastChild!;
    const nested = parent.copy(parent.content.addToEnd(child));
    small.view.dispatch(small.state.tr.replaceWith(pos - 2, small.state.doc.content.size, nested));
    small.commands.setTextSelection(pos); key(field, "Enter", { ctrlKey: true });
    await until(() => field.querySelector("[data-folded]"), "Keyboard folding failed");
    assert(getComputedStyle(field.querySelector<HTMLElement>("[data-folded] > [data-block-id]")!).display === "none", "Folded child still visible");
    key(field, "Enter", { ctrlKey: true });
    console.info("CHECK margins, whole-block clipboard and fold");
    async function checkDragGeometry(): Promise<void> {
        const sample = await open(ids.geometry), field = sample.view.dom;
        const canvas = field.closest<HTMLElement>(".editor-canvas")!, pos = sample.state.doc.firstChild!.nodeSize + 2;
        const [A, C, D, E, F] = sample.state.doc.content.content.slice(1), B = A.lastChild!;
        const element = (id: string): HTMLElement => field.querySelector<HTMLElement>(`[data-block-id="${id}"]`)!;
        const boxOf = (node: typeof A): DOMRect => element(node.attrs.blockId).firstElementChild!.getBoundingClientRect();
        const center = (box: DOMRect): number => (box.top + box.bottom) / 2;
        const handle = (): HTMLElement | null => canvas.querySelector(".handle");
        const hoverAt = async (x: number, y: number, expected?: typeof A): Promise<void> => {
            mouse(canvas, "pointermove", x, y); await paint();
            if (expected) assert(handle() && Math.abs(center(handle()!.getBoundingClientRect()) - center(boxOf(expected))) <= 1, "Handle on wrong row for " + expected.firstChild!.textContent);
            else assert(!handle(), "Unexpected handle on title, backlinks or bottom padding");
        };
        await paint();
        const outer = boxOf(A).left - 22, edge = boxOf(C).right + 30;
        await hoverAt(outer, center(field.children[0].getBoundingClientRect()));
        const backlink = field.querySelector<HTMLElement>(".editor-backlinks")!;
        await hoverAt(edge, center(backlink.getBoundingClientRect()));
        await hoverAt(outer, center(boxOf(A)), A);
        await hoverAt(boxOf(B).left - 4, center(boxOf(B)), B);
        await hoverAt(edge, center(boxOf(B)), B);
        const divide = (boxOf(B).bottom + element(C.attrs.blockId).getBoundingClientRect().top) / 2;
        const textColumnX = boxOf(C).right - 12;
        for (const y of [divide, center(boxOf(C))]) {
            const hit = document.elementFromPoint(textColumnX, y);
            assert(hit instanceof HTMLElement && field.contains(hit), "Missing text column hit");
            assert(mouse(hit, "pointerdown", textColumnX, y), "Block gap or trailing line space intercepted text selection");
            mouse(hit, "pointerup", textColumnX, y);
        }
        await hoverAt(outer, divide - 1, B); await hoverAt(edge, divide + 1, C);
        sample.commands.setTextSelection(pos); key(field, "Enter", { ctrlKey: true }); await paint();
        await hoverAt(outer, center(boxOf(A)), A);
        await hoverAt(edge, center(boxOf(C)), C);
        key(field, "Enter", { ctrlKey: true }); await paint();
        await hoverAt(edge, boxOf(F).bottom + 15);
        const startC = pos - 2 + A.nodeSize;
        sample.commands.setTextSelection(startC + 2);
        key(field, "Escape"); key(field, "ArrowDown", { shiftKey: true });
        await hoverAt(edge, center(boxOf(D)), D);
        const button = handle()!.querySelector("button")!, gripper = button.getBoundingClientRect();
        const grab = { x: gripper.left + 8, y: center(gripper) };
        Element.prototype.setPointerCapture = function (id: number): void {
            if (id !== 991) original.call(this, id);
        };
        try {
            mouse(button, "pointerdown", grab.x, grab.y);
            async function line(x: number, y: number): Promise<DOMRect> {
                mouse(canvas, "pointermove", x, y); await frame(); await paint();
                return (await until(() => canvas.querySelector<HTMLElement>(".drop-line"), "Missing drop line")).getBoundingClientRect();
            }
            const titleGap = (backlink.getBoundingClientRect().bottom + element(A.attrs.blockId).getBoundingClientRect().top) / 2;
            assert(Math.abs(center(await line(grab.x, field.children[0].getBoundingClientRect().bottom - 1)) - titleGap) <= 1 &&
                Math.abs(center(await line(grab.x, boxOf(A).top + 1)) - titleGap) <= 1, "Duplicate indicator below title");
            const mid = (boxOf(E).bottom + boxOf(F).top) / 2;
            const upper = await line(grab.x, boxOf(E).bottom - 2), lower = await line(grab.x, boxOf(F).top + 2);
            const indent = parseFloat(getComputedStyle(canvas).getPropertyValue("--ui-editor-indent"));
            const nested = await line(grab.x + indent, boxOf(F).top + 2);
            assert(Math.abs(center(upper) - mid) < 1 && upper.top === lower.top && nested.top === lower.top &&
                nested.left > lower.left && Math.abs(nested.right - field.getBoundingClientRect().right) < 1, "Drop seam or column edge changed with depth");
            const ghost = document.querySelector<HTMLElement>(".editor-drag-ghost")!;
            assert(ghost.children.length === 2 && ghost.children[0].textContent === "C" && ghost.children[1].textContent === "D" &&
                Number(getComputedStyle(element(D.attrs.blockId)).opacity) < .5, "Selected source or multi-block ghost missing");
            for (const theme of ["light", "dark"] as const) {
                const saved = (await window.api.settings.get()).settings.appearance;
                await window.api.settings.update({ appearance: { ...saved, theme } });
                await until(() => document.documentElement.dataset.theme === theme, "Drag theme failed");
                await wait(220); await paint(); console.info("CHECK drag " + theme); await wait(250);
            }
            assert(Math.abs(center(await line(grab.x, boxOf(F).bottom + 4)) - boxOf(F).bottom) < 1, "Duplicate indicator after last block");
            key(field, "Escape"); await paint();
            assert(!ghost.isConnected && !canvas.querySelector(".moving-block,.drop-line") && !canvas.dataset.gesture, "Escape did not clear gesture");
        }
        finally {
            Element.prototype.setPointerCapture = original;
        }
    }
    await checkDragGeometry();
    await open(ids.origin); small.view.focus();
    console.info("CHECK heading insertion, nested handles, single drop seams and selected drag ghost");
    const language = "typescript", lines = Array.from({ length: 2000 }, (_, i) => `const value${i}: number = ${i};`).join("\n");
    const code = small.state.schema.nodes.codeBlock.create({ blockId: small.state.doc.child(1).attrs.blockId, language },
        lines.split("\n").map(line => small.state.schema.nodes.codeLine.create(null, small.state.schema.text(line))));
    small.view.dispatch(small.state.tr.replaceWith(pos - 2, pos - 2 + small.state.doc.child(1).nodeSize, code));
    small.commands.setTextSelection(pos + 11); small.view.focus();
    await until(() => field.querySelector(".syntax-keyword"), "TypeScript highlighting did not load");
    const codeTimes: number[] = [], typing: number[] = [];
    for (let i = 0; i < 61; i++) {
        if (i === 21 || i === 41) {
            const line = i === 21 ? 1000 : 1999;
            const offset = small.state.doc.child(1).content.content.slice(0, line).reduce((total, value) => total + value.nodeSize, 0);
            small.commands.setTextSelection(pos + offset + 11);
            small.view.dispatch(small.state.tr.scrollIntoView()); await wait(100); await paint();
        }
        const start = performance.now(), current = small.state.selection.head;
        const updated = new Promise<void>(resolve => {
            const done = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }): void => {
                if (!transaction.getMeta("codeSyntax$")) return;
                small.off("transaction", done); resolve();
            };
            small.on("transaction", done);
        });
        document.execCommand("insertText", false, "x");
        await until(() => small.state.selection.head === current + 1,
            "Code input lost a character at trial " + i + " head " + small.state.selection.head + " expected " + (current + 1) + " active " + document.activeElement?.className);
        const entered = performance.now() - start;
        await Promise.race([updated, wait(4000).then(() => {
            throw new Error("Highlight did not update");
        })]);
        await paint();
        if (i) {
            codeTimes.push(performance.now() - start);
            typing.push(entered);
        }
    }
    metrics.code = p95(codeTimes); metrics.typing = p95(typing);
    assert(small.state.doc.child(1).childCount === 2000 && small.state.doc.child(1).child(1998).textContent === "const value1998: number = 1998;", "Code lines changed during highlighting");
    small.commands.setTextSelection(pos + 3); small.view.dispatch(small.state.tr.scrollIntoView());
    field.closest<HTMLElement>("[data-tabs-content]")!.scrollTop = 0; await paint();
    key(field, "l", { ctrlKey: true, altKey: true, code: "KeyL" });
    const choose = await until(() => document.querySelector<HTMLInputElement>(".code-language-picker input"), "No keyboard language picker");
    choose.value = "Python"; choose.dispatchEvent(new Event("input", { bubbles: true })); await paint(); key(choose, "Enter");
    await until(() => small.state.doc.child(1).attrs.language === "python", "Language did not change");
    small.view.dispatch(small.state.tr.setNodeMarkup(pos - 2, undefined, { ...small.state.doc.child(1).attrs, language: "typescript" }));
    await until(() => field.querySelector(".syntax-keyword"), "Restored TypeScript");
    for (const theme of ["light", "dark"] as const) {
        const saved = (await window.api.settings.get()).settings.appearance;
        await window.api.settings.update({ appearance: { ...saved, theme } });
        await until(() => document.documentElement.dataset.theme === theme, "Theme failed");
        await paint();
        const token = await until(() => field.querySelector<HTMLElement>(".syntax-number"), "No visible themed number");
        const search = document.querySelector<HTMLElement>(".search-trigger")!;
        console.info("CHECK palette " + JSON.stringify({ theme, field: getComputedStyle(search).getPropertyValue("--ui-surface-input"), background: getComputedStyle(search).backgroundColor, number: getComputedStyle(token).color }));
        await until(() => getComputedStyle(search).backgroundColor === (theme === "dark" ? "rgb(49, 49, 49)" : "rgb(255, 255, 255)"), "Theme transition did not finish");
        await wait(200); await paint();
        console.info("CHECK theme " + theme);
        await wait(350);
        assert(getComputedStyle(token).color !== getComputedStyle(field).color, "No theme syntax contrast");
    }
    const firstLine = small.state.doc.child(1).firstChild!, second = pos + firstLine.nodeSize;
    small.commands.setTextSelection({ from: pos, to: second + 5 });
    const plain = new DataTransfer();
    field.dispatchEvent(new ClipboardEvent("copy", { clipboardData: plain, bubbles: true, cancelable: true }));
    assert(plain.getData("text/plain") === firstLine.textContent + "\nconst", "Code copy changed line breaks");
    small.commands.setTextSelection(pos); key(field, "Tab"); key(field, "Tab", { shiftKey: true });
    assert(small.state.doc.child(1).firstChild!.textContent === firstLine.textContent, "Code outdent lost content");
    const paste = new DataTransfer(); paste.setData("text/plain", "one\ntwo\n");
    field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: paste, bubbles: true, cancelable: true }));
    assert(small.state.doc.child(1).childCount === 2002 && small.state.doc.child(1).firstChild!.textContent === "one", "Code paste split the workspace block");
    key(field, "Enter"); assert(small.state.doc.child(1).childCount === 2003, "Code Enter failed");
    small.commands.setTextSelection(pos - 2 + small.state.doc.child(1).nodeSize - 2);
    key(field, "ArrowDown");
    assert(small.state.selection.$head.parent.type.name === "blockBody", "ArrowDown did not leave the last code line");
    return metrics;
}