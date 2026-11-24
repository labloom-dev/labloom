import { app, BrowserWindow, type WebContents } from "electron";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { registerIPCs } from "../../main/register";
import { attach } from "../../main/ui/windowFrame";
import { update } from "../../main/workspace-settings";
import { session, startupServices } from "../support/session";
import { fixture } from "./fixture";
import { seedLibrary } from "./library-fixture";
import { seedFeed, seedOverviewTasks } from "./feed-fixture";
import { checkFeedPaperState, keyFrames, measureFeed, renameUnrelatedPaper } from "./feed-check";
import { measureWheel } from "./library-wheel";

const root = process.env.LABLOOM_TEST_ROOT!;
app.setPath("userData", join(root, "chromium"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.on("window-all-closed", () => { /* The benchmark controls its lifetime. */ });

type TraceEvent = { pid: number; tid: number; name: string; ph: string; ts: number; dur?: number; args?: { data?: { type?: string } } };
const p95 = (values: number[]): number => +values.sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1].toFixed(1);

async function measureKeys(wc: WebContents): Promise<{ keyboard: number; keyWork: number; keyMax: number; item: string }> {
    const events: TraceEvent[] = [];
    let finish!: () => void, input: ReturnType<typeof setInterval> | undefined, repeat: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<void>(resolve => finish = resolve);
    const trace = (_: Electron.Event, method: string, params: { value: TraceEvent[] }): void => {
        if (method === "Tracing.dataCollected") events.push(...params.value);
        if (method === "Tracing.tracingComplete") finish();
    };
    const send = (event: Electron.WebContentsConsoleMessageEventParams): void => {
        if (event.message === "FEED_KEYS start") {
            wc.sendInputEvent({ type: "keyDown", keyCode: "Down" });
            repeat = setTimeout(() => input = setInterval(() => {
                wc.sendInputEvent({ type: "keyDown", keyCode: "Down", modifiers: ["isAutoRepeat"] });
            }, 16), 350);
        }
        else if (event.message === "FEED_KEYS stop") {
            clearTimeout(repeat);
            clearInterval(input);
            wc.sendInputEvent({ type: "keyUp", keyCode: "Down" });
        }
    };
    wc.debugger.on("message", trace);
    wc.on("console-message", send);
    try {
        await wc.debugger.sendCommand("Tracing.start", { categories: "cc,devtools.timeline,blink.user_timing", transferMode: "ReportEvents" });
        const result: Awaited<ReturnType<typeof keyFrames>> = await wc.executeJavaScript(`(${keyFrames.toString()})()`);
        await wc.debugger.sendCommand("Tracing.end");
        await done;
        const start = events.find(event => event.name === "feed-keys-start")!, end = events.find(event => event.name === "feed-keys-end")!;
        const frames = events.filter(event => event.pid === start.pid && event.tid === start.tid && event.ph === "X" && event.ts >= start.ts);
        const work = frames.filter(event => event.name === "EventDispatch" && event.args?.data?.type === "keydown" && event.ts <= end.ts)
            .map(event => event.dur! / 1000);
        if (result.keys < 50 || work.length !== result.keys || !result.chosen) throw Error("Native keyboard trace is incomplete");
        const output = process.env.LABLOOM_FEED_CAPTURE;
        if (output) writeFileSync(join(output, "keyboard.json"), JSON.stringify({ traceEvents: events }));
        return { keyboard: p95(result.frames), keyWork: p95(work), keyMax: +Math.max(...work).toFixed(2), item: result.chosen };
    }
    finally {
        clearTimeout(repeat);
        clearInterval(input);
        wc.off("console-message", send);
        wc.debugger.off("message", trace);
    }
}

async function run(): Promise<void> {
    const data = fixture();
    seedLibrary(data.sql);
    seedOverviewTasks(data.sql);
    seedFeed(data.sql);
    const recent = data.sql.prepare("SELECT id FROM pages WHERE kind='editable' ORDER BY id LIMIT 50").pluck().all() as string[];
    update({ recentPages: recent.map((id, i) => ({ id, openedAt: Date.UTC(2026, 10, 24) - i * 60000 })) });
    const directory = dirname(data.sql.name);
    session.close();
    const startup = startupServices(join(root, "profile"));
    startup.restore();
    if (startup.choose(directory, "open").status !== "ready") throw Error("Benchmark workspace unavailable");
    const win = new BrowserWindow({ show: false, width: 1440, height: 900, titleBarStyle: "hidden", titleBarOverlay: true,
        webPreferences: { preload: join(root, "preload.cjs"), offscreen: true, backgroundThrottling: false, sandbox: true } });
    try {
        const wc = win.webContents;
        const errors: string[] = [], reads: string[] = [], checkedCalls: string[] = [];
        let checkCalls = false;
        const handle = wc.ipc.handle.bind(wc.ipc);
        wc.ipc.handle = (channel, handler) => handle(channel, (context, ...args) => {
            if (channel === "feed:get-item") reads.push(args[0] as string);
            if (checkCalls && channel.startsWith("feed:")) checkedCalls.push(channel);
            return handler(context, ...args);
        });
        wc.setFrameRate(60);
        wc.session.webRequest.onBeforeRequest({ urls: ["https://feeds.example.test/*"] }, (_, callback) => callback({ cancel: true }));
        wc.on("console-message", event => {
            if (event.level === "error" && !event.message.includes("ERR_BLOCKED_BY_CLIENT")) {
                errors.push(event.message);
                console.error(event.message);
            }
        });
        registerIPCs(win, attach(win));
        await win.loadURL(process.env.LABLOOM_BENCH_URL!);
        wc.debugger.attach();
        await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        async function checkPaperState(): Promise<void> {
            await wc.executeJavaScript(`(${checkFeedPaperState.toString()})()`);
            const unrelated = session.getNative().prepare(`SELECT p.id FROM pages p WHERE p.kind='paper'
                AND NOT EXISTS (SELECT 1 FROM feed_items i WHERE i.paper_id=p.id) LIMIT 1`).pluck().get();
            if (!unrelated) throw Error("Missing unrelated paper fixture");
            checkCalls = true;
            await wc.executeJavaScript(`(${renameUnrelatedPaper.toString()})(${JSON.stringify(unrelated)})`);
            if (checkedCalls.length) throw Error("An unrelated paper edit called feed APIs: " + checkedCalls.join(", "));
            if (errors.length) throw Error(errors.join("\n"));
            console.log("Feed paper-state workflow passed (trash, restore, undo, purge and zero feed calls for an unrelated edit)");
        }
        if (process.argv.includes("paper-state")) {
            await checkPaperState();
            return;
        }
        const workflow = process.env.LABLOOM_FEED_WORKFLOW;
        if (workflow) {
            const { readFileSync } = await import("node:fs");
            const capture = process.env.LABLOOM_FEED_CAPTURE;
            wc.on("console-message", event => {
                const name = /^FEED_CAPTURE ([a-z-]+)$/u.exec(event.message)?.[1];
                if (name) {
                    const saved = capture ? wc.capturePage().then(image => writeFileSync(join(capture, name + ".png"), image.toPNG())) : Promise.resolve();
                    void saved.then(() => wc.executeJavaScript("window.__feedCaptured?.()"));
                }
                const width = /^FEED_RESIZE (\d+)$/u.exec(event.message)?.[1];
                if (width) void wc.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { width: Number(width), height: 900, deviceScaleFactor: 1, mobile: false });
            });
            await wc.executeJavaScript(readFileSync(workflow, "utf8"));
            if (errors.length) throw Error(errors.join("\n"));
            console.log("Feed workflow passed");
            return;
        }
        const results = await wc.executeJavaScript(`(${measureFeed.toString()})()`);
        console.log("FEED_UI", JSON.stringify(results));
        reads.length = 0;
        const { item, ...keys } = await measureKeys(wc);
        await new Promise(resolve => setTimeout(resolve, 400));
        const opened = session.getNative().prepare("SELECT is_read FROM feed_items WHERE id=?").pluck().get(item);
        if (!opened || reads.some(id => id !== item) || !reads.length) throw Error("Continuous navigation opened a passed article: " + JSON.stringify(reads));
        const wheel = await measureWheel(wc, "feed", "[data-tabs-content]:not([hidden]) .feed-view .virtual-list");
        console.log("FEED", JSON.stringify({ ...results, ...keys, ...wheel }));
        await checkPaperState();
        if (results.first > 200 || results.overview > 200 || results.scope > 300 || results.filter > 300 || results.order > 300
            || results.search > 300 || results.reader > 150 || keys.keyboard > 20 || keys.keyMax > 8 || wheel.scroll > 20 || wheel.wheelWork > 8 || wheel.wheelHandlerMax > 8) {
            throw Error("Feed performance threshold exceeded");
        }
    }
    finally {
        win.destroy();
        startup.close();
    }
}

void app.whenReady().then(async () => {
    const timeout = setTimeout(() => {
        console.error("Feed benchmark timed out");
        app.exit(1);
    }, 240000);
    await run();
    clearTimeout(timeout);
    app.exit(0);
}).catch(cause => {
    console.error(cause);
    app.exit(1);
});