<dialog bind:this={dialog} class="attachment-reader" onclose={onclose} {@attach element => element.showModal()}>
    <header><strong>{file.originalName}</strong><button class="button" onclick={() => dialog?.close()}>关闭</button></header>
    <div class="reader-body">
        {#if error}<p class="error">{message(error)}<button onclick={load}>{t("dialog.retry")}</button></p>
        {:else if source}<Reader {source} fileId={file.id} />
        {:else}<p>正在读取…</p>{/if}
    </div>
</dialog>
<style>
    .attachment-reader { width: min(1200px, calc(100vw - 48px)); height: calc(100vh - 64px); max-width: none; max-height: none; padding: 0; border: var(--border-width) solid var(--c-line); border-radius: var(--control-radius); background: var(--c-paper); color: var(--c-ink); }
    .attachment-reader::backdrop { background: #0005; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: var(--pagebar-height); padding-inline: 8px; border-bottom: var(--border-width) solid var(--c-line); font-size: var(--font-secondary); }
    strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .reader-body { height: calc(100% - var(--pagebar-height)); }
    p { padding: 12px; color: var(--c-muted); }
    .error { color: var(--c-reader-error-text); }
</style>
<script lang="ts">
    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import { onMount } from "svelte";
    import { type Attachment } from "../../../shared/types/papers";
    import { type ReaderSource } from "../Reader/defs";
    import Reader from "../Reader/Reader.svelte";

    let { file, onclose }: { file: Attachment; onclose: () => void } = $props();
    let dialog = $state<HTMLDialogElement>(), source = $state.raw<ReaderSource | null>(null), error = $state<ErrorValue>("");
    let active = true;
    async function load(): Promise<void> {
        try {
            const data = await window.api.knowledge.readFile(file.id);
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