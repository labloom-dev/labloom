import { app, BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { Editor } from "@tiptap/core";
import { fixture, seedLargePage } from "./fixture";
import { AppStorage } from "../../main/storage/app";
import { Startup } from "../../main/startup/startup";
import { registerAppearanceIPCs } from "../../main/appearance/ipc";
import { registerFeedIPCs } from "../../main/feed/ipc";
import { registerKnowledgeIPCs } from "../../main/knowledge/ipc";
import { registerStartupIPCs } from "../../main/startup/ipc";

// Executed inside a dedicated benchmark renderer. Synthetic clicks here are timing samples only.
async function measure(): Promise<Record<string, { p50: number; p95: number }>> {
    const waitFor = async <T>(find: () => T | null | false): Promise<T> => {
        const started = performance.now();
        for (;;) {
            const value = find();
            if (value) return value;
            if (performance.now() - started > 12000) throw new Error("Timed out waiting for editor: " + document.body.innerText.slice(-400));
            await new Promise<void>(resolve => setTimeout(resolve, 2));
        }
    };
    const triggers = await waitFor(() => {
        const values = document.querySelectorAll<HTMLElement>("[data-tabs-trigger]");
        return values.length === 20 && [values[0], values[1]];
    });
    type Surface = HTMLElement & { editor: Editor };
    function surface(tab: HTMLElement): Surface | null {
        const area = document.getElementById(tab.getAttribute("aria-controls") ?? "");
        if (!area || area.hidden) return null;
        const dom = area.querySelector<Surface>(".tiptap");
        return dom?.isContentEditable && dom.editor && area.getBoundingClientRect().width ? dom : null;
    }
    await waitFor(() => surface(triggers[0]));
    triggers[1].click();
    await waitFor(() => surface(triggers[1]));
    let active = 1;
    const result: Record<string, { p50: number; p95: number }> = {};
    for (const dirty of [false, true]) {
        const samples: number[] = [];
        for (let i = 0; i <= 20; i++) {
            const previous = surface(triggers[active])!;
            const marker = " input-" + i + " ";
            if (dirty) {
                const editor = previous.editor;
                const pos = editor.state.doc.firstChild!.nodeSize + 2;
                editor.view.dispatch(editor.state.tr.insertText(marker, pos));
            }
            active = 1 - active;
            const target = triggers[active], start = performance.now();
            target.click();
            await waitFor(() => {
                const dom = surface(target);
                return dom && dom.editor.view.hasFocus() && (!dirty || dom.editor.state.doc.child(1).textContent.startsWith(marker));
            });
            const elapsed = performance.now() - start;
            if (i) samples.push(elapsed);
        }
        samples.sort((a, b) => a - b);
        result[dirty ? "changed" : "clean"] = { p50: samples[9], p95: samples[18] };
    }
    return result;
}

const root = process.env.LABLOOM_TEST_ROOT!;
const large = process.argv.at(-1) === "B";
app.setPath("userData", join(root, large ? "chromium-b" : "chromium-a"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.on("window-all-closed", () => { /* The measurement determines the exit status. */ });
async function run(large: boolean): Promise<boolean> {
    const f = fixture();
    const page = large ? seedLargePage(f) : f.sql.transaction(() => {
        const first = f.makePage(10, "Tab benchmark");
        for (let i = 1; i < 10000; i++) f.makePage(10, "Research notes");
        return first;
    })();
    const id = randomUUID(), tabs = Array.from({ length: 20 }, () => ({ id: randomUUID(), type: "page", pageId: page.id, title: "Tab benchmark" }));
    f.sql.prepare("UPDATE workspace_meta SET settings=?").run(JSON.stringify({ tabs: { groups: [{ id, tabs, activeTabId: tabs[0].id }], focusedGroupId: id, layout: { type: "group", groupId: id } } }));
    const path = dirname(f.sql.name);
    f.sql.close();
    const storage = new AppStorage(join(root, large ? "B" : "A")), startup = new Startup(storage);
    startup.restore();
    if (startup.choose(path, "open").status !== "ready") throw new Error("Could not open benchmark workspace");
    const window = new BrowserWindow({ show: false, width: 1280, height: 860, titleBarStyle: "hidden", titleBarOverlay: true,
        webPreferences: { preload: join(__dirname, "preload.cjs"), sandbox: true, backgroundThrottling: false } });
    try {
        window.webContents.on("console-message", details => {
 if (details.level === "error") console.error(details.message);
});
        registerStartupIPCs(window, startup);
        registerAppearanceIPCs(window, storage);
        registerFeedIPCs(window.webContents, startup);
        registerKnowledgeIPCs(window, startup);
        await window.loadURL(process.env.LABLOOM_BENCH_URL!);
        window.webContents.debugger.attach();
        await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        const results = await window.webContents.executeJavaScript(`(${measure.toString()})()`);
        console.log(large ? "B" : "A", JSON.stringify(results));
        return results.clean.p95 <= 50 && results.changed.p95 <= 300;
    }
    finally {
        window.destroy();
        startup.close();
    }
}
void app.whenReady().then(async () => {
    const deadline = setTimeout(() => {
 console.error("Tab benchmark timed out"); app.exit(1);
}, 150000);
    const passed = await run(large);
    clearTimeout(deadline);
    app.exit(passed ? 0 : 1);
}).catch(error => {
    console.error(error);
    app.exit(1);
});