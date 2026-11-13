<div class="reference-card" class:missing={!targetValue}>
    {#if pending}
        <span>正在读取引用…</span>
    {:else if targetValue}
        <button onclick={openTarget}>↗ {targetValue.title || "空块"}{targetValue.status === "recycled" ? "（已回收）" : ""}</button>
        {#if expanded || target.kind === "page"}
            <p>{targetValue.text}</p>
        {/if}
    {:else}
        <span>引用目标缺失</span>
    {/if}
</div>
<style>
    .reference-card { padding: 12px 16px; border: 1px solid var(--dc-c-border, var(--c-line)); border-radius: 8px; background: var(--c-cream); font-size: 13px; }
    button { text-align: left; font-weight: 700; overflow-wrap: anywhere; }
    p { margin: 8px 0 0; color: var(--c-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
    .missing { border-style: dashed; color: var(--c-muted); }
</style>
<script lang="ts">
    import { untrack } from "svelte";
    import { type Target, type ResolvedTarget } from "../../../shared/types/content";
    import { openPage } from "../layout/navigation";
    import { type PageSession } from "./state.svelte";
    import { notify } from "./feedback.svelte";
    let { target, session }: { target: Target; session: PageSession } = $props();
    let targetValue = $state<ResolvedTarget | null>(null), pending = $state(true), expanded = $state(false);
    function openTarget(): void {
        if (targetValue?.status === "deleted") notify("目标已删除");
        else if (target.kind === "page") openPage(target.id);
        else expanded = !expanded;
    }
    $effect(() => {
        const current: Target = { kind: target.kind, id: target.id };
        let active = true;
        async function load(): Promise<void> {
            try {
                const value = await window.api.knowledge.resolve(current);
                if (active) targetValue = value ?? { title: "已删除", text: "", status: "deleted" };
            }
            finally {
                if (active) pending = false;
            }
        }
        pending = true;
        const owner = session;
        const off = untrack(() => owner.watchObject(current.id, load, true));
        return () => {
            active = false;
            off();
        };
    });
</script>