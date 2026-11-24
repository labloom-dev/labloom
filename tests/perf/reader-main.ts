import { app, BrowserWindow, dialog, type WebContents } from "electron";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { registerIPCs } from "../../main/register";
import { attach } from "../../main/ui/windowFrame";
import * as settings from "../../main/settings/store";
import { session, startupServices } from "../support/session";
import { fixture } from "./fixture";
import { seedReader } from "./reader-fixture";
import { readerWorkflow } from "./reader-workflow";
import { knownCoordinatePdf } from "../fixtures/pdf-text";

const root = process.env.LABLOOM_TEST_ROOT!;
app.setPath("userData", join(root, "chromium"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.on("window-all-closed", () => { /* The benchmark controls its lifetime. */ });
const p95 = (values: number[]): number => +values.toSorted((a, b) => a - b)[Math.ceil(values.length * .95) - 1].toFixed(2);
const active = "[data-tabs-content]:not([hidden]) ";
const listSelector = active + ".annotation-list";
const viewerSelector = active + ".paper-panel .viewer";

// Measures the app after its initial page/module warm-up, with the real preload and IPC.
async function openings(): Promise<number[]> {
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    const paint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const find = (selector: string): HTMLElement | null => document.querySelector(selector);
    async function until(get: () => HTMLElement | null | undefined | boolean, label: string): Promise<void> {
        const deadline = performance.now() + 20_000;
        while (!get()) {
            if (performance.now() > deadline) throw Error(label + ": " + document.body.innerText.slice(-500));
            await wait(4);
        }
    }
    const pinned = (): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>("[data-panel-node=page]")]
        .find(node => node.innerText.includes("Reader benchmark"));
    const viewer = "[data-tabs-content]:not([hidden]) .paper-panel .viewer";
    const firstPage = viewer + " .page[data-page-number='1']";
    await until(pinned, "pinned paper");
    const results: number[] = [];
    for (let i = 0; i <= 10; i++) {
        const start = performance.now();
        pinned()!.click();
        await until(() => find(firstPage + " .canvasWrapper canvas") && find(firstPage + " .textLayer span"), "first PDF page rendered");
        await paint();
        if (i) results.push(+(performance.now() - start).toFixed(2));
        if (i < 10) {
            find(".tab.active .close-tab")!.click();
            await until(() => !find(viewer), "closed paper");
            await wait(100);
        }
    }
    return results;
}

async function annotationTiming(): Promise<{ tabs: number[]; jump: number; page: number }> {
    const paint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    const active = "[data-tabs-content]:not([hidden]) ";
    const list = (): HTMLElement => document.querySelector(active + ".annotation-list")!;
    const tabs = document.querySelector(active + ".paper-sidebar-tabs-list")!;
    const info = tabs.querySelector<HTMLElement>("[data-value=info]")!;
    const annotations = tabs.querySelector<HTMLElement>("[data-value=annotations]")!;
    async function until(get: () => unknown, label: string): Promise<void> {
        const deadline = performance.now() + 5000;
        while (!get()) {
            if (performance.now() > deadline) throw Error(label + ": " + document.body.innerText.slice(-500));
            await wait(3);
        }
    }
    if (document.querySelector(active + ".page-view .tiptap")) throw Error("A paper has a body editor");
    const durations: number[] = [];
    for (let i = 0; i < 10; i++) {
        const start = performance.now();
        annotations.click();
        await until(() => list().clientHeight && list().querySelector("[aria-setsize='1000']"), "annotation panel");
        await paint();
        durations.push(+(performance.now() - start).toFixed(2));
        if (i < 9) {
            info.click();
            await paint();
        }
    }
    const rows = list().querySelectorAll<HTMLElement>(".annotation-row");
    if (rows.length > 40 || list().scrollHeight < 80_000 || !list().querySelector(".annotation-excerpt")) throw Error("Annotation fixture or virtualization is incomplete");
    list().scrollTop = list().scrollHeight * .85;
    await until(() => Number(list().querySelector<HTMLElement>(".annotation-row")?.dataset.pageNumber) > 200, "far annotation");
    const row = list().querySelectorAll<HTMLElement>(".annotation-row")[4];
    const id = row.dataset.annotationId, page = Number(row.dataset.pageNumber);
    const start = performance.now();
    row.click();
    const target = active + `.viewer .page[data-page-number="${page}"]`;
    await until(() => document.querySelector(target + " .canvasWrapper canvas") && document.querySelector(target + " .textLayer span") &&
        document.querySelector(target + ` [data-highlight-id="${id}"][data-selected]`) && row.getAttribute("aria-selected") === "true", "jump to selected highlight");
    await paint();
    const jump = +(performance.now() - start).toFixed(2);
    list().scrollTop = 0;
    return { tabs: durations, jump, page };
}

type Trace = { pid: number; tid: number; name: string; ph: string; ts: number; dur?: number; args?: { data?: { type?: string } } };
async function scrollInput(selector: string): Promise<{ intervals: number[]; wheels: number; distance: number; geometry: number[] }> {
    const region = document.querySelector<HTMLElement>(selector);
    if (!region) throw Error("Missing scroll region " + selector);
    region.scrollTop = 0;
    const bounds = region.getBoundingClientRect(), frame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve));
    for (let i = 0; i < 8; i++) await frame();
    const before = region.scrollTop, intervals: number[] = [];
    let wheels = 0;
    const observe = (event: WheelEvent): void => {
        if (event.isTrusted) wheels++;
    };
    region.addEventListener("wheel", observe, { passive: true });
    try {
        performance.mark("reader-wheel-start");
        console.info("READER WHEEL " + Math.round(bounds.left + bounds.width / 2) + " " + Math.round(bounds.top + bounds.height / 2));
        let previous = await frame();
        for (let i = 0; i < 150; i++) {
            const now = await frame();
            intervals.push(now - previous);
            previous = now;
        }
    }
    finally {
        console.info("READER WHEEL stop");
        performance.mark("reader-wheel-end");
        region.removeEventListener("wheel", observe);
    }
    await frame();
    await frame();
    return { intervals, wheels, distance: (region.scrollTop - before) / region.clientHeight, geometry: [before, region.scrollTop, region.scrollHeight, region.clientHeight] };
}
async function wheel(wc: WebContents, selector: string, measureWork = false): Promise<{ frames: number; work: number | null; events: number }> {
    const events: Trace[] = [];
    let complete!: () => void, timer: ReturnType<typeof setInterval> | undefined;
    const done = new Promise<void>(resolve => complete = resolve);
    const trace = (_event: Electron.Event, method: string, params: { value: Trace[] }): void => {
        if (method === "Tracing.dataCollected") events.push(...params.value);
        if (method === "Tracing.tracingComplete") complete();
    };
    const input = (event: Electron.WebContentsConsoleMessageEventParams): void => {
        if (!event.message.startsWith("READER WHEEL ")) return;
        clearInterval(timer);
        const [, , x, y] = event.message.split(" ").map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            wc.sendInputEvent({ type: "mouseMove", x, y });
            timer = setInterval(() => {
                wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY: -144, canScroll: true });
            }, 16);
        }
    };
    wc.debugger.on("message", trace);
    wc.on("console-message", input);
    try {
        await wc.debugger.sendCommand("Tracing.start", { categories: "cc,devtools.timeline,blink.user_timing", transferMode: "ReportEvents" });
        const result: Awaited<ReturnType<typeof scrollInput>> = await wc.executeJavaScript(`(${scrollInput.toString()})(${JSON.stringify(selector)})`);
        await wc.debugger.sendCommand("Tracing.end");
        await done;
        if (result.wheels < (measureWork ? 50 : 1) || result.distance < 1) throw Error("Insufficient trusted wheel events or scroll distance: " +
            JSON.stringify({ wheels: result.wheels, distance: result.distance, geometry: result.geometry }));
        if (!measureWork) return { frames: p95(result.intervals), work: null, events: result.wheels };
        const start = events.find(event => event.name === "reader-wheel-start")!;
        const end = events.find(event => event.name === "reader-wheel-end")!;
        const main = events.filter(e => e.pid === start.pid && e.tid === start.tid && e.ph === "X" && e.ts >= start.ts);
        const frames = main.filter(e => e.name === "ProxyMain::BeginMainFrame").map(e => e.ts + e.dur!).sort((a, b) => a - b);
        const durations = main.filter(e => e.name === "EventDispatch" && e.args?.data?.type === "wheel" && e.ts <= end.ts).map(event => {
            const finish = frames.find(time => time >= event.ts + event.dur!);
            if (finish === undefined) throw Error("Missing frame after wheel dispatch");
            return (finish - event.ts) / 1000;
        });
        if (durations.length !== result.wheels) throw Error("Incomplete wheel trace: " + durations.length + "/" + result.wheels);
        return { frames: p95(result.intervals), work: p95(durations), events: result.wheels };
    }
    finally {
        clearInterval(timer);
        wc.off("console-message", input);
        wc.debugger.off("message", trace);
    }
}

