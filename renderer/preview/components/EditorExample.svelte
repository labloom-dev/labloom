<div class="editor-example editor-canvas" role="presentation" onpointerover={hover} onpointerleave={() => hoverLink(null)}>
    <div class="editor-column" bind:this={host} {@attach documentLabels}></div>
</div>
<span hidden bind:this={glyph}><Icon name="link-external" size="1em" /></span>
{#if preview}
    <ReferencePreview anchor={preview}><ReferenceCard kind="page" {value} onopen={openExcerpt} /></ReferencePreview>
{/if}

{#if editor}
    <Toolbar {editor} {history} dirty={false} />
    <EditorControls {editor} />
{/if}

<script lang="ts">
    import { mount, onMount, unmount } from "svelte";
    import { Editor, Extension } from "@tiptap/core";
    import History from "@tiptap/extension-history";
    import Icon from "../../components/utils/Icon.svelte";
    import ReferenceCard from "../../components/Editor/ReferenceCard.svelte";
    import ReferencePreview from "../../components/Editor/ReferencePreview.svelte";
    import { indexDoc } from "../../components/Editor/document";
    import { backlinkRow, documentLabels, documentViews } from "../../components/Editor/document-view.svelte";
    import { borderPlugin } from "../../components/Editor/sync-border";
    import { editing } from "../../components/Editor/transactions";
    import Backlinks from "../../components/Knowledge/Backlinks.svelte";
    import Toolbar from "../../components/Editor/Toolbar.svelte";
    import EditorControls from "./EditorControls.svelte";
    import { exampleLinks, emptyId, protocol, sampleDocument, sharedId } from "./editor-page";

    let { focusOnOpen = false }: { focusOnOpen?: boolean } = $props();
    let host: HTMLDivElement, glyph: HTMLSpanElement, editor = $state.raw<Editor>();
    let history = $state({ canUndo: false, canRedo: false });
    let preview = $state.raw<HTMLElement | null>(null);
    let timer: ReturnType<typeof setTimeout> | undefined, hovered: HTMLElement | null = null;
    const value = { title: protocol.title, text: protocol.text, status: "ok" } as const;

    function openExcerpt(): void {
        if (!editor) return;
        const excerpt = indexDoc(editor.state.doc).get(protocol.excerptId)?.[0];
        if (excerpt) editor.chain().focus().setTextSelection(excerpt.pos + 2).scrollIntoView().run();
    }
    function hoverLink(link: HTMLElement | null): void {
        if (link === hovered) return;
        clearTimeout(timer);
        hovered = link;
        preview = null;
        if (link) timer = setTimeout(() => {
            preview = link;
        }, 300);
    }
    function hover(event: PointerEvent): void {
        hoverLink(event.target instanceof Element ? event.target.closest<HTMLElement>(".inline-reference") : null);
    }

    onMount(() => {
        const links = document.createElement("div");
        const backlinks = mount(Backlinks, { target: links, props: { links: exampleLinks, onopen: openExcerpt } });
        const views = documentViews(glyph.firstElementChild!, (element, target) => {
            const card = mount(ReferenceCard, { target: element, props: { kind: target.kind, value, onopen: openExcerpt } });
            return () => {
                void unmount(card);
            };
        });
        editor = new Editor({
            element: host, content: sampleDocument(),
            extensions: [...views, History, editing, Extension.create({
                name: "samplePage",
                addProseMirrorPlugins: () => [
                    borderPlugin(() => ({ [sharedId]: 2 })),
                    backlinkRow(links, () => true)
                ]
            })],
            onTransaction: ({ editor: instance }) => {
                history = { canUndo: instance.can().undo(), canRedo: instance.can().redo() };
            },
            editorProps: {
                attributes: { class: "editor-document", "aria-label": "编辑器排版样例" },
                handleClickOn: (_view, _pos, node, _nodePos, _event, direct) => {
                    if (!direct || node.type.name !== "inlineReference") return false;
                    openExcerpt();
                    return true;
                }
            }
        });
        editor.commands.setTextSelection(indexDoc(editor.state.doc).get(emptyId)![0].pos + 2);
        if (focusOnOpen) editor.view.focus();
        return () => {
            clearTimeout(timer);
            editor?.destroy();
            void unmount(backlinks);
        };
    });
</script>

<style>
    .editor-example { border: var(--ui-stroke) solid var(--ui-divider); border-radius: var(--ui-radius-panel); }
</style>