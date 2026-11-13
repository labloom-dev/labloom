<section class="manager">
    <nav aria-label="属性定义">
        <button class="button" onclick={create}>新建属性</button>
        {#each [true, false] as builtin (builtin)}
            <h3>{builtin ? "内置属性" : "自定义属性"}</h3>
            {#each definitions.filter(item => isBuiltin(item.id) === builtin && !item.hidden && item.id !== "deleted") as item (item.id)}
                <button class="definition" class:active={draft?.id === item.id} onclick={() => select(item.id)}><span>{item.name || item.id}</span><small>{labels[item.type]}</small></button>
            {/each}
        {/each}
    </nav>
    <div class="manager-body">
        {#if draft}
            <label>名称<input bind:value={draft.name} maxlength="100" disabled={isBuiltin(draft.id)} /></label>
            <label>类型<select value={draft.type} onchange={event => {
                const type = event.currentTarget.value as AttributeType;
                draft = { ...draft!, type, metadata: convertMetadata(draft!.type, type, draft!.metadata) };
            }} disabled={isBuiltin(draft.id)}>{#each attributeTypes.filter(type => type !== "recurrence" || draft?.type === "recurrence") as type (type)}<option value={type}>{labels[type]}</option>{/each}</select></label>
            {#if draft.type === "select" || draft.type === "multiselect"}
                <p class="muted">选项改名会保留原有选择；移除选项前会预览影响。</p>
                <div bind:this={optionsRoot}>
                    {#each draft.metadata.options ?? [] as option (option.id)}
                        <div class="option"><input bind:value={option.name} aria-label="选项名称" disabled={isBuiltin(draft.id) && !editableBuiltinMetadata(draft.id)} /><button class="text-button" disabled={isBuiltin(draft.id) && !editableBuiltinMetadata(draft.id)} onclick={() => draft!.metadata.options = draft!.metadata.options!.filter(item => item.id !== option.id)}>移除</button></div>
                    {/each}
                </div>
                <button class="text-button" disabled={isBuiltin(draft.id) && !editableBuiltinMetadata(draft.id)} onclick={addOption}>＋ 添加选项</button>
            {/if}
            <footer><button class="button primary" disabled={busy} onclick={() => apply(draft)}>保存定义</button>{#if !isBuiltin(draft.id)}<button class="button" disabled={busy} onclick={() => apply(null)}>删除属性</button>{/if}</footer>
            {#if error}<p class="error">{message(error)}</p>{/if}
        {/if}
    </div>
</section>
<style>
    .manager { display: flex; min-height: 100%; background: var(--c-paper); font-size: var(--font-body); }
    nav { width: 230px; flex-shrink: 0; padding: 8px; border-right: var(--border-width) solid var(--c-line); }
    h3 { font-size: var(--font-secondary); color: var(--c-muted); margin: 12px 0 4px; }
    .definition { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; height: var(--panel-row-height); padding-inline: 4px; text-align: left; }
    .definition span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .definition:hover, .active { background: var(--c-sage); }
    small { color: var(--c-muted); white-space: nowrap; font-size: var(--font-secondary); }
    .manager-body { flex: 1; min-width: 0; padding: 12px; }
    label, .option, footer { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    label { min-height: var(--property-row-height); }
    input, select { flex: 1; min-width: 0; height: var(--button-height); padding-inline: 6px; border: var(--border-width) solid var(--c-line); border-radius: var(--control-radius); background: var(--c-paper); color: inherit; font: inherit; }
    .muted { color: var(--c-muted); font-size: var(--font-secondary); }
    footer { margin-top: 12px; }
</style>
<script lang="ts">
    import { failure, message, type ErrorValue } from "../../i18n.svelte";
    import { tick } from "svelte";
    import { attributeTypes, type AttributeDefinition, type AttributeType } from "../../../shared/types/attributes";
    import { editableBuiltinMetadata, isBuiltin } from "../../../shared/attrs/builtins";
    import { attributeLabels as labels } from "./attribute-labels";
    import { convertMetadata } from "../../../shared/attrs/values";
    import { define, writeFromTab } from "./state.svelte";
    let { definitions, tabId }: { definitions: AttributeDefinition[]; tabId: string } = $props();
    let draft = $state<AttributeDefinition | null>(null), busy = $state(false), error = $state<ErrorValue>("");
    let optionsRoot = $state<HTMLDivElement>();
    async function addOption(): Promise<void> {
        if (!draft) return;
        draft.metadata.options = [...(draft.metadata.options ?? []), { id: crypto.randomUUID(), name: "" }];
        await tick();
        optionsRoot?.querySelector<HTMLInputElement>(".option:last-of-type input")?.focus();
    }
    function select(id: string): void {
        const value = definitions.find(item => item.id === id);
        draft = value ? JSON.parse(JSON.stringify(value)) : null;
        error = "";
    }
    function create(): void {
        draft = { id: `custom:${crypto.randomUUID()}`, type: "string", name: "新属性", metadata: {} };
        error = "";
    }
    async function apply(value: AttributeDefinition | null): Promise<void> {
        busy = true;
        try {
            if (await writeFromTab(tabId, () => define(draft!.id, value ? JSON.parse(JSON.stringify(value)) : null, tabId))) {
                draft = null;
                error = "";
            }
        }
        catch (problem) {
            error = failure(problem);
        }
        finally {
            busy = false;
        }
    }
</script>