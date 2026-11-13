import type { Editor } from "@tiptap/core";
import { app, BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fixture } from "./fixture";
import { EditHistory } from "../../main/knowledge/history";
import { PurgeService } from "../../main/knowledge/purge";
import { AppStorage } from "../../main/storage/app";
import { Startup } from "../../main/startup/startup";
import { registerAppearanceIPCs } from "../../main/appearance/ipc";
import { registerFeedIPCs } from "../../main/feed/ipc";
import { registerKnowledgeIPCs } from "../../main/knowledge/ipc";
import { registerStartupIPCs } from "../../main/startup/ipc";

function stats(values: number[]): { p50: number; p95: number } {
    const sorted = values.toSorted((a, b) => a - b);
    return { p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1] };
}
// Synthetic DOM actions are automated verification and timing, never real-input acceptance.
async function firstScreen(): Promise<{ sidebar: number; library: number; dimensions: Record<string, number>; rows: number }> {
    const wait = async (fn: () => boolean): Promise<void> => {
        const start = performance.now();
        while (!fn()) {
            if (performance.now() - start > 15000) throw new Error("UI timed out: " + document.body.innerText.slice(-800)); await new Promise(resolve => setTimeout(resolve, 5));
        }
    };
    let sidebar = 0, library = 0;
    await Promise.all([
        wait(() => document.querySelectorAll(".left-panel .page:not(.more)").length === 80).then(async () => {
            await new Promise(requestAnimationFrame); sidebar = performance.now();
        }),
        wait(() => document.querySelectorAll(".page-row").length === 40).then(async () => {
            await new Promise(requestAnimationFrame); library = performance.now();
        })
    ]);
    const size = (selector: string): number => document.querySelector(selector)!.getBoundingClientRect().height;
    const dimensions = { titlebar: size(".titlebar"), tabs: size(".group-header"), library: size(".page-row"), panel: size(".left-panel .page"), button: size(".library-toolbar .button"), panelWidth: document.querySelector(".left-panel")!.getBoundingClientRect().width };
    return { sidebar, library, dimensions, rows: document.querySelectorAll(".left-panel .page:not(.more)").length };
}
async function titleFilterSamples(): Promise<number[]> {
    const input = document.querySelector<HTMLInputElement>(".left-panel .filter")!, samples: number[] = [];
    const wait = async (condition: () => boolean): Promise<void> => { const start = performance.now(); while (!condition()) { if (performance.now() - start > 15000) throw new Error("Title filter timeout"); await new Promise(resolve => setTimeout(resolve, 2)); } };
    for (let i = 0; i <= 20; i++) {
        const start = performance.now(); input.value = "ordinary" + i; input.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(() => !!document.querySelector(".left-panel section[aria-busy=true]"));
        await wait(() => !document.querySelector(".left-panel section[aria-busy=true]"));
        await new Promise(requestAnimationFrame);
        if (i) samples.push(performance.now() - start);
    }
    return samples;
}
async function interactions(): Promise<string[]> {
    const passed: string[] = [], wait = async (fn: () => boolean, label: string): Promise<void> => {
        const start = performance.now();
        while (!fn()) {
            if (performance.now() - start > 10000) throw new Error(label + ": " + document.body.innerText.slice(-600)); await new Promise(resolve => setTimeout(resolve, 5));
        }
    };
    const check = (value: unknown, label: string): void => {
        if (!value) throw new Error(label); passed.push(label);
    };
    const rows = [...document.querySelectorAll<HTMLElement>(".page-row")];
    rows[0].click(); rows[2].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    await wait(() => document.querySelectorAll(".page-row.selected").length === 3, "shift selection");
    check(document.querySelectorAll(".page-row.selected").length === 3, "library shift selection");
    rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await wait(() => document.querySelectorAll(".page-row.selected").length === 2, "ctrl selection");
    check(document.querySelectorAll(".page-row.selected").length === 2, "library ctrl toggle");
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a", ctrlKey: true }));
    await wait(() => document.querySelectorAll(".page-row.selected").length === 40, "select all");
    check(document.querySelectorAll(".page-row.selected").length === 40, "library select all loaded rows");
    const filter = document.querySelector<HTMLInputElement>(".library-toolbar input")!;
    filter.value = "Research 00001"; filter.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(() => document.querySelectorAll(".page-row").length === 1, "debounced search");
    passed.push("library debounced search");
    const panel = document.querySelector<HTMLInputElement>(".left-panel .filter")!;
    panel.value = "Research 00001"; panel.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(() => document.querySelectorAll(".left-panel .page:not(.more)").length === 2, "sidebar title filter");
    passed.push("sidebar title filter applies to pinned and independent groups");
    document.querySelector<HTMLElement>(".page-row")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await wait(() => !!document.querySelector<HTMLElement>(".tiptap")?.isContentEditable, "open page");
    const toolbar = document.querySelector(".page-toolbar")!;
    check(toolbar.getBoundingClientRect().height === 28, "page toolbar is 28px");
    check(!toolbar.textContent?.includes("已保存") && !toolbar.textContent?.includes("撤销"), "page toolbar has no saved/undo controls");
    [...toolbar.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "属性")!.click();
    await wait(() => !!document.querySelector(".properties"), "properties");
    check(document.querySelectorAll(".properties .property").length > 0, "properties show attached values");
    document.querySelector<HTMLButtonElement>(".properties .add-property")!.click();
    await wait(() => !!document.querySelector(".add-property-menu input"), "add property picker");
    const name = document.querySelector<HTMLInputElement>(".add-property-menu input")!;
    name.value = "Experiment A"; name.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(() => document.body.innerText.includes("新建属性 Experiment A"), "inline new attribute");
    [...document.querySelectorAll<HTMLButtonElement>(".add-property-menu button")].find(button => button.textContent?.includes("新建属性"))!.click();
    await wait(() => [...document.querySelectorAll(".add-property-menu button")].some(button => button.textContent === "文本"), "attribute types");
    [...document.querySelectorAll<HTMLButtonElement>(".add-property-menu button")].find(button => button.textContent === "文本")!.click();
    await wait(() => document.querySelector(".properties")!.textContent!.includes("Experiment A"), "attribute attaches");
    passed.push("inline attribute creation and attachment");
    const tag = document.querySelector<HTMLInputElement>(".tags-input input")!;
    tag.focus(); tag.value = "diffusion"; tag.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(() => document.body.innerText.includes("新建标签 diffusion"), "new tag option");
    tag.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(() => document.querySelector(".tags-input")!.textContent!.includes("diffusion") && !document.querySelector(".tag-options"), "create tag");
    passed.push("tag creation and selection");
    tag.focus(); tag.value = "A second tag"; tag.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(() => document.body.innerText.includes("新建标签 A second tag"), "second tag");
    tag.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(() => document.querySelectorAll(".tags-input .capsule").length === 2, "two tag values");
    await wait(() => [...document.querySelectorAll(".left-panel .group-name")].filter(button => ["diffusion", "A second tag"].some(name => button.textContent?.includes(name))).length === 2, "tag groups");
    for (const name of ["diffusion", "A second tag"]) [...document.querySelectorAll<HTMLButtonElement>(".left-panel .group-name")].find(button => button.textContent?.includes(name))!.click();
    await wait(() => document.querySelectorAll(".left-panel .page:not(.more)").length === 4, "same page in both tag groups");
    passed.push("one page appears in each of its two tag groups");
    check([...document.querySelectorAll(".properties .property")].every(row => row.getBoundingClientRect().height === 26), "property rows stay 26px with multiple tags");
    const surface = document.querySelector<HTMLElement & { editor: Editor }>("[data-tabs-content]:not([hidden]) .tiptap")!;
    const editor = surface.editor, sourceTab = document.querySelector<HTMLElement>("[data-tabs-trigger][data-state=active]")!;
    const blockId = editor.state.doc.child(1).attrs.blockId;
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize + 3);
    surface.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", altKey: true, bubbles: true }));
    await wait(() => editor.state.doc.child(2).attrs.blockId === blockId, "move block down");
    passed.push("block move preserves UUID");
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize + 3); editor.view.focus();
    const point = editor.view.coordsAtPos(editor.state.selection.head);
    surface.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: point.left, clientY: point.top }));
    await wait(() => !!document.querySelector(".body-context:popover-open"), "editor context menu");
    [...document.querySelectorAll<HTMLElement>(".body-context:popover-open .compact-item")].find(item => item.textContent === "插入行内引用")!.click();
    await wait(() => !!document.querySelector(".inline-picker input"), "inline picker");
    const reference = document.querySelector<HTMLInputElement>(".inline-picker input")!;
    await new Promise(resolve => setTimeout(resolve, 30));
    check(document.activeElement === reference, "inline picker receives keyboard focus");
    reference.value = "Research 00002"; reference.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(() => [...document.querySelectorAll(".inline-picker .results button")].some(item => item.textContent?.includes("Research 00002")), "inline target search");
    reference.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(() => !!surface.querySelector(".inline-reference"), "inline insertion");
    passed.push("inline reference inserts at caret");
    const link = surface.querySelector<HTMLElement>(".inline-reference")!;
    link.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    await wait(() => !!document.querySelector(".preview:popover-open"), "reference hover");
    surface.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    await wait(() => !document.querySelector(".preview"), "reference hover leaves");
    passed.push("hover preview appears and disappears");
    const linkBounds = link.getBoundingClientRect();
    const clickAt = { bubbles: true, button: 0, clientX: linkBounds.left + 3, clientY: linkBounds.top + 3 };
    link.dispatchEvent(new MouseEvent("mousedown", clickAt)); link.dispatchEvent(new MouseEvent("mouseup", clickAt));
    await wait(() => document.querySelector("[data-tabs-trigger][data-state=active]")?.textContent?.includes("Research 00002") === true, "reference opens target");
    sourceTab.click();
    await wait(() => document.querySelector("[data-tabs-trigger][data-state=active]") === sourceTab && surface.isContentEditable, "return to source");
    passed.push("reference click opens target");
    const menu = [...document.querySelectorAll<HTMLElement>(".app-menu")].find(item => item.textContent === "前往")!;
    menu.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, pointerType: "mouse" }));
    await wait(() => [...document.querySelectorAll<HTMLElement>(".compact-item")].some(item => item.textContent === "属性管理"), "go menu");
    [...document.querySelectorAll<HTMLElement>(".compact-item")].find(item => item.textContent === "属性管理")!.click();
    await wait(() => !!document.querySelector(".manager .definition"), "attribute management tab");
    const tagsDefinition = [...document.querySelectorAll<HTMLButtonElement>(".manager .definition")].find(button => button.textContent?.includes("标签"))!;
    tagsDefinition.click();
    await wait(() => !!document.querySelector(".manager .manager-body input"), "select definition");
    [...document.querySelectorAll<HTMLButtonElement>(".manager .text-button")].find(button => button.textContent?.includes("添加选项"))!.click();
    await wait(() => document.activeElement?.getAttribute("aria-label") === "选项名称", "new option focus");
    check((document.activeElement as HTMLInputElement).value === "", "new option starts empty and focused");
    const activeTab = document.querySelector<HTMLElement>("[data-tabs-trigger][data-state=active]")!;
    const count = document.querySelectorAll("[data-tabs-trigger]").length;
    activeTab.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true, isComposing: true, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    check(document.querySelectorAll("[data-tabs-trigger]").length === count, "composing shortcut ignored");
    activeTab.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true }));
    await wait(() => document.querySelectorAll("[data-tabs-trigger]").length === count + 1 && !!document.querySelector<HTMLElement>("[data-tabs-content]:not([hidden]) .tiptap")?.isContentEditable, "global new page shortcut");
    passed.push("global new-page shortcut");
    const content = document.querySelector<HTMLElement>("[data-tabs-content]:not([hidden]) .tiptap")!;
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", ctrlKey: true, bubbles: true }));
    await wait(() => document.querySelectorAll(".group").length === 2 && document.querySelectorAll(".tiptap").length >= 3, "split current page");
    const editorTabs = [...document.querySelectorAll(".group [data-tabs-trigger][data-state=active]")];
    check(editorTabs.length === 2 && editorTabs[0].textContent === editorTabs[1].textContent, "split duplicates current tab");
    return passed;
}

