<div class="reader-test">
    <div class="bar">
        <input type="file" accept=".pdf,application/pdf" onchange={onchange} />
        {#if error}
            <span class="error">{error.kind}: {error.message}</span>
        {/if}
    </div>
    <div class="reader">
        <Reader {source} {viewState} onViewStateChange={remember} onError={value => error = value} />
    </div>
</div>


<style>
    .reader-test {
        display: flex;
        flex-direction: column;
        height: 100%;
    }
    .bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 12px;
        font-size: 13px;
    }
    .error {
        color: var(--c-reader-error-text);
    }
    .reader {
        flex: 1;
        min-height: 0;
    }
</style>


<script module lang="ts">
    import type { ReaderSource, ReaderViewState } from "../Reader/defs";

    // Switching tabs unmounts this component; keeping these outside lets it reopen where it left off.
    let saved: { source: ReaderSource | null; viewState?: ReaderViewState } = { source: null };
</script>


<script lang="ts">
    import Reader from "../Reader/Reader.svelte";
    import type { ReaderError } from "../Reader/defs";

    let source = $state.raw(saved.source);
    let viewState = $state.raw(saved.viewState);
    let error = $state<ReaderError | null>(null);

    function remember(state: ReaderViewState, from: ReaderSource): void {
        if (from === saved.source) saved.viewState = state;
    }

    async function onchange(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
        const file = event.currentTarget.files?.[0];
        if (!file) return;
        saved = { source: { kind: "data", data: new Uint8Array(await file.arrayBuffer()) } };
        error = null;
        viewState = undefined;
        source = saved.source;
    }
</script>