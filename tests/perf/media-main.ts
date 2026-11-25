import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { app, BrowserWindow, dialog, protocol } from "electron";
import { registerAttachmentProtocol } from "../../main/attachments/protocol";
import { readAttachment } from "../../main/attachments/read";
import { importPath, stagePaths } from "../../main/attachments/service";
import { routes } from "../../main/pages/ipc";
import { registerIPCs } from "../../main/register";
import { attach } from "../../main/ui/windowFrame";
import * as workspaceSettings from "../../main/workspace-settings";
import { attachmentScheme } from "../../shared/content/media";
import { payload } from "../../shared/content/blocks";
import type { ContentBlock } from "../../shared/types/content";
import { knownCoordinatePdf } from "../fixtures/pdf-text";
import { session, startupServices } from "../support/session";
import { fixture, type SeedPage } from "./fixture";
import { browserChecks } from "./media-check";

const root = process.env.LABLOOM_TEST_ROOT!, assets = process.env.LABLOOM_MEDIA_FIXTURES!;
app.setPath("userData", join(root, "chromium"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
registerAttachmentProtocol();

async function run(): Promise<void> {
    await app.whenReady();
    const { images, large, small } = JSON.parse(readFileSync(join(assets, "media.json"), "utf8")) as {
        images: { path: string; width: number; height: number }[]; large: string; small: string;
    };
    const jpg = images.find(image => image.path.endsWith(".jpeg"))!;
    const requested: string[] = [];
    session.configureNetwork(async input => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith("/bad.png")) return new Response("not an image", { headers: { "content-type": "text/plain" } });
        if (url.includes("/slow")) await wait(450);
        return new Response(readFileSync(jpg.path), { headers: { "content-type": "image/jpeg", "content-disposition": "attachment; filename=\"Remote.jpg\"" } });
    });
    const foreignWorkspace = fixture(), foreignPage = foreignWorkspace.makePage(2, "Foreign image");
    const foreignFile = await importPath(jpg.path), foreignId = session.getInfo().id, foreignBlock = foreignPage.children[0];
    assert.equal(foreignWorkspace.service.commitEdit({ pageId: foreignPage.id, batch: 0, blocks: [{
        id: foreignBlock, type: "image", children: [], payload: { ...payload("image"),
            media: { fileId: foreignFile.id, naturalWidth: jpg.width, aspectRatio: jpg.width / jpg.height } }
    }] }, false).status, "saved");
    session.close();
    const source = fixture(), photos = source.makePage(1, "300 images"), note = source.makePage(2, "Media editing"),
        editing = source.makePage(2, "Concurrent editing"), short = source.makePage(1, "Small video"),
        correction = source.makePage(1, "Media transfer and links");
    for (const page of [photos, note, editing, short, correction]) source.attr.run(1, page.id, "pinned");
    const index = await stagePaths(images.map(image => image.path), false, true), shortFile = await importPath(small);
    function populate(page: SeedPage, blocks: ContentBlock[]): void {
        assert.equal(source.service.commitEdit({ pageId: page.id, batch: 0, blocks, pageChildren: blocks.map(block => block.id) }, false).status, "saved");
    }
    populate(photos, images.map((image, i) => ({ id: randomUUID(), type: "image", children: [],
        payload: { ...payload("image", i === 1 ? "Sample caption" : ""), media: { fileId: index.files[i].id,
            naturalWidth: image.width, aspectRatio: image.width / image.height } }
    })));
    populate(short, [{ id: randomUUID(), type: "video", children: [],
        payload: { ...payload("video"), media: { fileId: shortFile.id, aspectRatio: 16 / 9 } } }]);
    populate(correction, ["Keep move rest", "Drop here"].map(text => ({ id: randomUUID(), type: "paragraph", children: [], payload: payload("paragraph", text) })));
    const directory = dirname(source.sql.name);
    session.close();
    const startup = startupServices(join(root, "profile"));
    startup.restore();
    assert.equal(startup.choose(directory, "open").status, "ready");
    workspaceSettings.update({ tabs: null });
    const ranged: { length: number; from: string }[] = [];
    protocol.unhandle(attachmentScheme);
    protocol.handle(attachmentScheme, async request => {
        const result = await readAttachment(request);
        const range = result.headers.get("content-range");
        if (request.url.endsWith(watchedVideo) && watchedVideo && result.status === 206 && range)
            ranged.push({ length: Number(result.headers.get("content-length")), from: range });
        return result;
    });
    let watchedVideo = "";
    const editTimes: number[] = [];
    const edit = routes.commitEdit;
    routes.commitEdit = Object.assign((...args: unknown[]) => {
        const start = performance.now();
        try {
            return edit(...args);
        }
        finally {
            if ((args[0] as { pageId?: string })?.pageId === editing.id) editTimes.push(performance.now() - start);
        }
    }, { check: edit.check });
    const win = new BrowserWindow({ show: false, width: 1280, height: 860, titleBarStyle: "hidden", titleBarOverlay: true,
        webPreferences: { preload: join(root, "preload.cjs"), sandbox: true, offscreen: true, backgroundThrottling: false } });
    const contents = win.webContents;
    contents.setFrameRate(60);
    const openedLinks: string[] = [];
    contents.setWindowOpenHandler(({ url }) => {
        openedLinks.push(url);
        return { action: "deny" };
    });
    const errors: string[] = [];
    contents.on("console-message", event => {
        if (event.message.startsWith("MEDIA") || event.level === "error") console.log(event.message);
        if (event.level === "error") errors.push(event.message);
    });
    const pdf = join(root, "Dropped paper.pdf"), text = join(root, "Unsupported.tiff");
    writeFileSync(pdf, knownCoordinatePdf());
    writeFileSync(text, Buffer.from("II*\x00Unsupported image", "latin1"));
    const showOpenDialog = dialog.showOpenDialog, showSaveDialog = dialog.showSaveDialog, saved = join(root, "Saved.tiff");
    Object.assign(dialog, {
        showOpenDialog: async () => ({ canceled: false, filePaths: [jpg.path, jpg.path] }),
        showSaveDialog: async () => ({ canceled: false, filePath: saved })
    });
    registerIPCs(win, attach(win));
    try {
        await win.loadURL(process.env.LABLOOM_BENCH_URL!);
        contents.debugger.attach();
        await contents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        const result = await contents.executeJavaScript(`(${browserChecks.toString()})(${JSON.stringify({
            photos: photos.id, note: note.id, short: short.id, editing: editing.id, ordinary: editing.children[0], correction: correction.id
        })}, ${JSON.stringify({ workspaceId: foreignId, file: foreignFile })})`);
        console.log("MEDIA images", JSON.stringify(result));
        await capture("media");
        await contents.executeJavaScript("window.mediaQA.closeViewer()");
        const point = await contents.executeJavaScript("window.mediaQA.startScroll()");
        for (let i = 0; i < 160; i++) {
            await contents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: 470 });
            await wait(9);
        }
        await wait(120);
        const scroll = await contents.executeJavaScript("window.mediaQA.stopScroll()");
        console.log("MEDIA wheel", JSON.stringify(scroll));
        await contents.executeJavaScript("window.mediaQA.checkCorrections()", true);
        assert.ok(!requested.includes("https://example.test/clipboard-only.png"), "Browser image with a bitmap made a network request");
        assert.ok(requested.includes("https://example.test/dropped.png"), "Remote image in mixed drop was not downloaded");
        assert.deepEqual(openedLinks, ["https://example.test/open-link"], "Only Ctrl/Cmd click in the editable page opens the link");
        await contents.executeJavaScript("window.mediaQA.checkReadOnlyLink()", true);
        assert.deepEqual(openedLinks, ["https://example.test/open-link", "https://example.test/open-link"], "Ordinary click in the recycled page opens the link");
        console.log("MEDIA no bitmap re-download, editable and recycled link opening");
        let clipboardFailure: unknown;
        try {
            await contents.executeJavaScript("window.mediaQA.checkClipboard()");
        }
        catch (error) {
            clipboardFailure = error;
            console.error(error);
        }
        await contents.executeJavaScript("window.mediaQA.open('note')");
        await drop([jpg.path, pdf, text]);
        const paper = await contents.executeJavaScript("window.mediaQA.checkDrop()");
        assert.equal(paper.independent, false);
        assert.equal(paper.kind, "paper");
        assert.equal(paper.undo, true);
        assert.deepEqual(readFileSync(saved), readFileSync(text));
        console.log("MEDIA mixed local drop, one undo, file save", JSON.stringify(paper));
        await capture("blocks");
        // Seek the small control first and sample the same renderer before and after each playback.
        await contents.executeJavaScript("window.mediaQA.open('short')");
        await contents.executeJavaScript("window.mediaQA.readyVideo()");
        const memory = (): number => {
            const info = app.getAppMetrics().find(row => row.pid === contents.getOSProcessId())!.memory;
            return info.privateBytes ?? info.workingSetSize;
        };
        async function seekMemory(): Promise<{ seek: number; growthKiB: number }> {
            const initial = memory(), samples = [initial], timer = setInterval(() => samples.push(memory()), 25);
            try {
                const seek = await contents.executeJavaScript("window.mediaQA.seek()");
                samples.push(memory());
                return { seek, growthKiB: Math.max(...samples) - initial };
            }
            finally {
                clearInterval(timer);
            }
        }
        const smallSample = await seekMemory();
        await contents.executeJavaScript("window.mediaQA.open('note'); window.mediaQA.armCopy()");
        await drop([large]);
        const copied = await contents.executeJavaScript("window.mediaQA.editDuringCopy()");
        console.log("MEDIA copy", JSON.stringify({ copied, edits: editTimes.length, editP95: percentile(editTimes) }));
        await contents.executeJavaScript("window.mediaQA.open('note'); window.mediaQA.readyVideo()");
        watchedVideo = await contents.executeJavaScript("window.mediaQA.video().src.split('/').at(-1)");
        const bigSample = await seekMemory(), megabytes = statSync(large).size;
        const middle = ranged.find(row => Number(/bytes (\d+)/.exec(row.from)?.[1]) > megabytes / 4);
        console.log("MEDIA video", JSON.stringify({ bytes: megabytes, smallBytes: statSync(small).size, copied, edits: editTimes.length, editP95: percentile(editTimes),
            seek: bigSample.seek, smallSeek: smallSample.seek, smallGrowthKiB: smallSample.growthKiB, growthKiB: bigSample.growthKiB, middle }));
        assert.ok(copied > 0 && editTimes.length && percentile(editTimes) <= 50, "Concurrent edit threshold");
        assert.ok(bigSample.seek <= 1000 && middle, "Video midpoint seek threshold");
        assert.ok(result.open <= 500 && result.viewer <= 150 && scroll.p95 <= 20 && scroll.wheels >= 100 && scroll.distance > 0 && result.shift === 0, "Image thresholds");
        assert.deepEqual(errors, []);
        if (clipboardFailure) throw clipboardFailure;
    }
    finally {
        Object.assign(dialog, { showOpenDialog, showSaveDialog });
        win.destroy();
        startup.close();
        routes.commitEdit = edit;
    }

    async function drop(paths: string[]): Promise<void> {
        const devtools = contents.debugger;
        const input = await contents.executeJavaScript("window.mediaQA.dropInput()");
        const { root: document } = await devtools.sendCommand("DOM.getDocument");
        const { nodeId } = await devtools.sendCommand("DOM.querySelector", { nodeId: document.nodeId, selector: "#media-drop-input" });
        await devtools.sendCommand("DOM.setFileInputFiles", { nodeId, files: paths });
        assert.ok(input);
        await contents.executeJavaScript("window.mediaQA.dropFiles()");
    }

    async function capture(name: string): Promise<void> {
        const images = process.env.LABLOOM_MEDIA_SCREENSHOTS;
        if (!images) return;
        for (const theme of ["light", "dark"]) {
            await contents.executeJavaScript(`(async () => {
                const appearance = (await window.api.settings.get()).settings.appearance;
                await window.api.settings.update({ appearance: { ...appearance, theme: "${theme}" } });
                await new Promise(resolve => setTimeout(resolve, 100));
            })()`);
            const shot = await contents.capturePage();
            writeFileSync(join(images, name + "-" + theme + ".png"), shot.toPNG());
        }
    }
}

function percentile(values: number[]): number {
    return +(values.toSorted((a, b) => a - b)[Math.ceil(values.length * .95) - 1] ?? 0).toFixed(2);
}

void run().then(() => app.exit(0), error => {
    console.error(error);
    app.exit(1);
});