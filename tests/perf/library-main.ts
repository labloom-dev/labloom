import { app, BrowserWindow, dialog, shell } from "electron";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { measureWheel } from "./library-wheel";
import { knownCoordinatePdf } from "../fixtures/pdf-text";
import { libraryWorkflow } from "./library-workflow";
import { fixture } from "./fixture";
import { seedLibrary } from "./library-fixture";
import { seedViews, viewFields, viewFixtureParams } from "./view-fixture";
import { checkView } from "./view-check";
import { checkLibrary, checkLibraryDeletion } from "./library-check";
import { nowSeconds, secondsPerDay } from "../../shared/content/time";
import { session, startupServices } from "../support/session";
import { registerIPCs } from "../../main/register";
import { attach } from "../../main/ui/windowFrame";
import * as settings from "../../main/settings/store";

const root = process.env.LABLOOM_TEST_ROOT!;
app.setPath("userData", join(root, "chromium"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.on("window-all-closed", () => { /* The benchmark controls its lifetime. */ });

async function run(): Promise<void> {
    const data = fixture();
    const views = process.env.LABLOOM_VIEW_BENCH === "yes";
    const referenceDay = Math.floor(nowSeconds() / secondsPerDay) * secondsPerDay;
    if (views) seedViews(data.sql, referenceDay);
    else seedLibrary(data.sql);
    const bulkPapers = views || process.env.LABLOOM_LIBRARY_WORKFLOW_ONLY ? null
        : data.sql.prepare("SELECT id FROM pages WHERE kind='paper' ORDER BY id").pluck().all() as string[];
    const directory = dirname(data.sql.name);
    session.close();
    const startup = startupServices(join(root, "profile"));
    startup.restore();
    if (startup.choose(directory, "open").status !== "ready") throw Error("Benchmark workspace unavailable");
    if (views) settings.update({ appearance: { timeZone: "UTC", theme: "light", language: "zh-CN" } });
    const win = new BrowserWindow({ show: false, width: 1440, height: 900, titleBarStyle: "hidden", titleBarOverlay: true,
        webPreferences: { preload: join(root, "preload.cjs"), offscreen: true, backgroundThrottling: false, sandbox: true } });
    try {
        const wc = win.webContents, errors: string[] = [];
        wc.setFrameRate(60);
        wc.on("render-process-gone", (_event, detail) => console.error("Renderer exited", detail));
        wc.on("preload-error", (_event, path, error) => console.error("Preload failed", path, error));
        wc.on("console-message", e => {
            if (e.level === "error") {
                errors.push(e.message);
                console.error(e.message);
            }
            else if (e.message.startsWith("View query timings")) console.log(e.message);
        });
        registerIPCs(win, attach(win));
        const url = process.env.LABLOOM_BENCH_URL!;
        try {
            await win.loadURL(url);
        }
        catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_FAILED") throw error;
            // Chromium may restart its network service while the development server starts.
            await win.loadURL(url);
        }
        console.log("Isolated renderer loaded");
        wc.debugger.attach();
        await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        if (views) {
            const result = await wc.executeJavaScript(`(${checkView.toString()})(${JSON.stringify(viewFixtureParams())},${JSON.stringify([viewFields.status, viewFields.multiple])})`);
            Object.assign(result, await measureWheel(wc, "grouped-table"));
            console.log("TABLE", JSON.stringify({ referenceDay, ...result }));
            const capture = process.env.LABLOOM_LIBRARY_CAPTURE;
            if (capture) for (const [theme, language] of [["light", "zh-CN"], ["dark", "en"]]) {
                settings.update({ appearance: { theme: theme as "light" | "dark", language: language as "zh-CN" | "en" } });
                await wc.executeJavaScript(`(async () => {
                    const until = performance.now() + 8000;
                    while (document.documentElement.dataset.theme !== "${theme}" || document.documentElement.lang !== "${language}" ||
                        document.querySelector(".library-grid")?.ariaBusy !== "false") {
                        if (performance.now() > until) throw Error("Theme not ready");
                        await new Promise(resolve => setTimeout(resolve, 15));
                    }
                    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
                })()`);
                writeFileSync(join(capture, `table-${theme}.png`), (await wc.capturePage()).toPNG());
            }
            if (errors.length) throw Error(errors.join("\n"));
            if (result.open > 200 || result.filter > 300 || result.sort > 300 || result.group > 300 || result.search > 300 ||
                result.arrow > 20 || result.scroll > 20 || result.deletion > 500 || result.create > 100 || result.edit > 150)
                throw Error("Table performance threshold exceeded");
            return;
        }
        let passed = true;
        for (const papers of process.env.LABLOOM_LIBRARY_WORKFLOW_ONLY ? [] : [false, true]) {
            const result = await wc.executeJavaScript(`(${checkLibrary.toString()})(${papers})`);
            Object.assign(result, await measureWheel(wc, papers ? "papers" : "knowledge"));
            result.deletion = await wc.executeJavaScript(`(${checkLibraryDeletion.toString()})(${papers})`);
            console.log(papers ? "PAPERS" : "LIBRARY", JSON.stringify(result));
            passed &&= result.open <= 200 && result.sort <= 300 && result.search <= 300 && result.arrow <= 20 && result.scroll <= 20 && result.wheelWork <= 8 && result.deletion <= 500;
        }
        const paths = ["A.pdf", "broken.pdf", "B.pdf", "notes.txt", "extra.txt"].map(name => join(root, name));
        paths.forEach((path, i) => writeFileSync(path, i === 0 || i === 2 ? knownCoordinatePdf() : "text"));
        let external = "";
        shell.openPath = async path => {
            external = path;
            return "";
        };
        dialog.showOpenDialog = async (...args: unknown[]) => {
            const options = args.at(-1) as Electron.OpenDialogOptions;
            if (!options.properties?.includes("multiSelections")) throw Error("PDF dialog must allow multiple files");
            return { canceled: false, filePaths: options.filters?.length ? paths.slice(0, 3) : [paths[4]] };
        };
        wc.on("console-message", e => {
            const match = /^LIBRARY CAPTURE (dark|light)$/u.exec(e.message), dir = process.env.LABLOOM_LIBRARY_CAPTURE;
            if (match && dir) void wc.capturePage().then(image => writeFileSync(join(dir, match[1] + ".png"), image.toPNG()));
        });
        await wc.executeJavaScript("const files = document.createElement(\"input\"); files.id=\"library-file-fixture\"; files.type=\"file\"; files.multiple=true; files.hidden=true; document.body.append(files)");
        const { root: doc } = await wc.debugger.sendCommand("DOM.getDocument");
        const { nodeId } = await wc.debugger.sendCommand("DOM.querySelector", { nodeId: doc.nodeId, selector: "#library-file-fixture" });
        await wc.debugger.sendCommand("DOM.setFileInputFiles", { nodeId, files: [paths[3], paths[2]] });
        const purge = await wc.executeJavaScript(`(${libraryWorkflow.toString()})(${JSON.stringify([paths[3]])}, ${JSON.stringify(bulkPapers)})`);
        if (purge !== null) {
            console.log("FILTERED PURGE", JSON.stringify({ pages: 6000, ms: purge }));
            passed &&= purge <= 500;
        }
        if (!external.endsWith(".txt")) throw Error("Expected the selected attachment to reach the system-open boundary");
        console.log("Library workflow passed");
        if (errors.length) throw Error(errors.join("\n"));
        if (!passed) throw Error("Library performance threshold exceeded");
    }
    finally {
        win.destroy();
        startup.close();
    }
}
void app.whenReady().then(async () => {
    const timeout = setTimeout(() => {
        console.error("Library benchmark timed out");
        app.exit(1);
    }, 240000);
    await run();
    clearTimeout(timeout);
    app.exit(0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});