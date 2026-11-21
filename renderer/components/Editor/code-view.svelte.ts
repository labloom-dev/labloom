import { mount, unmount } from "svelte";
import type { NodeViewRenderer } from "@tiptap/core";
import type { CodeLanguage } from "../../../shared/content/code-languages";
import { syntax, tokenizer, type HighlightResult } from "./code-highlight";
import { perform } from "../Knowledge/feedback.svelte";
import CodeTools from "./CodeTools.svelte";

export const codeView: NodeViewRenderer = ({ node: initial, view, getPos, editor }) => {
    let node = initial, language = $state<CodeLanguage | null>(node.attrs.language);
    const dom = document.createElement("section"), contentDOM = document.createElement("div"), controls = document.createElement("div");
    dom.spellcheck = false;
    dom.dataset.kind = "code"; dom.dataset.blockId = node.attrs.blockId;
    contentDOM.className = "code-content";
    controls.contentEditable = "false"; controls.className = "code-controls";
    dom.append(controls, contentDOM);
    const text = (atoms: boolean): string => node.content.content.map(line => line.textBetween(0, line.content.size, "", leaf =>
        atoms ? "\ufffc" : leaf.attrs.label ?? "")).join("\n");
    const component = mount(CodeTools, { target: controls, props: {
        get language() {
            return language;
        },
        writable: () => view.editable,
        restore: () => {
            if (!editor.isDestroyed) view.focus();
        },
        copy: () => {
            void perform(() => navigator.clipboard.writeText(text(false)));
        },
        choose: value => {
            const pos = getPos();
            if (pos !== undefined && view.editable && !view.composing) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: value }));
        }
    } });
    const pane = view.dom.closest<HTMLElement>("[data-tabs-content]") ?? window;
    let worker: ReturnType<typeof tokenizer> | undefined;
    let visible = false, queued = false, alive = true, version = 0, first = -1, last = -1, source = node;
    function receive(result: HighlightResult): void {
        const pos = getPos();
        if (!alive || result.version !== version || pos === undefined || view.state.doc.nodeAt(pos) !== node) return;
        view.dispatch(view.state.tr.setMeta(syntax, { start: pos + 2, end: pos + node.nodeSize - 2, tokens: result.tokens }));
    }
    function update(): void {
        queued = false;
        if (!alive || editor.isDestroyed || !visible) return;
        const line = contentDOM.firstElementChild;
        if (!line || !node.attrs.language) return;
        const rect = contentDOM.getBoundingClientRect(), viewport = pane instanceof HTMLElement ? pane.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
        const height = parseFloat(getComputedStyle(line).lineHeight);
        const a = Math.max(0, Math.floor((viewport.top - rect.top) / height) - 4), b = Math.max(a + 1, Math.ceil((viewport.bottom - rect.top) / height) + 4);
        if (source === node && a === first && b === last) return;
        source = node; first = a; last = b;
        worker ??= tokenizer(receive);
        worker.send({ version: ++version, language: node.attrs.language, text: text(true), first, last });
    }
    function schedule(): void {
        if (!queued) {
            queued = true; queueMicrotask(update);
        }
    }
    const observer = new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        if (visible) {
            pane.addEventListener("scroll", schedule, { passive: true }); schedule();
        }
        else pane.removeEventListener("scroll", schedule);
    });
    observer.observe(dom);
    const size = new ResizeObserver(schedule);
    size.observe(contentDOM);
    return { dom, contentDOM, ignoreMutation: mutation => mutation.type !== "selection" && (mutation.target === dom || controls.contains(mutation.target)),
        stopEvent: event => event.target instanceof globalThis.Node && controls.contains(event.target),
        update(next) {
            if (next.type !== node.type || next.attrs.blockId !== node.attrs.blockId) return false;
            if (next !== node) {
                version++; node = next; language = next.attrs.language;
                if (!language) {
                    worker?.close(); worker = undefined; first = -1;
                    const current = version; queueMicrotask(() => {
                        if (alive) receive({ id: 0, version: current, tokens: [] });
                    });
                }
                else schedule();
            }
            return true;
        },
        destroy() {
            alive = false; observer.disconnect(); size.disconnect(); pane.removeEventListener("scroll", schedule);
            worker?.close(); void unmount(component);
        }
    };
};