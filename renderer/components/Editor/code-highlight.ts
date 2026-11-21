import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { CodeLanguage } from "../../../shared/content/code-languages";

export type Token = [from: number, to: number, style: string];
export type HighlightRequest = { id: number; version: number; language: CodeLanguage; text: string; first: number; last: number };
export type HighlightResult = { id: number; version: number; tokens: Token[] };
export const syntax = new PluginKey<DecorationSet>("codeSyntax");
export function syntaxPlugin(): Plugin {
    return new Plugin({ key: syntax, state: {
        init: () => DecorationSet.empty,
        apply(tr, previous) {
            let next = previous.map(tr.mapping, tr.doc);
            const update = tr.getMeta(syntax) as { start: number; end: number; tokens: Token[] } | undefined;
            if (update) {
                next = next.remove(next.find(update.start, update.end));
                next = next.add(tr.doc, update.tokens.map(([from, to, style]) => Decoration.inline(update.start + from, update.start + to, { class: "syntax-" + style })));
            }
            return next;
        }
    }, props: { decorations: state => syntax.getState(state) } });
}
let worker: Worker | undefined, serial = 0;
const listeners = new Map<number, (value: HighlightResult) => void>();
export function tokenizer(receive: (value: HighlightResult) => void): { send: (input: Omit<HighlightRequest, "id">) => void; close: () => void } {
    const id = ++serial;
    if (!worker) {
        worker = new Worker(new URL("./code-worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<HighlightResult>) => listeners.get(event.data.id)?.(event.data);
    }
    listeners.set(id, receive);
    return {
        send: input => worker!.postMessage({ ...input, id }),
        close: () => {
            listeners.delete(id);
            if (listeners.size) worker?.postMessage({ id, close: true });
            else {
                worker?.terminate(); worker = undefined;
            }
        }
    };
}