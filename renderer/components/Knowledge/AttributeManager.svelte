<section class="manager">
    <nav aria-label="属性定义">
        <button class="button" onclick={create}>新建属性</button>
        {#each [true, false] as builtin (builtin)}
            <h3>{builtin ? "内置属性" : "自定义属性"}</h3>
            {#each definitions.filter(item => isBuiltin(item.id) === builtin && !item.metadata.hidden && item.id !== "deleted") as item (item.id)}
                <button class="definition" class:active={draft?.id === item.id} onclick={() => select(item.id)}><span>{item.metadata.name || item.id}</span><small>{labels[item.type]}</small></button>
            {/each}
        {/each}
    </nav>
    <div class="manager-body">
        {#if draft}
            <label>名称<input bind:value={draft.metadata.name} maxlength="100" /></label>
            <label>类型<select bind:value={draft.type} disabled={isBuiltin(draft.id)}>{#each attributeTypes as type (type)}<option value={type}>{labels[type]}</option>{/each}</select></label>
            {#if draft.type === "select" || draft.type === "multiselect"}
                <p class="muted">选项改名会保留原有选择；移除选项前会预览影响。</p>
                <div bind:this={optionsRoot}>
                    {#each draft.metadata.options ?? [] as option (option.id)}
                        <div class="option"><input bind:value={option.name} aria-label="选项名称" disabled={isBuiltin(draft.id) && draft.id !== "tags"} /><button class="text-button" disabled={isBuiltin(draft.id) && draft.id !== "tags"} onclick={() => draft!.metadata.options = draft!.metadata.options!.filter(item => item.id !== option.id)}>移除</button></div>
                    {/each}
                </div>
                <button class="text-button" disabled={isBuiltin(draft.id) && draft.id !== "tags"} onclick={addOption}>＋ 添加选项</button>
            {/if}
            <footer><button class="button primary" disabled={busy} onclick={() => apply(draft)}>保存定义</button>{#if !isBuiltin(draft.id)}<button class="button" disabled={busy} onclick={() => apply(null)}>删除属性</button>{/if}</footer>
            {#if error}<p class="error">{error}</p>{/if}
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
    import { tick } from "svelte";
    import { attributeTypes, type AttributeDefinition } from "../../../shared/types/attributes";
    import { isBuiltin } from "../../../shared/attrs/builtins";
    import { define, message, writeFromTab } from "./state.svelte";
    let { definitions, tabId }: { definitions: AttributeDefinition[]; tabId: string } = $props();
    let draft = $state<AttributeDefinition | null>(null), busy = $state(false), error = $state("");
    const labels = { string: "文本", number: "数字", boolean: "勾选", minute: "时间（分）", hour: "时间（时）", day: "日期", month: "年月", year: "年份", select: "单选", multiselect: "多选", url: "网址", "page-link": "页面链接", "page-links": "多个页面链接", json: "JSON" };
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
        draft = { id: `custom:${crypto.randomUUID()}`, type: "string", metadata: { name: "新属性" } };
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
            error = message(problem);
        }
        finally {
            busy = false;
        }
    }
</script>