async function run(): Promise<void> {
    const data = fixture();
    const { paperId, fileId } = seedReader(data, root);
    const directory = dirname(data.sql.name);
    session.close();
    const startup = startupServices(join(root, "profile"));
    startup.restore();
    if (startup.choose(directory, "open").status !== "ready") throw Error("Reader benchmark workspace unavailable");
    const appearance = settings.get().settings.appearance;
    settings.update({ appearance: { ...appearance, theme: "light", language: "en" } });
    const win = new BrowserWindow({ show: false, width: 1440, height: 900, titleBarStyle: "hidden", titleBarOverlay: true,
        webPreferences: { preload: join(root, "preload.cjs"), offscreen: true, backgroundThrottling: false, sandbox: true } });
    try {
        const wc = win.webContents;
        wc.setFrameRate(60);
        wc.on("console-message", event => {
            if (event.level === "error" && !event.message.endsWith("Error: Transport destroyed")) console.error(event.message);
        });
        registerIPCs(win, attach(win));
        await win.loadURL(process.env.LABLOOM_BENCH_URL!);
        wc.debugger.attach();
        await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });

        const open: number[] = await wc.executeJavaScript(`(${openings.toString()})()`);
        const median = (open.toSorted((a, b) => a - b)[4] + open.toSorted((a, b) => a - b)[5]) / 2;
        console.log("PDF OPEN", JSON.stringify({ median: +median.toFixed(2), samples: open }));
        await new Promise(resolve => setTimeout(resolve, 1000));
        const pdf = await wheel(wc, viewerSelector);
        console.log("PDF WHEEL", JSON.stringify(pdf));
        const before = process.env.LABLOOM_READER_BASELINE === "1";
        if (before) return;
        const timing: Awaited<ReturnType<typeof annotationTiming>> = await wc.executeJavaScript(`(${annotationTiming.toString()})()`);
        const list = await wheel(wc, listSelector, true);
        console.log("ANNOTATIONS", JSON.stringify({ ...timing, tabP95: p95(timing.tabs), wheel: list }));
        const capture = process.env.LABLOOM_READER_CAPTURE;
        if (capture) writeFileSync(join(capture, "reader-light.png"), (await wc.capturePage()).toPNG());
        await wc.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { width: 830, height: 850, deviceScaleFactor: 1, mobile: false });
        await wc.executeJavaScript(`(async () => {
            for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
            const paper = document.querySelector(${JSON.stringify(active + ".paper-panel")});
            if (getComputedStyle(paper).flexDirection !== "column") throw Error("Reader did not stack its sidebar at narrow width");
        })()`);
        if (capture) writeFileSync(join(capture, "reader-narrow.png"), (await wc.capturePage()).toPNG());
        await wc.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
        await wc.executeJavaScript(`(async () => {
            const saved = (await window.api.settings.get()).settings.appearance;
            await window.api.settings.update({ appearance: { ...saved, theme: "dark", language: "en" } });
            for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
            if (document.documentElement.dataset.theme !== "dark") throw Error("Dark theme did not apply");
            const paper = document.querySelector(${JSON.stringify(active + ".paper-panel")});
            if (getComputedStyle(paper).flexDirection !== "row") throw Error("Reader sidebar did not return to the right");
        })()`);
        if (capture) writeFileSync(join(capture, "reader-dark.png"), (await wc.capturePage()).toPNG());
        const errors: string[] = [];
        await wc.debugger.sendCommand("Runtime.enable");
        wc.debugger.on("message", (_event, method, params) => {
            if (method === "Runtime.exceptionThrown") {
                const { exception, text } = params.exceptionDetails;
                errors.push(exception?.description ?? text);
            }
        });
        await workflow(wc, paperId, fileId);
        if (errors.length) throw Error(errors.join("\n"));
        console.log("Reader workflow passed");
        if (median > 500 || timing.tabs.some(value => value > 200) || timing.jump > 300 || list.frames > 20 || (list.work ?? Infinity) > 8)
            throw Error("Reader performance threshold exceeded");
    }
    finally {
        win.destroy();
        startup.close();
    }
}

