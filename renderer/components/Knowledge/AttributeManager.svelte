<script lang="ts">
    import { tick } from "svelte";
    import { attributeTypes, type AttributeDefinition, type AttributeType } from "../../../shared/types/attributes";
    import { editableBuiltinMetadata, isBuiltin } from "../../../shared/attrs/builtins";
    import { convertMetadata } from "../../../shared/attrs/values";
    import { attributeShortcuts, isComposingKey } from "../../../shared/content/commands";
    import { LabloomError } from "../../../shared/failure";
    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import { copyData } from "../copy-data";
    import Button from "../base/Button.svelte";
    import Checkbox from "../base/Checkbox.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Input from "../base/Input.svelte";
    import ListRow from "../base/ListRow.svelte";
    import Select from "../base/Select.svelte";
    import TextButton from "../base/TextButton.svelte";
    import Resizer from "../utils/Resizer.svelte";
    import { propertyName, propertyOption } from "./attribute-labels";
    import { define } from "./confirmation.svelte";
    import { write } from "./page-sessions";

    let { definitions, readDefinitions, listWidth, onresize }: {
        definitions: AttributeDefinition[];
        readDefinitions: () => Promise<AttributeDefinition[]>;
        listWidth?: number;
        onresize: (width: number) => void;
    } = $props();

    let draft = $state<AttributeDefinition | null>(null), busy = $state(false), error = $state<ErrorValue>("");
    let list: HTMLDivElement;
    let optionsRoot = $state<HTMLDivElement>();
    let width = $state(0);
    const minWidth = $derived(Math.min(144, Math.max(1, Math.floor(width * .4))));
    const maxWidth = $derived(Math.max(minWidth, Math.floor(width * .7)));
    const paneWidth = $derived(width ? Math.min(maxWidth, Math.max(minWidth, listWidth ?? 230)) : listWidth ?? 230);

    const builtins = $derived(definitions.filter(item => isBuiltin(item.id) && !item.hidden && item.id !== "deleted"));
    const custom = $derived(definitions.filter(item => !isBuiltin(item.id) && !item.hidden));
    const items = $derived([...builtins, ...custom]);
    const selected = $derived(items.findIndex(item => item.id === draft?.id));
    const typeOptions = $derived(attributeTypes.filter(type => type !== "recurrence" || draft?.type === type)
        .map(value => ({ value, label: t(`attributeType.${value}`) })));
    const builtin = $derived(!!draft && isBuiltin(draft.id));
    const editableOptions = $derived(!!draft && (!isBuiltin(draft.id) || editableBuiltinMetadata(draft.id)));

    async function addOption(): Promise<void> {
        if (!draft) return;
        draft.metadata.options = [...(draft.metadata.options ?? []), {
            id: crypto.randomUUID(), name: "", ...(draft.type === "status" ? { group: "incomplete" as const } : {})
        }];
        await tick();
        optionsRoot?.querySelector<HTMLInputElement>(".option:last-child input")?.focus();
    }

    function select(value: AttributeDefinition): void {
        if (draft?.id === value.id) return;
        draft = copyData(value);
        error = "";
    }

    function move(event: KeyboardEvent, id: string): void {
        if (event.defaultPrevented || isComposingKey(event) || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        const key = event.key;
        if (key !== attributeShortcuts.previous && key !== attributeShortcuts.next) return;
        event.preventDefault();
        event.stopPropagation();
        const current = items.findIndex(item => item.id === id);
        const next = Math.min(items.length - 1, Math.max(0, current + (key === attributeShortcuts.next ? 1 : -1)));
        const item = items[next];
        if (item) {
            select(item);
            list.querySelectorAll<HTMLButtonElement>(".ui-row-main")[next]?.focus();
        }
    }

    function create(): void {
        draft = { id: `custom:${crypto.randomUUID()}`, type: "string", name: t("attributes.newName"), metadata: {} };
        error = "";
    }

    function changeType(type: AttributeType): void {
        if (draft) draft = { ...draft, type, metadata: convertMetadata(draft.type, type, draft.metadata) };
    }

    function removeOption(id: string): void {
        if (draft?.metadata.options) draft.metadata.options = draft.metadata.options.filter(item => item.id !== id);
    }

    async function apply(remove: boolean): Promise<void> {
        if (!draft || busy) return;
        const id = draft.id, value = remove ? null : copyData(draft);
        busy = true;
        error = "";
        try {
            if (!await write(() => define(id, value))) return;
            if (remove) {
                draft = null;
                return;
            }
            const saved = (await readDefinitions()).find(item => item.id === id);
            if (!saved) throw new LabloomError({ kind: "attribute-missing" });
            draft = copyData(saved);
            await tick();
            list?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
        }
        catch (problem) {
            error = failure(problem);
        }
        finally {
            busy = false;
        }
    }
</script>

<div class="manager" bind:clientWidth={width}>
    <div class="pane" style:width={paneWidth + "px"}>
        <div class="create">
            <Button icon="add" disabled={busy} onclick={create}>{t("attributes.create")}</Button>
        </div>
        <div class="definitions" role="listbox" aria-label={t("command.attributes")} bind:this={list}>
            {#each [{ title: t("attributes.builtins"), rows: builtins }, { title: t("attributes.custom"), rows: custom }] as group (group.title)}
                <div role="group" aria-label={group.title}>
                    <h3>{group.title}</h3>
                    {#each group.rows as item (item.id)}
                        {@const name = propertyName(item)}
                        {@const active = draft?.id === item.id}
                        <ListRow title={name} selected={active} onclick={() => select(item)}
                            buttonProps={{ role: "option", "aria-selected": active, disabled: busy,
                                tabindex: active || selected < 0 && item.id === items[0]?.id ? 0 : -1,
                                onkeydown: event => move(event, item.id) }}>
                            <span class="ui-row-title">{name}</span>
                            <span class="ui-row-description">{t(`attributeType.${item.type}`)}</span>
                        </ListRow>
                    {/each}
                </div>
            {/each}
        </div>
    </div>
    <Resizer direction="vertical" label={t("attributes.listWidth")} origin={paneWidth} min={minWidth} max={maxWidth}
        changeCB={value => onresize(Math.round(value))} />
    <div class="editor">
        {#if draft}
            <div class="fields">
                <div class="field">
                    <div class="label">{t("attributes.name")}</div>
                    <Input label={t("attributes.name")} value={builtin ? propertyName(draft) : draft.name} disabled={builtin || busy}
                        oninput={name => {
                            if (draft) draft.name = name;
                        }} />
                </div>
                <div class="field">
                    <div class="label">{t("attributes.type")}</div>
                    <Select label={t("attributes.type")} value={draft.type} options={typeOptions} disabled={builtin || busy}
                        onchange={value => changeType(value as AttributeType)} />
                </div>
                {#if draft.type === "status" || draft.type === "select" || draft.type === "multiselect"}
                    <div class="field">
                        <div class="label">{t("attributes.options")}</div>
                        <div class="options" bind:this={optionsRoot}>
                            {#each draft.metadata.options ?? [] as option (option.id)}
                                <div class="option">
                                    <Input label={t("attributes.optionName")} value={editableOptions ? option.name : propertyOption(draft, option)}
                                        disabled={busy || !editableOptions} oninput={name => option.name = name} />
                                    {#if draft.type === "status"}
                                        <Checkbox label={t("attributes.complete")} checked={option.group === "complete"}
                                            disabled={busy || !editableOptions} onchange={checked => option.group = checked ? "complete" : "incomplete"} />
                                    {/if}
                                    <IconButton icon="close" label={t("attributes.removeOption")} disabled={busy || !editableOptions}
                                        onclick={() => removeOption(option.id)} />
                                </div>
                            {/each}
                        </div>
                        <TextButton text={t("attributes.addOption")} icon="add" disabled={busy || !editableOptions} onclick={addOption} />
                    </div>
                {/if}
                <footer>
                    <Button variant="primary" disabled={busy} onclick={() => apply(false)}>{t("attributes.save")}</Button>
                    {#if !builtin}<Button variant="danger" disabled={busy} onclick={() => apply(true)}>{t("attributes.delete")}</Button>{/if}
                </footer>
                {#if error}<div class="error" role="alert">{message(error)}</div>{/if}
            </div>
        {/if}
    </div>
</div>

<style>
    .manager { display: flex; height: 100%; min-width: 0; background: var(--ui-surface-window); font-size: var(--ui-font-body); }
    .pane { display: flex; flex: none; flex-direction: column; min-height: 0; min-width: 0; background: var(--ui-surface-panel); }
    .create { padding: var(--ui-space-3); }
    .create :global(.ui-control) { max-width: 100%; }
    .definitions { flex: 1; min-height: 0; overflow: auto; }
    h3 { padding-inline: var(--ui-space-3); margin: var(--ui-space-3) 0 var(--ui-space-2); color: var(--ui-text-secondary); font-size: var(--ui-font-small); font-weight: 600; }
    .definitions :global(.ui-row) { display: flex; }
    .definitions :global(.ui-row-main) { justify-content: space-between; }
    .definitions :global(.ui-row-description) { max-width: 50%; }
    .editor { flex: 1; min-width: 0; overflow: auto; }
    .fields { max-width: var(--ui-editor-content-width); padding: var(--ui-space-6); }
    .field + .field, footer { margin-top: var(--ui-space-5); }
    .label { margin-bottom: var(--ui-space-2); font-weight: 600; }
    .field :global(.ui-field) { width: min(24em, 100%); }
    .options { display: grid; gap: var(--ui-space-2); }
    .option { display: flex; align-items: center; flex-wrap: wrap; gap: var(--ui-space-2); }
    .option :global(.ui-field) { flex: 1 1 8em; }
    .option :global(.ui-check) { flex: none; }
    .options:not(:empty) + :global(.ui-control) { margin-top: var(--ui-space-2); }
    footer { display: flex; flex-wrap: wrap; gap: var(--ui-space-3); }
    .error { margin-top: var(--ui-space-2); color: var(--ui-text-danger); font-size: var(--ui-font-small); }
</style>