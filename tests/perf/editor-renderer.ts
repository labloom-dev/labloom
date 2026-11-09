import { Editor, Node, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { type PageRecord } from "../../shared/types/content";
import "./editor.css";

declare global {
    interface Window {
        prototypeBench: { read(): Promise<PageRecord>; report(measurement: unknown): void };
    }
}

const title = Node.create({ name: "pageTitle", content: "inline*", addAttributes: () => ({ blockId: {} }),
    renderHTML: ({ node }) => ["h1", { "data-block-id": node.attrs.blockId }, 0] });
const paragraph = Node.create({ name: "blockBody", content: "inline*", renderHTML: () => ["p", 0] });
const block = Node.create({ name: "pageBlock", content: "blockBody pageBlock*", addAttributes: () => ({ blockId: {}, kind: {} }),
    renderHTML: ({ node }) => ["section", { "data-block-id": node.attrs.blockId, "data-kind": node.attrs.kind }, 0] });

const viewport = document.querySelector<HTMLElement>("#viewport")!, status = document.querySelector<HTMLElement>("#status")!;
const start = document.querySelector<HTMLButtonElement>("#start")!;
const frame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve));
const afterPaint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
const round = (value: number): number => Math.round(value * 100) / 100;
function percentile(values: number[], fraction: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return round(sorted[Math.ceil(sorted.length * fraction) - 1]);
}

async function run(): Promise<void> {
    start.disabled = true;
    await document.fonts.ready;
    const page = await window.prototypeBench.read();
    const begin = performance.now();
    const row = (id: string): JSONContent => {
        const b = page.blocks[id];
        return { type: "pageBlock", attrs: { blockId: id, kind: b.type }, content: [{ type: "blockBody", content: b.payload.inline }, ...b.children.map(row)] };
    };
    const content: JSONContent = { type: "doc", content: [{ type: "pageTitle", attrs: { blockId: page.titleBlockId }, content: page.blocks[page.titleBlockId].payload.inline }, ...page.children.map(row)] };
    const converted = performance.now();
    const editor = new Editor({ element: document.querySelector("#editor")!, extensions: [Document.extend({ content: "pageTitle pageBlock*" }), title, block, paragraph, Text], content, editable: true });
    const mounted = performance.now();
    editor.view.focus();
    const height = editor.view.dom.offsetHeight;
    const laidOut = performance.now();
    await afterPaint();
    const ready = performance.now();
    if (!editor.view.hasFocus() || !editor.view.dom.isContentEditable || editor.view.dom.children.length !== 10000) throw new Error("The complete document must be focused and editable");
    window.prototypeBench.report({ loadMs: round(ready - begin), convertMs: round(converted - begin), mountMs: round(mounted - converted),
        focusAndLayoutMs: round(laidOut - mounted), paintWaitMs: round(ready - laidOut), renderedRows: editor.view.dom.children.length, height });
    const sections = [1, 5000, 9999], names = ["开头", "中间", "末尾"];
    let section = 0;
    type Sample = { ts: number; handling: number; input?: number; transaction?: number; painted?: number };
    const samples: Sample[] = [];
    let current: Sample | undefined;
    function position(): void {
        const el = editor.view.dom.children[sections[section]].querySelector("p")!;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        editor.commands.setTextSelection(editor.view.posAtDOM(el, 0) + 1);
        editor.view.focus();
        status.textContent = names[section] + "，请间隔输入 20 次 x";
    }
    position();
    editor.view.dom.addEventListener("keydown", event => {
        if (!event.isTrusted || event.key !== "x" || section >= sections.length) return;
        current = { ts: event.timeStamp, handling: performance.now() };
        samples.push(current);
    }, true);
    editor.on("transaction", ({ transaction }) => {
        if (transaction.docChanged && current) current.transaction = performance.now();
    });
    editor.view.dom.addEventListener("input", event => {
        if (!event.isTrusted || !current) return;
        const sample = current;
        sample.input = performance.now();
        void afterPaint().then(() => {
            if (sample.transaction === undefined) throw new Error("Native input produced no document transaction");
            sample.painted = performance.now();
            if (samples.length < 20 || samples.some(s => s.painted === undefined)) return;
            const times = samples.map(s => s.painted! - s.ts);
            window.prototypeBench.report({ position: names[section], count: samples.length, inputP50: percentile(times, .5), inputP95: percentile(times, .95),
                dispatchWaitP95: percentile(samples.map(s => s.handling - s.ts), .95), nativeEditP95: percentile(samples.map(s => s.input! - s.handling), .95),
                transactionP95: percentile(samples.map(s => s.transaction! - s.input!), .95), paintWaitP95: percentile(samples.map(s => s.painted! - s.transaction!), .95) });
            samples.length = 0;
            current = undefined;
            section++;
            if (section < sections.length) position();
            else void scroll();
        });
    }, true);
    async function scroll(): Promise<void> {
        status.textContent = "正在测量连续滚动";
        const durations: number[] = [];
        for (const row of [1, 5000, 9600]) {
            editor.view.dom.children[row].scrollIntoView({ block: "start", behavior: "instant" });
            await afterPaint();
            let previous = await frame();
            for (let i = 0; i < 100; i++) {
                viewport.scrollTop += 72;
                const next = await frame();
                durations.push(next - previous);
                previous = next;
            }
        }
        const fps = durations.map(ms => 1000 / ms);
        window.prototypeBench.report({ scrollFrames: fps.length, fpsP5: percentile(fps, .05), fpsP50: percentile(fps, .5), worstFrameMs: round(Math.max(...durations)) });
        status.textContent = "测量完成";
    }
}

start.addEventListener("click", () => void run().catch(error => {
    status.textContent = String(error);
    window.prototypeBench.report({ error: String(error) });
}));