async function workflow(wc: WebContents, paperId: string, fileId: string): Promise<void> {
    await selectionWorkflow(wc, paperId, fileId);
    const names = ["Other.pdf", "Reference.txt", "Broken.pdf"];
    const paths = names.map(name => join(root, name));
    writeFileSync(paths[0], knownCoordinatePdf(false));
    writeFileSync(paths[1], "Reference materials");
    writeFileSync(paths[2], "This isn't a PDF");
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[0]] });
    await wc.executeJavaScript(`{
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.hidden = true;
        input.id = "reader-drop-fixture";
        document.body.append(input);
    }`);
    const { root: doc } = await wc.debugger.sendCommand("DOM.getDocument");
    const { nodeId } = await wc.debugger.sendCommand("DOM.querySelector", { nodeId: doc.nodeId, selector: "#reader-drop-fixture" });
    await wc.debugger.sendCommand("DOM.setFileInputFiles", { nodeId, files: paths });
    await wc.executeJavaScript(`(${readerWorkflow.toString()})(${JSON.stringify(paperId)}, ${JSON.stringify(fileId)}, ${JSON.stringify(names)})`);
}

async function selectionWorkflow(wc: WebContents, paperId: string, fileId: string): Promise<void> {
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    const run = <T, A extends unknown[]>(read: (...args: A) => T, ...args: A): Promise<Awaited<T>> =>
        wc.executeJavaScript(`(${read.toString()})(...${JSON.stringify(args)})`);
    async function until<T>(check: () => Promise<T | null | false>, message: string): Promise<T> {
        const deadline = performance.now() + 8_000;
        for (;;) {
            const value = await check();
            if (value) return value;
            if (performance.now() > deadline) throw Error(message);
            await wait(20);
        }
    }
    type Point = { x: number; y: number };
    const mouse = (type: string, at: Point, buttons: number, clickCount = 1): Promise<unknown> => wc.debugger.sendCommand("Input.dispatchMouseEvent", {
        type, ...at, buttons, button: type === "mouseMoved" && !buttons ? "none" : "left", clickCount
    });
    async function click(at: Point, count = 1): Promise<void> {
        await mouse("mouseMoved", at, 0);
        for (let i = 1; i <= count; i++) {
            await mouse("mousePressed", at, 1, i);
            await mouse("mouseReleased", at, 0, i);
        }
    }
    const selected: { x: number; y: number } = await wc.executeJavaScript(`(async () => {
        const input = document.querySelector('[aria-label="Page number"]');
        input.value = "1";
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        for (let i = 0; i < 100; i++) {
            await new Promise(requestAnimationFrame);
            const area = document.querySelector(".paper-panel .viewer").getBoundingClientRect();
            const text = document.querySelector('.paper-panel .page[data-page-number="1"] .textLayer span')?.getBoundingClientRect();
            if (text && text.top > area.top && text.bottom < area.bottom) {
                await new Promise(resolve => setTimeout(resolve, 120));
                return { x: text.left + 4, y: (text.top + text.bottom) / 2 };
            }
        }
        throw Error("No rendered PDF text to highlight");
    })()`);
    const palette = ".highlight-tools:popover-open";
    const note = ".annotation-popover:popover-open";
    const bounds = (selector: string): Promise<DOMRect | null> => run(selector => {
        const el = document.querySelector(selector);
        if (!el || getComputedStyle(el).visibility !== "visible") return null;
        return el.getBoundingClientRect().toJSON() as DOMRect;
    }, selector);
    const visiblePoint = async (selector: string): Promise<Point | null> => {
        const r = await bounds(selector);
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    };
    const selection = (): Promise<(Point & { width: number }) | null> => run(() => {
        const x = document.querySelector(".knowledge-selection span")?.getBoundingClientRect();
        return x ? { x: x.left + x.width / 2, y: x.top + x.height / 2, width: x.width } : null;
    });
    await click(selected);
    assert.equal(await selection(), null, "Single click selected PDF text");
    await wait(550);
    await mouse("mousePressed", selected, 1);
    await mouse("mouseMoved", { x: selected.x + 2, y: selected.y }, 1);
    await mouse("mouseReleased", { x: selected.x + 2, y: selected.y }, 0);
    assert.equal(await selection(), null, "Small pointer movement selected PDF text");
    await wait(550);
    await click(selected, 2);
    const word = await until(selection, "Double click did not select a PDF word");
    await until(() => visiblePoint(palette), "Word selection did not show colors");
    await wait(550);
    await click(word);
    assert.equal(await selection(), null, "Single click inside the selection left it selected");
    await wait(550);
    await click(selected, 3);
    assert.ok((await until(selection, "Triple click did not select a PDF line")).width > word.width * 2);
    await wait(550);
    const end = { x: selected.x + 110, y: selected.y };
    await mouse("mousePressed", selected, 1);
    await mouse("mouseMoved", end, 1);
    await until(selection, "PDF drag did not select text");
    assert.equal(await visiblePoint(palette), null, "Selection colors appeared before releasing the pointer");
    await mouse("mouseReleased", end, 0);
    const start = await until(() => visiblePoint(palette), "PDF selection did not show colors");
    assert.equal(await run(selector => document.querySelector(selector)?.querySelectorAll("button").length, palette), 4);

    const scroll = (deltaY: number): Promise<unknown> => wc.debugger.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseWheel", ...end, deltaX: 0, deltaY
    });
    const original = (await selection())!;
    await scroll(24);
    await until(async () => {
        const popup = await visiblePoint(palette), mark = await selection();
        if (!popup || !mark || Math.abs(mark.y - original.y) < 8) return false;
        return Math.abs((popup.y - start.y) - (mark.y - original.y)) < 2;
    }, "Palette did not track the PDF text during scrolling");
    await scroll(1000);
    await until(async () => !await visiblePoint(palette) && await run(s => !!document.querySelector(s), palette), "Palette was not clipped while offscreen");
    await scroll(-1024);
    await until(() => visiblePoint(palette), "Palette did not return with the selection");
    const zoom = await until(() => visiblePoint(".paper-panel [aria-label='Zoom in']"), "PDF zoom controls");
    await click(zoom);
    await until(async () => {
        const current = await selection(), colors = await bounds(palette);
        return current && colors && current.width > original.width * 1.02 && Math.abs(colors.top - current.y) < 50;
    }, "Zoom did not keep the palette beside the selection");
    await click(await until(() => visiblePoint(".paper-panel [aria-label='Zoom out']"), "Zoom out control"));
    const swatch = await until(() => visiblePoint(palette + " [aria-label='Green highlight']"), "Green highlight action");
    await click(swatch);
    await until(() => run(async (page, file, popup) => {
        const { annotations } = await window.api.papers.resources(page, file);
        const editor = document.querySelector(popup + " .tiptap[contenteditable=true]");
        return annotations.length === 1001 && editor && document.activeElement === editor;
    }, paperId, fileId, note), "Color did not create a focused annotation editor");
    await wc.debugger.sendCommand("Input.insertText", { text: "Created from the palette." });
    await until(() => run(s => document.querySelector(s + " .tiptap")?.textContent?.includes("Created from the palette.") ?? false, note), "New annotation did not accept typing");
    const id = await until(() => run(s => document.querySelector<HTMLElement>(s + " [data-history-page]")?.dataset.historyPage ?? null, note), "Annotation page ID");
    const mark = `.knowledge-highlight[data-highlight-id="${id}"]`;
    const initial = await until(() => bounds(note), "Visible note");
    const beforeDrag = await until(() => bounds(mark), "New highlight");
    assert.ok(initial.top >= beforeDrag.bottom - 1, "Note did not open below the first line");
    const handle = await until(() => visiblePoint(note + " header strong"), "Note title grip");
    const endDrag = { x: handle.x + 55, y: handle.y + 82 };
    await mouse("mouseMoved", handle, 0);
    await mouse("mousePressed", handle, 1);
    await mouse("mouseMoved", endDrag, 1);
    await mouse("mouseReleased", endDrag, 0);
    const moved = await until(async () => {
        const r = await bounds(note);
        return r && r.top > initial.top + 70 && r;
    }, "The note title did not drag");
    await scroll(24);
    await until(async () => {
        const r = await bounds(note), current = await bounds(mark);
        return r && current && Math.abs(current.top - beforeDrag.top) > 8 &&
            Math.abs((r.top - moved.top) - (current.top - beforeDrag.top)) < 2;
    }, "Dragged note stopped following the highlight");
    await scroll(1000);
    await until(async () => !await visiblePoint(note) && await run(s => !!document.querySelector(s), note), "The out-of-view note did not remain clipped");
    await scroll(-1024);
    await click(await until(() => visiblePoint(note + " [aria-label='Close']"), "Close note action"));
    await until(() => run(s => !document.querySelector(s), note), "New annotation did not close");
    await click(await until(() => visiblePoint(mark), "Click the new highlight"), 2);
    const reopened = await until(() => bounds(note), "Double click did not open the note");
    assert.ok(Math.abs(reopened.top - initial.top) < 5, "Reopening retained the previous drag offset");
    await click(await until(() => visiblePoint(note + " [aria-label='Close']"), "Close reopened note"));
    await until(() => run(s => !document.querySelector(s), note), "Reopened annotation did not close");
}
void app.whenReady().then(async () => {
    const timeout = setTimeout(() => {
        console.error("Reader benchmark timed out");
        app.exit(1);
    }, 120_000);
    await run();
    clearTimeout(timeout);
    app.exit(0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});