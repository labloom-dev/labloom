import type { WebContents } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

type TraceEvent = { pid: number; tid: number; name: string; ph: string; ts: number; dur?: number; args?: { data?: { type?: string } } };
const p95 = (values: number[]): number => +values.sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1].toFixed(1);

// The input goes through Chromium's native wheel path. The passive listener lets tracing
// associate actual renderer input dispatch with the end of its main-thread render frame.
async function scrollGrid(): Promise<{ intervals: number[]; wheels: number; distance: number }> {
    const grid = document.querySelector<HTMLElement>("[data-tabs-content]:not([hidden]) .library-grid")!;
    const box = grid.getBoundingClientRect(), before = grid.scrollTop;
    const frame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve));
    let wheels = 0;
    const observed = (event: WheelEvent): void => {
        if (event.isTrusted) wheels++;
    };
    grid.addEventListener("wheel", observed, { passive: true });
    const intervals: number[] = [];
    try {
        performance.mark("library-wheel-start");
        console.info("LIBRARY_WHEEL " + Math.round(box.left + box.width / 2) + " " + Math.round(box.top + box.height / 2));
        let previous = await frame();
        for (let i = 0; i < 150; i++) {
            const now = await frame();
            intervals.push(now - previous);
            previous = now;
        }
    }
    finally {
        console.info("LIBRARY_WHEEL stop");
        performance.mark("library-wheel-end");
        grid.removeEventListener("wheel", observed);
    }
    await frame();
    await frame();
    return { intervals, wheels, distance: (grid.scrollTop - before) / grid.clientHeight };
}

export async function measureWheel(wc: WebContents, view: string): Promise<{ scroll: number; wheelWork: number }> {
    const events: TraceEvent[] = [];
    let complete!: () => void, timer: ReturnType<typeof setInterval> | undefined;
    const done = new Promise<void>(resolve => complete = resolve);
    const trace = (_: Electron.Event, method: string, params: { value: TraceEvent[] }): void => {
        if (method === "Tracing.dataCollected") events.push(...params.value);
        if (method === "Tracing.tracingComplete") complete();
    };
    const input = (event: Electron.WebContentsConsoleMessageEventParams): void => {
        if (!event.message.startsWith("LIBRARY_WHEEL ")) return;
        clearInterval(timer);
        const [, x, y] = event.message.split(" ").map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) timer = setInterval(() => {
            wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY: -144, canScroll: true });
        }, 16);
    };
    wc.debugger.on("message", trace);
    wc.on("console-message", input);
    try {
        await wc.debugger.sendCommand("Tracing.start", { categories: "cc,devtools.timeline,blink.user_timing", transferMode: "ReportEvents" });
        const result: Awaited<ReturnType<typeof scrollGrid>> = await wc.executeJavaScript(`(${scrollGrid.toString()})()`);
        await wc.debugger.sendCommand("Tracing.end");
        await done;
        if (result.wheels < 50 || result.distance < 1) throw Error("Too few native wheel events or too little scroll travel");
        const before = events.find(e => e.name === "library-wheel-start")!, after = events.find(e => e.name === "library-wheel-end")!;
        const main = events.filter(e => e.pid === before.pid && e.tid === before.tid && e.ph === "X" && e.ts >= before.ts);
        const ends = main.filter(e => e.name === "ProxyMain::BeginMainFrame").map(e => e.ts + e.dur!).sort((a, b) => a - b);
        const work = main.filter(e => e.name === "EventDispatch" && e.args?.data?.type === "wheel" && e.ts <= after.ts).map(e => {
            const end = ends.find(time => time >= e.ts + e.dur!);
            if (end === undefined) throw Error("Missing frame after wheel dispatch");
            return (end - e.ts) / 1000;
        });
        if (work.length !== result.wheels) throw Error("Incomplete renderer wheel trace: " + work.length + "/" + result.wheels);
        const path = process.env.LABLOOM_LIBRARY_TRACE;
        if (path) writeFileSync(join(path, view + ".json"), JSON.stringify({ traceEvents: events }));
        return { scroll: p95(result.intervals), wheelWork: p95(work) };
    }
    finally {
        clearInterval(timer);
        wc.off("console-message", input);
        wc.debugger.off("message", trace);
    }
}