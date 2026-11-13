<Popover.Root>
    <Popover.Trigger class={"timer-trigger" + (selected.length ? " configured" : "")} {disabled} title="设置提醒" aria-label={`设置${definition.name}的提醒`}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill={selected.length ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M3 11.5h10l-1.4-2V6a3.6 3.6 0 0 0-7.2 0v3.5z" /><path d="M6.3 13a1.8 1.8 0 0 0 3.4 0M8 1v1" /></svg>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content class="compact-menu" sideOffset={4} collisionPadding={8}>
        {#each options as option (option.seconds)}<button class="compact-item" aria-pressed={selected.includes(option.seconds)} disabled={busy} onclick={() => toggle(option.seconds)}>{selected.includes(option.seconds) ? "✓ " : "　"}{option.label}</button>{/each}
        {#if error}<p class="error">{message(error)}</p>{/if}
    </Popover.Content></Popover.Portal>
</Popover.Root>
<style>
    :global(.timer-trigger) { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 20px; height: var(--button-height); color: var(--c-muted); }
    :global(.timer-trigger.configured) { color: var(--c-accent); }
    .error { max-width: 240px; overflow-wrap: anywhere; color: var(--c-reader-error-text); }
</style>
<script lang="ts">
    import { failure, message, type ErrorValue } from "../../i18n.svelte";
    import { Popover } from "bits-ui";
    import { type AttributeDefinition } from "../../../shared/types/attributes";
    import { type PageSession, knowledgeState, writeFromTab } from "./state.svelte";
    let { session, definition, disabled = false }: { session: PageSession; definition: AttributeDefinition; disabled?: boolean } = $props();
    let selected = $state<number[]>([]), busy = $state(false), error = $state<ErrorValue>("");
    const options = $derived(definition.type === "minute" || definition.type === "hour"
        ? [{ seconds: 0, label: "准时" }, { seconds: 300, label: "提前 5 分钟" }, { seconds: 900, label: "提前 15 分钟" }, { seconds: 1800, label: "提前 30 分钟" }, { seconds: 3600, label: "提前 1 小时" }, { seconds: 86400, label: "提前 1 天" }]
        : [{ seconds: 0, label: "当天 9:00" }, { seconds: 86400, label: "提前 1 天" }, { seconds: 604800, label: "提前 1 周" }]);
    $effect(() => {
        void knowledgeState.change.seq;
        const pageId = session.state.page?.id, attrId = definition.id;
        if (!pageId) return;
        let active = true;
        void window.api.knowledge.timers(pageId).then(settings => {
            if (active) selected = settings[attrId] ?? [];
        }, problem => {
            if (active) error = failure(problem);
        });
        return () => {
            active = false;
        };
    });
    async function toggle(seconds: number): Promise<void> {
        if (!session.state.page) return;
        busy = true;
        try {
            await writeFromTab(session.tabId, async () => {
                const pageId = session.state.page!.id;
                await window.api.knowledge.setTimer(pageId, definition.id, seconds, !selected.includes(seconds), session.tabId);
                selected = (await window.api.knowledge.timers(pageId))[definition.id] ?? [];
            });
            error = "";
        }
        catch (problem) {
            error = failure(problem);
        }
        finally {
            busy = false;
        }
    }
</script>