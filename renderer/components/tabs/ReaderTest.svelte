<section class="reader-page">
    <header class="reader-heading">
        <div><span class="eyebrow">A QUIET PLACE TO READ</span><h1>文献阅读</h1><p>打开一篇 PDF，给阅读留一点时间。</p></div>
        <button class="button primary" onclick={() => fileInput.click()}><Icon name="book" size={16} />打开本地 PDF</button>
        <input bind:this={fileInput} type="file" accept=".pdf,application/pdf" aria-label="选择 PDF 文件" hidden onchange={chooseFile} />
    </header>
    {#if name}<div class="file-name"><Icon name="book" size={15} /><span>{name}</span></div>{/if}
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    <div class="reader"><Reader {source} {viewState} onViewStateChange={remember} onError={value => error = value.message} /></div>
</section>


<style>
    .reader-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
    }
    .reader-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        padding: 22px 26px;
        border-bottom: 1px solid var(--c-line);
        background: var(--c-paper);
    }
    h1 {
        margin: 7px 0;
        font-size: 23px;
    }
    .reader-heading p {
        margin: 0;
        color: var(--c-muted);
        font-size: 12px;
    }
    .file-name {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 16px;
        color: var(--c-muted);
        background: var(--c-paper);
        font-size: 12px;
    }
    .file-name span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .notice {
        margin: 10px 16px;
    }
    .reader {
        flex: 1;
        min-height: 150px;
    }
</style>


<script module lang="ts">
    import { type ReaderSource, type ReaderViewState } from "../Reader/defs";

    // Retain the open local file and reading position while switching tabs.
    let saved: { source: ReaderSource | null; name: string; viewState?: ReaderViewState } = { source: null, name: "" };
</script>


<script lang="ts">
    import { onDestroy } from "svelte";
    import Reader from "../Reader/Reader.svelte";
    import Icon from "../utils/Icon.svelte";

    let source = $state.raw(saved.source);
    let viewState = $state.raw(saved.viewState);
    let name = $state(saved.name);
    let error = $state("");
    let fileInput: HTMLInputElement;
    let request = 0;

    function remember(state: ReaderViewState, from: ReaderSource): void {
        if (from === saved.source) saved.viewState = state;
    }

    async function chooseFile(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;
        const current = ++request;
        try {
            const data = new Uint8Array(await file.arrayBuffer());
            if (current !== request) return;
            saved = { source: { kind: "data", data }, name: file.name };
            error = "";
            viewState = undefined;
            name = saved.name;
            source = saved.source;
        }
        catch (cause) {
            if (current === request) error = cause instanceof Error ? cause.message : "无法读取此文件，请重新选择。";
        }
        finally {
            input.value = "";
        }
    }

    onDestroy(() => {
        request++;
    });
</script>