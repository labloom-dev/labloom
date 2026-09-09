<div class="toolbar">
    {#each formats as format (format.name)}
        <button
            type="button"
            title={format.label}
            disabled={!state.editor}
            onclick={() => state.editor?.chain().focus().toggleMark(format.name).run()}
        >
            {format.label}
        </button>
    {/each}
</div>

<div bind:this={element}></div>


<script lang="ts">
    import { onMount } from "svelte";
    import { Editor } from "@tiptap/core";
    import { StarterKit } from "@tiptap/starter-kit";

    let element: HTMLDivElement;
    let state = $state<{ editor: Editor | null }>({ editor: null });
    const formats = [
        { name: "bold", label: "Bold" },
        { name: "italic", label: "Italic" },
        { name: "underline", label: "Underline" },
        { name: "strike", label: "Strike" }
    ];

    onMount(() => {
        const editor = new Editor({
            element,
            extensions: [StarterKit],
            content: "<p>Hello World!</p>",
            onTransaction: ({ editor }) => {
                state = { editor };
            }
        });

        state = { editor };

        return () => {
            editor.destroy();
        };
    });
</script>