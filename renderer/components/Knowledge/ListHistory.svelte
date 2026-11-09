{#if history.canUndo || history.redo.length}
    <button class="button" disabled={!history.canUndo} onclick={() => apply("undo")}>撤销</button>
    <button class="button" disabled={!history.redo.length} onclick={() => apply("redo")}>重做</button>
    {#if history.redo.length > 1}
        <select aria-label="选择重做分支" value="" onchange={event => apply("redo", event.currentTarget.value)}>
            <option value="">选择重做分支</option>
            {#each history.redo as branch (branch.id)}<option value={branch.id}>{new Date(branch.time).toLocaleString()}</option>{/each}
        </select>
    {/if}
{/if}

<script lang="ts">
    import type { HistoryState } from "../../../shared/types/knowledge";
    import { confirmed, perform, writeFromTab } from "./state.svelte";
    let { tabId, history = $bindable() }: { tabId: string; history: HistoryState } = $props();
    function apply(direction: "undo" | "redo", branch?: string): void {
        void perform(async () => {
            await writeFromTab(tabId, () => confirmed(token => window.api.knowledge.undo(tabId, direction, branch, token)));
            history = await window.api.knowledge.history(tabId);
        });
    }
</script>