<div class="reference-card" class:missing={!targetValue}>
    {#if pending}
        <span>正在读取引用…</span>
    {:else if targetValue}
        <button onclick={() => target.kind === "page" ? openPage(target.id) : expanded = !expanded}>↗ {targetValue.title || "空块"}{targetValue.deleted ? "（已回收）" : ""}</button>
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
    import { type Target } from "../../../shared/types/content";
    import { openPage } from "../layout/navigation";
    import { knowledgeState } from "./state.svelte";
    let { target }: { target: Target } = $props();
    let targetValue = $state<{ title: string; text: string; deleted: boolean } | null>(null), pending = $state(true), expanded = $state(false);
    $effect(() => {
        const current: Target = { kind: target.kind, id: target.id };
        void knowledgeState.revision;
        let active = true;
        pending = true;
        void window.api.knowledge.resolve(current).then(value => {
            if (active) {
                targetValue = value;
                pending = false;
            }
        }, () => {
            if (active) {
                targetValue = null;
                pending = false;
            }
        });
        return () => {
            active = false;
        };
    });
</script>