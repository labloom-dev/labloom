import { app, BrowserWindow, dialog, shell } from "electron";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { measureWheel } from "./library-wheel";
import { knownCoordinatePdf } from "../fixtures/pdf-text";
import { libraryWorkflow } from "./library-workflow";
import { fixture } from "./fixture";
import { seedLibrary } from "./library-fixture";
import { checkLibrary, checkLibraryDeletion } from "./library-check";
import { session, startupServices } from "../support/session";
import { registerIPCs } from "../../main/register";
import { attach } from "../../main/ui/windowFrame";

const root = process.env.LABLOOM_TEST_ROOT!;
app.setPath("userData", join(root, "chromium"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.on("window-all-closed", () => { /* The benchmark controls its lifetime. */ });

async function run(): Promise<void> {
    const data = fixture();
    seedLibrary(data.sql);
    const bulkPapers = process.env.LABLOOM_LIBRARY_WORKFLOW_ONLY ? null
        : data.sql.prepare("SELECT id FROM pages WHERE kind='paper' ORDER BY id").pluck().all() as string[];
    const directory = dirname(data.sql.name);
    session.close();
    const startup = startupServices(join(root, "profile"));
    startup.restore();
    if (startup.choose(directory, "open").status !== "ready") throw Error("Benchmark workspace unavailable");
    const win = new BrowserWindow({ show: false, width: 1440, height: 900, titleBarStyle: "hidden", titleBarOverlay: true,
        webPreferences: { preload: join(root, "preload.cjs"), offscreen: true, backgroundThrottling: false, sandbox: true } });
    try {
        const wc = win.webContents, errors: string[] = [];
        wc.setFrameRate(60);
        wc.on("console-message", e => {
            if (e.level === "error") {
                errors.push(e.message);
                console.error(e.message);
            }
        });
        registerIPCs(win, attach(win));
        await win.loadURL(process.env.LABLOOM_BENCH_URL!);
        wc.debugger.attach();
        await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
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