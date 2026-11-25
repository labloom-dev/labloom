import { Extension, type Extensions, type NodeViewRenderer } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMSerializer } from "@tiptap/pm/model";
import type { Target } from "../../../shared/types/content";
import { t } from "../../i18n.svelte";
import { codeView } from "./code-view.svelte";
import { syntaxPlugin } from "./code-highlight";
import { codeBlock, documentExtensions, inlineReference, mediaBlock, referenceBlock } from "./document";
import "./document.css";

// Only the title and the current textblock can show a placeholder.
const placeholders = Extension.create({
    name: "documentPlaceholders",
    addProseMirrorPlugins: () => [new Plugin({ props: {
        decorations({ doc, selection }) {
            const nodes: Decoration[] = [];
            const title = doc.firstChild!;
            if (!title.content.size) nodes.push(Decoration.node(0, title.nodeSize, { class: "empty-field" }));
            const from = selection.$from;
            if (selection.empty && (from.parent.type.name === "blockBody" || from.parent.type.name === "codeLine" && from.node(-1).childCount === 1) && !from.parent.content.size) {
                const caption = from.node(-1).type.name === "mediaBlock";
                nodes.push(Decoration.node(from.before(), from.after(), { class: caption ? "media-caption-active" : "empty-field" }));
            }
            return nodes.length ? DecorationSet.create(doc, nodes) : DecorationSet.empty;
        }
    } })]
});

export function documentLabels(element: HTMLElement): void {
    $effect(() => {
        element.style.setProperty("--editor-untitled", JSON.stringify(t("shell.untitled")));
        element.style.setProperty("--editor-write", JSON.stringify(t("editor.write")));
        element.style.setProperty("--editor-reference", JSON.stringify(t("block.blocked_reference")));
        element.style.setProperty("--editor-missing", JSON.stringify(t("editor.missingReference")));
    });
}

export function documentViews(glyph: Element, mountCard: (element: HTMLElement, target: Target) => () => void, mediaView?: NodeViewRenderer): Extensions {
    const label = (): string => t("block.blocked_reference");
    const link = inlineReference.configure({ label,
        nodeView: ({ node }) => {
            // Keep the serialized clipboard text while displaying the same Icon as the shell.
            const dom = DOMSerializer.fromSchema(node.type.schema).serializeNode(node.mark([])) as HTMLElement;
            dom.replaceChildren(glyph.cloneNode(true), " ", node.attrs.label);
            if (!node.attrs.label) dom.dataset.emptyLabel = "";
            return { dom };
        }
    });
    const card = referenceBlock.configure({ label,
        nodeView: ({ node }) => {
            const dom = document.createElement("div");
            dom.dataset.kind = "blocked_reference";
            dom.dataset.blockId = node.attrs.blockId;
            dom.contentEditable = "false";
            const destroy = node.attrs.target ? mountCard(dom, node.attrs.target) : undefined;
            if (!destroy) {
                dom.className = "reference-card missing";
                dom.dataset.missingTarget = "";
            }
            return { dom, destroy, stopEvent: event => event.target instanceof Element && !!event.target.closest("button") };
        }
    });
    const code = codeBlock.configure({ nodeView: codeView });
    const highlighting = Extension.create({ name: "syntaxHighlighting", addProseMirrorPlugins: () => [syntaxPlugin(), new Plugin({ props: { decorations(state) {
        const at = state.selection.$head;
        for (let d = at.depth; d > 0; d--) if (at.node(d).type.name === "codeBlock")
            return DecorationSet.create(state.doc, [Decoration.node(at.before(d), at.after(d), { class: "code-active" })]);
        return null;
    } } })] });
    const views = [code, card, link, mediaBlock.configure({ nodeView: mediaView ?? null })];
    return [...documentExtensions.map(extension => views.find(view => view.name === extension.name) ?? extension), placeholders, highlighting];
}

// A single non-editable widget between the title and the first body block. It has no document position of its own.
export function backlinkRow(element: HTMLElement, visible: () => boolean): Plugin {
    return new Plugin({ props: { decorations: state => visible() ? DecorationSet.create(state.doc, [
        Decoration.widget(state.doc.firstChild!.nodeSize, element, { key: "backlinks", side: -1, stopEvent: () => true, ignoreSelection: true })
    ]) : DecorationSet.empty } });
}