const root = process.env.LABLOOM_TEST_ROOT!;
app.setPath("userData", join(root, "chromium-compact"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.on("window-all-closed", () => { });
const f = fixture(), path = dirname(f.sql.name), history = new EditHistory(f.service), purge = new PurgeService(f.service, history, path);
f.sql.transaction(() => {
    for (let i = 0; i < 10000; i++) {
        const page = f.makePage(10, "Research " + String(i).padStart(5, "0"));
        if (i < 100) f.attr.run(1, page.id, "pinned");
    }
})();
const deletion: number[] = [];
for (let sample = 0; sample <= (process.env.LABLOOM_COMPACT_UI_ONLY ? 0 : 20); sample++) {
    const ids = f.sql.transaction(() => Array.from({ length: 100 }, (_, i) => {
        const page = f.makePage(10, "Recycle " + i); f.attr.run(1, page.id, "deleted"); return page.id;
    }))();
    const preview = purge.purge(ids, "benchmark");
    if (preview.status !== "confirmation") throw new Error("Missing confirmation");
    const start = performance.now(); purge.purge(ids, "benchmark", preview.token); if (sample) deletion.push(performance.now() - start);
}
const group = randomUUID(), tabs = Array.from({ length: 20 }, () => ({ id: randomUUID(), type: "library", title: "知识库" }));
f.sql.prepare("UPDATE workspace_meta SET settings=?").run(JSON.stringify({ tabs: { groups: [{ id: group, tabs, activeTabId: tabs[0].id }], focusedGroupId: group, layout: { type: "group", groupId: group } } }));
f.sql.close();
void app.whenReady().then(async () => {
    const deadline = setTimeout(() => app.exit(1), 240000);
    const storage = new AppStorage(join(root, "storage")), startup = new Startup(storage);
    startup.restore(); startup.choose(path, "open");
    const window = new BrowserWindow({ show: false, width: 1280, height: 860, titleBarStyle: "hidden", titleBarOverlay: { height: 32 }, webPreferences: { preload: join(__dirname, "preload.cjs"), sandbox: true, backgroundThrottling: false } });
    try {
        window.webContents.on("console-message", details => {
            if (details.level === "error") console.error(details.message);
        });
        registerStartupIPCs(window, startup); registerAppearanceIPCs(window, storage);
        registerFeedIPCs(window, startup, registerKnowledgeIPCs(window, startup, storage));
        window.webContents.debugger.attach();
        const sidebar: number[] = [], library: number[] = [];
        let last: Awaited<ReturnType<typeof firstScreen>> | undefined;
        for (let sample = 0; sample <= (process.env.LABLOOM_COMPACT_UI_ONLY ? 0 : 20); sample++) {
            await window.loadURL(process.env.LABLOOM_BENCH_URL!);
            await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
            last = await window.webContents.executeJavaScript(`(${firstScreen.toString()})()`);
            if (sample) {
                sidebar.push(last!.sidebar); library.push(last!.library);
            }
        }
        const filterTimes: number[] = process.env.LABLOOM_COMPACT_UI_ONLY ? [] : await window.webContents.executeJavaScript(`(${titleFilterSamples.toString()})()`);
        console.log(JSON.stringify({ titleFilter: stats(filterTimes), scale: "10000 pages / 100000 blocks / 20 tabs", sidebar: stats(sidebar), library: stats(library), purge100: stats(deletion), dimensions: last!.dimensions, renderedPanelRows: last!.rows }));
        const output = join(process.cwd(), ".local", "compact-qa-1112"); mkdirSync(output, { recursive: true });
        writeFileSync(join(output, "automated-library.png"), (await window.webContents.capturePage()).toPNG());
        if (filterTimes.length && stats(filterTimes).p95 > 1000) throw new Error("Title-filter P95 exceeds 1s");
        const passed = await window.webContents.executeJavaScript(`(${interactions.toString()})()`);
        console.log("Automated UI", JSON.stringify(passed));
        writeFileSync(join(output, "automated-page.png"), (await window.webContents.capturePage()).toPNG());
    }
    finally {
        window.destroy(); await new Promise(resolve => setTimeout(resolve, 150)); startup.close(); clearTimeout(deadline);
    }
    app.exit(0);
}).catch(error => {
    console.error(error); app.exit(1);
});