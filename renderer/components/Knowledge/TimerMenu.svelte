<Menu items={options.map(option => ({ label: option.label, checked: selected.includes(option.seconds), disabled: busy, onselect: () => void toggle(option.seconds) }))}>
    {#snippet trigger({ props })}<IconButton {...props} icon={selected.length ? "bell-dot" : "bell"} {disabled}
        label={t("property.reminder", { name: propertyName(definition) })} />{/snippet}
</Menu>
{#if error}<span role="alert">{message(error)}</span>{/if}

<style>
    [role="alert"] { color: var(--ui-danger); overflow-wrap: anywhere; }
</style>
<script lang="ts">
    import IconButton from "../base/IconButton.svelte";
    import Menu from "../base/Menu.svelte";
    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import { propertyControls } from "./property-controls";
    import { propertyName } from "./attribute-labels";
    import { type AttributeDefinition } from "../../../shared/types/attributes";
    import { knowledgeState } from "./feedback.svelte";
    let { pageId, definition, disabled = false }: { pageId: string; definition: AttributeDefinition; disabled?: boolean } = $props();
    const services = propertyControls();
    let selected = $state<number[]>([]), busy = $state(false), error = $state<ErrorValue>("");
    const options = $derived(definition.type === "minute" || definition.type === "hour"
        ? [{ seconds: 0, label: t("property.onTime") }, { seconds: 300, label: t("property.minutesBefore", { count: 5 }) }, { seconds: 900, label: t("property.minutesBefore", { count: 15 }) }, { seconds: 1800, label: t("property.minutesBefore", { count: 30 }) }, { seconds: 3600, label: t("property.hourBefore") }, { seconds: 86400, label: t("property.dayBefore") }]
        : [{ seconds: 0, label: t("property.morning") }, { seconds: 86400, label: t("property.dayBefore") }, { seconds: 604800, label: t("property.weekBefore") }]);
    $effect(() => {
        void knowledgeState.change.seq;
        const attrId = definition.id;
        if (!pageId) return;
        let active = true;
        void services.reminders(pageId).then(settings => {
            if (active) selected = settings[attrId] ?? [];
        }, problem => {
            if (active) error = failure(problem);
        });
        return () => {
            active = false;
        };
    });
    async function toggle(seconds: number): Promise<void> {
        if (busy || disabled) return;
        busy = true;
        try {
            await services.setReminder(pageId, definition.id, seconds, !selected.includes(seconds));
            selected = (await services.reminders(pageId))[definition.id] ?? [];
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