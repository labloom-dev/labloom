import Database from "better-sqlite3";
import { app, BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as edits from "../../main/knowledge/edits";
import * as attributes from "../../main/knowledge/attributes";
import * as workspaceSettings from "../../main/workspace-settings";
import { registerIPCs } from "../../main/register";
import { attach } from "../../main/ui/windowFrame";
import { payload } from "../../shared/content/blocks";
import type { ContentBlock } from "../../shared/types/content";
import { fixture, seedLargePage } from "./fixture";
import { session, startupServices } from "../support/session";
import { checkEditing } from "./editing-check";
import { checkPicker } from "./picker-check";

const root = process.env.LABLOOM_TEST_ROOT!;
app.setPath("userData", join(root, "chromium"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.on("window-all-closed", () => { /* The benchmark owns its lifetime. */ });

async function workspace(): Promise<{ directory: string; id: string }> {
    const fixed = process.env.LABLOOM_PICKER_FIXTURE;
    if (fixed) {
        const original = JSON.parse(readFileSync(fixed, "utf8")) as { directory: string; id: string };
        const source = new Database(join(original.directory, "workspace.sqlite"), { readonly: true, fileMustExist: true });
        const directory = join(root, "workspace");
        mkdirSync(join(directory, "attachments"), { recursive: true });
        try {
            await source.backup(join(directory, "workspace.sqlite"));
        }
        finally {
            source.close();
        }
        return { directory, id: original.id };
    }
    const data = fixture(), page = seedLargePage(data), directory = dirname(data.sql.name);
    session.close();
    return { directory, id: page.id };
}

async function run(): Promise<void> {
    const large = await workspace(), startup = startupServices(join(root, "profile"));
    startup.restore();
    if (startup.choose(large.directory, "open").status !== "ready") throw new Error("Could not open benchmark workspace");
    workspaceSettings.update({ tabs: null });
    const field = "custom:" + randomUUID(), choice = "custom:" + randomUUID();
    attributes.persistDefinition(field, { id: field, type: "string", name: "Caption", metadata: {} });
    attributes.persistDefinition(choice, { id: choice, type: "select", name: "Choice", metadata: { options: [{ id: "a", name: "A" }, { id: "b", name: "B" }] } });
    const origin = edits.createPage("editable", "Picker checks", { pinned: true, [field]: "caption", [choice]: "a" });
    const targetPage = edits.createPage("editable", "Target labels");
    const blocks: ContentBlock[] = Array.from({ length: 500 }, (_, i) => ({
        id: i ? randomUUID() : targetPage.children[0], type: "paragraph", children: [], payload: payload("paragraph", "Reference target " + i)
    }));
    const refs = edits.createPage("editable", "500 references");
    function populate(pageId: string, blocks: ContentBlock[], children = blocks.map(b => b.id)): void {
        if (edits.commitEdit({ pageId, batch: 0, blocks, pageChildren: children }, false).status !== "saved")
            throw new Error("Could not seed picker blocks");
    }
    populate(origin.id, [{ ...origin.blocks[origin.children[0]], payload: payload("paragraph", "ABCDE") }]);
    populate(targetPage.id, blocks);
    populate(refs.id, blocks.map((block, i) => ({
        id: i ? randomUUID() : refs.children[0], type: "blocked_reference", children: [], payload: { ...payload("blocked_reference"), target: { kind: "block", id: block.id } }
    })));
    let geometry: string | undefined;
    if (process.argv.includes("editing")) {
        const page = edits.createPage("editable", "Drag checks", { pinned: true });
        geometry = page.id;
        const rows: ContentBlock[] = ["A", "B", "C", "D", "E", "F"].map((label, i) => {
            const type = i === 1 ? "blockquote" : "paragraph";
            return { id: i ? randomUUID() : page.children[0], type, payload: payload(type, label), children: [] };
        });
        rows[0].children = [rows[1].id];
        populate(page.id, rows, rows.filter((_item, i) => i !== 1).map(item => item.id));
        const source = edits.createPage("editable", "Backlink source");
        populate(source.id, [origin.id, page.id].map((id, i) => ({
            id: i ? randomUUID() : source.children[0], type: "blocked_reference", children: [],
            payload: { ...payload("blocked_reference"), target: { kind: "page", id } }
        })));
    }
    const win = new BrowserWindow({ show: false, width: 1280, height: 860, titleBarStyle: "hidden", titleBarOverlay: true,
        webPreferences: { preload: join(root, "preload.cjs"), sandbox: true, backgroundThrottling: false, offscreen: true } });
    try {
        // Offscreen rendering keeps Chromium painting the hidden test window at a display cadence.
        win.webContents.setFrameRate(60);
        registerIPCs(win, attach(win));
        const errors: string[] = [];
        win.webContents.on("console-message", details => {
            const capture = /^CHECK (theme|drag) (light|dark)$/u.exec(details.message);
            if (process.env.LABLOOM_EDITOR_CAPTURE && capture) {
                const path = join(process.env.LABLOOM_EDITOR_CAPTURE, (capture[1] === "drag" ? "drag-" : "") + capture[2] + ".png");
                win.webContents.once("paint", (_details, _dirty, bitmap) => writeFileSync(path, bitmap.toPNG()));
                win.webContents.invalidate();
            }
            if (details.level === "error") errors.push(details.message);
            if (details.level === "error" || details.message.startsWith("CHECK ")) console.log(details.message);
        });
        await win.loadURL(process.env.LABLOOM_BENCH_URL!);
        win.webContents.debugger.attach();
        await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        const args = JSON.stringify({ origin: origin.id, large: large.id, references: refs.id, geometry });
        if (process.argv.includes("editing")) {
            const result = await win.webContents.executeJavaScript(`(${checkEditing.toString()})(${args})`);
            console.log("EDITING", JSON.stringify(result));
            if (errors.length) throw new Error(errors.join("\n"));
            if (result.open > 50 || result.filter > 50) throw new Error("Slash menu latency exceeded 50ms");
            if (result.handle > 2 || result.dragFrame > 20 || result.marqueeFrame > 20 || result.dragWork > 8 || result.marqueeWork > 8 || result.move > 200 || result.delete > 500 || result.code > 50)
                throw new Error("Editor interaction latency exceeded its limit");
            return;
        }
        const results = await win.webContents.executeJavaScript(`(${checkPicker.toString()})(${args})`);
        if (errors.length) throw new Error(errors.join("\n"));
        console.log("PICKER", JSON.stringify(results));
        if (results.open.p95 > 100 || results.filter.p95 > 50) throw new Error("Picker latency exceeded its limit");
    }
    finally {
        win.destroy();
        startup.close();
    }
}
void app.whenReady().then(async () => {
    const timeout = setTimeout(() => {
        console.error("Isolated picker benchmark timed out"); app.exit(1);
    }, 180000);
    await run();
    clearTimeout(timeout); app.exit(0);
}).catch(problem => {
    console.error(problem); app.exit(1);
});