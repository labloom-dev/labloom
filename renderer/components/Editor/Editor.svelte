<div class="outer">
    <div class="no-shrink" style={`width: ${panelWidth}px;`}>
        <SidePanel />
    </div>
    <Resizer {changeCB} direction="vertical" origin={panelWidth} min={50} max={300} />
    <div class="inner">
        <div class="toolbar">
            {#each formats as format (format.name)}
                <button
                    title={format.label}
                    disabled={!editorState}
                    onclick={() => editorState.editor?.chain().focus().toggleMark(format.name).run()}
                >
                    {format.label}
                </button>
            {/each}
        </div>
        <div class="content" bind:this={element}></div>
    </div>
</div>


<style>
    .outer {
        display: flex;
        flex-flow: row nowrap;
        height: 100%;
        width: 100%;
        flex-shrink: 0;
    }
    .inner {
        display: flex;
        flex-flow: column nowrap;
        height: 100%;
        flex: 1;
        min-width: 0;
    }
    .content {
        flex: 1;
        min-height: 0;
        overflow-x: clip;
        overflow-y: auto;
    }
    .no-shrink {
        flex-shrink: 0;
    }
    :global(*[contenteditable]:not([contenteditable="false"])) {
        -webkit-user-modify: read-write-plaintext-only;
    }
    :global(.tiptap.ProseMirror) {
        height: 100%;
        width: 100%;
        display: flex;
        flex-flow: column nowrap;
        gap: .125rem;
        padding: 1rem 3rem 40dvh;
        overflow-x: clip;
        overflow-y: auto;
    }
</style>


<script lang="ts">
    import { onMount } from "svelte";
    import { Editor } from "@tiptap/core";
    import { StarterKit } from "@tiptap/starter-kit";
    import SidePanel from "../SidePanel/SidePanel.svelte";
    import Resizer from "../Resizer.svelte";
    import Paragraph from "./extensions/Paragraph";

    let element: HTMLDivElement;
    let editorState = $state<{ editor: Editor | null }>({ editor: null });
    const formats = [
        { name: "bold", label: "Bold" },
        { name: "italic", label: "Italic" },
        { name: "underline", label: "Underline" },
        { name: "strike", label: "Strike" }
    ];

    let panelWidth = $state(100);

    function changeCB(value: number): void {
        panelWidth = value;
    }

    onMount(() => {
        const editor = new Editor({
            element,
            extensions: [
                StarterKit,
                Paragraph
            ],
            content: "<div class='dc-paragraph'>Hello World!</div>",
            onTransaction: ({ editor }) => {
                editorState = { editor };
            }
        });

        editorState = { editor };

        return () => {
            editor.destroy();
        };
    });
</script>