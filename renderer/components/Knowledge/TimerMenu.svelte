<Popover.Root>
    <Popover.Trigger class={"timer-trigger" + (selected.length ? " configured" : "")} {disabled} title="设置提醒" aria-label={`设置${definition.name}的提醒`}>
        <Icon name={selected.length ? "bell-dot" : "bell"} size={14} />
    </Popover.Trigger>
    <Popover.Portal><Popover.Content class="compact-menu" sideOffset={4} collisionPadding={8}>
        {#each options as option (option.seconds)}<button class="compact-item" aria-pressed={selected.includes(option.seconds)} disabled={busy} onclick={() => toggle(option.seconds)}><span class="check">{#if selected.includes(option.seconds)}<Icon name="check" size="1em" />{/if}</span>{option.label}</button>{/each}
        {#if error}<p class="error">{message(error)}</p>{/if}
    </Popover.Content></Popover.Portal>
</Popover.Root>
<style>
    :global(.timer-trigger) { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 20px; height: var(--button-height); color: var(--c-muted); }
    :global(.timer-trigger.configured) { color: var(--c-accent); }
    .check { display: inline-flex; width: 1em; }
    .error { max-width: 240px; overflow-wrap: anywhere; color: var(--c-reader-error-text); }
</style>
<script lang="ts">
    import Icon from "../utils/Icon.svelte";
    import { failure, message, type ErrorValue } from "../../i18n.svelte";
    import { Popover } from "bits-ui";
    import { type AttributeDefinition } from "../../../shared/types/attributes";
    import { type PageSession } from "./page-session.svelte";
    import { knowledgeState } from "./feedback.svelte";
    import { write } from "./page-sessions";
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
        void window.api.timers.settings(pageId).then(settings => {
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
            await write(async () => {
                const pageId = session.state.page!.id;
                await window.api.timers.set(pageId, definition.id, seconds, !selected.includes(seconds));
                selected = (await window.api.timers.settings(pageId))[definition.id] ?? [];
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