<div class="editor">
    <div class="no-shrink" style={`width: ${panelWidth}px;`}>
        <SidePanel />
    </div>
    <Resizer {changeCB} direction="vertical" origin={panelWidth} min={50} max={300} />
    <div class="content" spellcheck="false">
        <Toolbar {editor} />
        <div bind:this={element}></div>
    </div>
</div>


<style>
    .editor {
        display: flex;
        flex-flow: row nowrap;
        height: 100%;
        width: 100%;
        flex-shrink: 0;
    }
    .content {
        container-type: size;
        flex: 1;
        min-height: 0;
        overflow-x: clip;
        overflow-y: auto;
        color: var(--dc-c-fg-default);
        background-color: var(--dc-c-bg-default);
    }
    .no-shrink {
        flex-shrink: 0;
    }
    :global(*[contenteditable]:not([contenteditable="false"])) {
        -webkit-user-modify: read-write-plaintext-only;

        & * {
            white-space: pre-wrap;
            word-wrap: normal;
            word-break: break-word;
            overflow-wrap: break-word;
        }
    }
    :global(.tiptap.ProseMirror) {
        min-height: 100%;
        width: 100%;
        display: flex;
        flex-flow: column nowrap;
        gap: .125em;
        padding: 16px 48px 20cqh;
    }
    :global(.dc-paragraph.dc-empty) {
        position: relative;
    }
    :global(.dc-paragraph.dc-empty)::after {
        content: "输入 / 发起命令...";
        color: grey;
        display: block;
        position: absolute;
        top: var(--dc-p-padding-block);
        left: var(--dc-p-padding-inline);
        pointer-events: none;
    }
</style>


<script lang="ts">
    import { onMount } from "svelte";
    import { Editor } from "@tiptap/core";
    import Toolbar from "./Toolbar.svelte";
    import SidePanel from "../utils/SidePanel.svelte";
    import Resizer from "../utils/Resizer.svelte";

    import History from "@tiptap/extension-history";
    import Document from "@tiptap/extension-document";
    import Text from "@tiptap/extension-text";
    import Paragraph from "./extensions/block/Paragraph";
    import Dropcursor from "@tiptap/extension-dropcursor";
    import Placeholder from "@tiptap/extension-placeholder";
    import ClearMarksOnEmptyBlock from "./extensions/ClearMarksOnEmptyBlock";

    import bold from "./extensions/mark/bold";
    import italic from "./extensions/mark/italic";
    import underline from "./extensions/mark/underline";
    import strike from "./extensions/mark/strike";
    import bgColor from "./extensions/mark/bgColor";
    import fgColor from "./extensions/mark/fgColor";
    import code from "./extensions/mark/code";

    let panelWidth = $state(100);

    function changeCB(value: number): void {
        panelWidth = value;
    }

    let element: HTMLDivElement;
    let editor = $state.raw<Editor | null>(null);
    onMount(() => {
        const instance = new Editor({
            element,
            extensions: [
                History,
                ClearMarksOnEmptyBlock,
                Document,
                Paragraph,
                Placeholder.configure({
                    emptyEditorClass: "dc-editor-empty",
                    emptyNodeClass: "dc-empty",
                    placeholder: ""
                }),
                Dropcursor.configure({
                    color: "var(--dc-c-drop-cursor)",
                    width: 2
                }),
                Text,
                bold, italic, underline, strike,
                bgColor, fgColor,
                code
            ],
            content: "<div class='dc-paragraph'>Hello World!</div>"
        });

        editor = instance;

        return () => {
            instance.destroy();
        };
    });
</script>