{#if history.canUndo || history.redo.length}
    <button class="button" disabled={!history.canUndo} onclick={() => apply("undo")}>撤销</button>
    <button class="button" disabled={!history.redo.length} onclick={() => apply("redo")}>重做</button>
    {#if history.redo.length > 1}
        <select aria-label="选择重做分支" value="" onchange={event => apply("redo", event.currentTarget.value)}>
            <option value="">选择重做分支</option>
            {#each history.redo as branch (branch.id)}<option value={branch.id}>{displayMilliseconds(branch.time)}</option>{/each}
        </select>
    {/if}
{/if}

<script lang="ts">
    import type { HistoryState } from "../../../shared/types/knowledge";
    import { displayMilliseconds } from "../layout/preferences.svelte";
    import { confirmed, perform, writeFromTab } from "./state.svelte";
    import { onMount } from "svelte";
    import { watchHistory } from "./history";
    import type { HistorySource } from "../../../shared/history/ipc";
    let { tabId, source }: { tabId: string; source: HistorySource } = $props();
    let history = $state.raw<HistoryState>({ canUndo: false, redo: [] });
    onMount(() => watchHistory(source, state => {
        history = state;
    }));
    function apply(direction: "undo" | "redo", branch?: string): void {
        void perform(async () => {
            await writeFromTab(tabId, () => confirmed(token => window.api.history.apply(source, direction, branch, token)));
        });
    }
</script>