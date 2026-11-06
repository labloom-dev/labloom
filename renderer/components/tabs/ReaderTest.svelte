<div class="reader-test">
    <header class="reader-heading"><div><span class="eyebrow">ONE PAPER, ONE NEW PERSPECTIVE</span><h1>文献阅读</h1><p>安静读一篇论文，让新的想法慢慢发生。</p></div><label class="button primary" for="pdf-file">打开本地 PDF<input id="pdf-file" type="file" accept=".pdf,application/pdf" onchange={onchange} /></label></header>
    <div class="file-info"><span>{fileName || "尚未选择文献"}</span><span>本次会话阅读，文件尚未导入知识库</span></div>
    {#if error}<p class="notice error" role="alert">{error.message}</p>{/if}
    {#if fileError}<p class="notice error" role="alert">{fileError}</p>{/if}
    <div class="reader"><Reader {source} {viewState} onViewStateChange={remember} onError={value => error = value} /></div>
</div>


<style>
    .reader-test {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 440px;
        padding: 25px;
    }
    .reader-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 15px;
    }
    h1 {
        margin: 7px 0 9px;
        font-size: 28px;
        font-weight: 900;
    }
    .reader-heading p {
        margin: 0;
        color: var(--c-muted);
        font-size: 12px;
        line-height: 1.7;
    }
    label {
        position: relative;
        overflow: hidden;
        cursor: pointer;
    }
    label:focus-within {
        outline: 3px solid var(--c-border-focus);
        outline-offset: 3px;
    }
    input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
    }
    .file-info {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        padding: 18px 0 12px;
        color: var(--c-muted);
        font-size: 10px;
    }
    .file-info span:first-child {
        max-width: 100%;
        overflow-wrap: anywhere;
    }
    .reader {
        flex: 1;
        min-height: 260px;
        overflow: hidden;
        border: 1.5px solid var(--c-ink);
        border-radius: 13px;
        box-shadow: var(--c-shadow);
    }
</style>


<script module lang="ts">
    import type { ReaderSource, ReaderViewState } from "../Reader/defs";

    // Switching tabs unmounts this component; keeping these outside lets it reopen where it left off.
    let saved: { source: ReaderSource | null; viewState?: ReaderViewState; name?: string } = { source: null };
</script>


<script lang="ts">
    import Reader from "../Reader/Reader.svelte";
    import type { ReaderError } from "../Reader/defs";

    let fileName = $state(saved.name ?? "");
    let fileError = $state("");
    let requestId = 0;
    let source = $state.raw(saved.source);
    let viewState = $state.raw(saved.viewState);
    let error = $state<ReaderError | null>(null);

    function remember(state: ReaderViewState, from: ReaderSource): void {
        if (from === saved.source) saved.viewState = state;
    }

    async function onchange(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;
        const id = ++requestId;
        fileError = "";
        try {
            const data = new Uint8Array(await file.arrayBuffer());
            if (id !== requestId) return;
            saved = { source: { kind: "data", data }, name: file.name };
            fileName = file.name;
            error = null;
            viewState = undefined;
            source = saved.source;
        }
        catch (cause) {
            if (id === requestId) fileError = cause instanceof Error ? cause.message : "无法读取此文件，请重新选择。";
        }
        finally {
            input.value = "";
        }
    }
</script>