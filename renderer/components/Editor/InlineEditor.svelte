<div class="inline-editor" class:code={codeBlock} bind:this={element}></div>
<Toolbar {editor} />
{#if preview}
    <div class="inline-preview">
        <ReferenceView target={preview} />
        <button onclick={() => preview = null}>关闭预览</button>
    </div>
{/if}

<style>
    .inline-editor { min-width: 0; width: 100%; }
    .inline-editor :global(.tiptap) { outline: none; padding: 3px 0; min-height: 1.8em; font-size: inherit; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
    .inline-editor :global(.inline-reference) { color: var(--dc-c-fg-blue); border-bottom: 1px dashed currentColor; cursor: pointer; }
    .code :global(.tiptap) { font-family: monospace; tab-size: 4; }
    .inline-preview { font-weight: normal; font-size: 12px; }
    .inline-preview > button { margin: 6px 0; color: var(--c-muted); }
    .inline-editor :global(.tiptap:empty)::before, .inline-editor :global(.tiptap:has(> br:only-child))::before { content: attr(data-placeholder); color: var(--c-muted); opacity: .7; pointer-events: none; }
</style>

<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { Editor, Node } from "@tiptap/core";
    import Document from "@tiptap/extension-document";
    import Text from "@tiptap/extension-text";
    import History from "@tiptap/extension-history";
    import { type InlineNode, type Target } from "../../../shared/types/content";
    import { type HistoryState } from "../../../shared/types/knowledge";
    import Toolbar from "./Toolbar.svelte";
    import bold from "./extensions/mark/bold";
    import italic from "./extensions/mark/italic";
    import underline from "./extensions/mark/underline";
    import strike from "./extensions/mark/strike";
    import bgColor from "./extensions/mark/bgColor";
    import fgColor from "./extensions/mark/fgColor";
    import code from "./extensions/mark/code";
    import ReferenceView from "../Knowledge/ReferenceView.svelte";

    let { inline, readonly = false, codeBlock = false, placeholder = "", history, onchange, onsplit, onhistory, oncomposition }: {
        inline: InlineNode[]; readonly?: boolean; codeBlock?: boolean; placeholder?: string; history: HistoryState;
        onchange: (value: InlineNode[]) => void; onsplit?: (before: InlineNode[], after: InlineNode[]) => void;
        onhistory: (direction: "undo" | "redo") => void; oncomposition?: (active: boolean) => void;
    } = $props();
    let element: HTMLDivElement;
    let editor = $state.raw<Editor | null>(null);
    let composing = false;
    let preview = $state<Target | null>(null);
    const br = Node.create({ name: "hardBreak", inline: true, group: "inline", selectable: false, parseHTML: () => [{ tag: "br" }], renderHTML: () => ["br"] });
    const reference = Node.create({ name: "inlineReference", inline: true, group: "inline", atom: true,
        addAttributes: () => ({ target: { default: null }, label: { default: "引用" } }),
        parseHTML: () => [],
        renderHTML: ({ node }) => ["span", { class: "inline-reference", "data-reference-id": node.attrs.target?.id, "data-reference-kind": node.attrs.target?.kind }, `↗ ${node.attrs.label}`]
    });
    onMount(() => {
        const workspaceHistory = History.extend({
            addProseMirrorPlugins: () => [],
            addCommands: () => ({
                undo: () => ({ dispatch }) => {
                    if (dispatch) {
                        onhistory("undo");
                        return true;
                    }
                    return history.canUndo;
                },
                redo: () => ({ dispatch }) => {
                    if (dispatch) {
                        onhistory("redo");
                        return true;
                    }
                    return history.redo.length > 0;
                }
            })
        });
        const instance = new Editor({ element, extensions: [Document.extend({ content: "inline*" }), Text, br, reference, workspaceHistory, bold, italic, underline, strike, bgColor, fgColor, code],
            content: { type: "doc", content: inline }, editable: !readonly,
            editorProps: {
                attributes: { "data-placeholder": placeholder },
                handleKeyDown: (_view, event) => {
                    if (event.key === "Enter" && !event.isComposing) {
                        if (event.shiftKey || !onsplit || codeBlock) instance.commands.insertContent({ type: "hardBreak" });
                        else {
                            const { from, to } = instance.state.selection;
                            onsplit(instance.state.doc.cut(0, from).toJSON().content ?? [], instance.state.doc.cut(to).toJSON().content ?? []);
                        }
                        return true;
                    }
                    return false;
                },
                handleDOMEvents: {
                    compositionstart: () => {
                        composing = true;
                        oncomposition?.(true);
                        return false;
                    },
                    compositionend: () => {
                        composing = false;
                        queueMicrotask(() => {
                            onchange(instance.getJSON().content as InlineNode[] ?? []);
                            oncomposition?.(false);
                        });
                        return false;
                    },
                    click: (_view, event) => {
                        const node = (event.target as HTMLElement).closest<HTMLElement>("[data-reference-id]");
                        if (node?.dataset.referenceKind === "page" || node?.dataset.referenceKind === "block") {
                            preview = { kind: node.dataset.referenceKind, id: node.dataset.referenceId! };
                            return true;
                        }
                        return false;
                    }
                }
            },
            onUpdate: () => {
                if (!composing) onchange(instance.getJSON().content as InlineNode[] ?? []);
            }
        });
        editor = instance;
        return () => {
            if (composing) oncomposition?.(false);
            instance.destroy();
        };
    });
    $effect(() => {
        const current = editor, value = inline;
        if (current && !current.isDestroyed && JSON.stringify(current.getJSON().content ?? []) !== JSON.stringify(value)) current.commands.setContent({ type: "doc", content: value }, { emitUpdate: false });
    });
    $effect(() => {
        const current = editor, editable = !readonly;
        if (current && current.isEditable !== editable) untrack(() => current.setEditable(editable, false));
    });
</script>