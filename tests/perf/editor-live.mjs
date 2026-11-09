// Attach to the isolated development app before opening its pinned 10,000-block page.
// The observer positions the caret and scrolls. All input samples must be trusted native keystrokes.
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1) throw new Error("Supply the isolated development app's debugging port");
const pages = await fetch("http://127.0.0.1:" + port + "/json/list").then(r => r.json());
const page = pages.find(p => p.type === "page" && p.url.startsWith("http://localhost:"));
if (!page) throw new Error("Development renderer not found");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
function observe() {
    const afterPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const output = data => console.info("LABLOOM_PERF " + JSON.stringify(data));
    const p = (a, q) => +a.toSorted((a, b) => a - b)[Math.ceil(a.length * q) - 1].toFixed(2);
    const watcher = new MutationObserver(() => {
        const dom = document.querySelector(".tiptap");
        if (dom?.children.length !== 10000 || !dom.editor) return;
        watcher.disconnect();
        void run(dom).catch(e => output({ error: String(e) }));
    });
    watcher.observe(document.body, { childList: true, subtree: true });
    async function run(dom) {
        const editor = dom.editor, mark = performance.getEntriesByName("labloom:page-read").at(-1);
        if (!mark) throw new Error("Missing page read mark");
        const mounted = performance.now();
        editor.view.focus();
        const height = dom.offsetHeight;
        await afterPaint();
        if (!editor.view.hasFocus() || !dom.isContentEditable) throw new Error("Page is not editable");
        output({ loadMs: +(performance.now() - mark.startTime).toFixed(2), mountMs: +(mounted - mark.startTime).toFixed(2), rows: dom.children.length, height });
        let viewport = dom.parentElement;
        while (viewport && !(/auto|scroll/u.test(getComputedStyle(viewport).overflowY) && viewport.scrollHeight > viewport.clientHeight)) viewport = viewport.parentElement;
        if (!viewport) throw new Error("Scroll container missing");
        let part = 0, current, samples = [];
        const spots = [1, 5000, 9999];
        function position() {
            const el = dom.children[spots[part]].querySelector("[data-body]");
            el.scrollIntoView({ block: "center", behavior: "instant" });
            editor.commands.setTextSelection(editor.view.posAtDOM(el, 0) + 1);
            editor.view.focus();
            output({ readyForKeys: spots[part] });
        }
        position();
        dom.addEventListener("keydown", e => {
            if (e.isTrusted && e.key === "x" && part < 3) {
                current = { ts: e.timeStamp, handling: performance.now() };
                samples.push(current);
            }
        }, true);
        editor.on("transaction", ({ transaction }) => {
            if (current && transaction.docChanged) current.transaction = performance.now();
        });
        dom.addEventListener("input", async e => {
            if (!current || !e.isTrusted) return;
            const s = current;
            s.input = performance.now();
            await afterPaint();
            s.paint = performance.now();
            if (samples.length < 20 || samples.some(a => a.paint === undefined || a.transaction === undefined)) return;
            const latency = samples.map(a => a.paint - a.ts);
            output({
                row: spots[part], n: samples.length, p50: p(latency, .5), p95: p(latency, .95), dispatchWait: p(samples.map(a => a.handling - a.ts), .95),
                nativeEdit: p(samples.map(a => a.input - a.handling), .95), transaction: p(samples.map(a => a.transaction - a.input), .95), paintWait: p(samples.map(a => a.paint - a.transaction), .95)
            });
            samples = [];
            current = undefined;
            part++;
            if (part < 3) position();
            else {
                const times = [];
                for (const index of [1, 5000, 9600]) {
                    dom.children[index].scrollIntoView({ block: "start", behavior: "instant" });
                    await afterPaint();
                    let prev = await frame();
                    for (let i = 0; i < 100; i++) {
                        viewport.scrollTop += 72;
                        const next = await frame();
                        times.push(next - prev);
                        prev = next;
                    }
                }
                output({ frames: times.length, fpsP5: p(times.map(t => 1000 / t), .05), worstFrame: Math.max(...times) });
            }
        }, true);
    }
}
ws.addEventListener("message", event => {
    const data = JSON.parse(event.data);
    if (data.result?.exceptionDetails) {
        console.error(data.result.exceptionDetails);
        process.exitCode = 1;
        ws.close();
    }
    if (data.method !== "Runtime.consoleAPICalled") return;
    for (const arg of data.params.args) {
        if (typeof arg.value !== "string" || !arg.value.startsWith("LABLOOM_PERF ")) continue;
        const record = JSON.parse(arg.value.slice("LABLOOM_PERF ".length));
        console.log(JSON.stringify(record));
        if (record.frames || record.error) ws.close();
    }
});
ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
ws.send(JSON.stringify({ id: 2, method: "Runtime.evaluate", params: { expression: "(" + observe.toString() + ")()" } }));
console.log("Observer ready. Open the pinned large page, then type 20 x at each position.");