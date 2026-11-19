{#if history.canUndo || history.canRedo}
    <button class="button" disabled={!history.canUndo} onclick={() => apply("undo")}>撤销</button>
    <button class="button" disabled={!history.canRedo} onclick={() => apply("redo")}>重做</button>
{/if}

<script lang="ts">
    import type { HistoryState } from "../../../shared/types/knowledge";
    import { confirmed } from "./confirmation.svelte";
    import { perform } from "./feedback.svelte";
    import { write } from "./page-sessions";
    import { onMount } from "svelte";
    import { watchHistory } from "./history";
    import type { HistorySource } from "../../../shared/history/ipc";
    let { source }: { source: HistorySource } = $props();
    let history = $state.raw<HistoryState>({ canUndo: false, canRedo: false });
    onMount(() => watchHistory(source, state => {
        history = state;
    }));
    function apply(direction: "undo" | "redo"): void {
        void perform(async () => {
            await write(() => confirmed(token => window.api.history.apply(source, direction, token)));
        });
    }
</script>