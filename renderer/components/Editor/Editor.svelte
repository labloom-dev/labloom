<div class="container">
    <div style={`width: ${panelWidth}px;`}>
        <SidePanel />
    </div>
    <Resizer {changeCB} direction="vertical" origin={panelWidth} min={50} max={300} />
    <div class="container2">
        <div class="toolbar">
            {#each formats as format (format.name)}
                <button
                    type="button"
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
    .container {
        display: flex;
        flex-flow: row nowrap;
        height: 100%;
        width: 100%;
    }
    .container2 {
        display: flex;
        flex-flow: column nowrap;
        height: 100%;
        width: 100%;
    }
    .content {
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
            extensions: [StarterKit],
            content: "<div>Hello World!</div>",
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