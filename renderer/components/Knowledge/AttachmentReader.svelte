<dialog bind:this={dialog} class="attachment-reader" aria-label={file.originalName} onclose={onclose} {@attach showModal}>
    <header><strong>{file.originalName}</strong><Button onclick={() => dialog?.close()}>{t("dialog.close")}</Button></header>
    <div class="reader-body">
        {#if error}<div data-paragraph class="error">{message(error)}<Button onclick={load}>{t("dialog.retry")}</Button></div>
        {:else if source}<Reader {source} fileId={file.id} />
        {:else}<div data-paragraph>{t("property.loadingFile")}</div>{/if}
    </div>
</dialog>
<style>
    .attachment-reader { width: min(calc(2 * var(--ui-search-width)), calc(100vw - calc(2 * var(--ui-space-6)))); height: calc(100vh - calc(2 * var(--ui-toolbar-height))); max-width: none; max-height: none; padding: 0; border: var(--ui-stroke) solid var(--ui-divider); border-radius: var(--ui-radius-panel); background: var(--ui-surface-window); color: var(--ui-text); }
    .attachment-reader::backdrop { background: var(--ui-surface-scrim); }
    header { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4); height: var(--ui-toolbar-height); padding-inline: var(--ui-space-3); border-bottom: var(--ui-stroke) solid var(--ui-divider); font-size: var(--ui-font-small); }
    strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .reader-body { height: calc(100% - var(--ui-toolbar-height)); }
    :where([data-paragraph]) { padding: var(--ui-space-4); color: var(--ui-text-secondary); }
    .error { color: var(--ui-danger); }
</style>
<script lang="ts">
    import { showModal } from "../base/top-layer";
    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import { onMount } from "svelte";
    import { type Attachment } from "../../../shared/types/papers";
    import { type ReaderSource } from "../Reader/defs";
    import Reader from "../Reader/Reader.svelte";

    let { file, onclose }: { file: Attachment; onclose: () => void } = $props();
    let dialog = $state<HTMLDialogElement>(), source = $state.raw<ReaderSource | null>(null), error = $state<ErrorValue>("");
    let active = true;
    async function load(): Promise<void> {
        try {
            const data = await window.api.papers.readFile(file.id);
            if (active) {
                source = { kind: "data", data: new Uint8Array(data) };
                error = "";
            }
        }
        catch (problem) {
            if (active) error = failure(problem);
        }
    }
    onMount(() => {
        void load();
        return () => {
            active = false;
        };
    });
</script>