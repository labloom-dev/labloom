<details class="manager paper-card">
    <summary>共享标签与属性</summary>
    <div class="manager-body">
        <div class="choose">
            <select value={draft?.id ?? ""} onchange={event => select(event.currentTarget.value)}>
                <option value="">选择属性</option>
                {#each definitions.filter(item => !item.metadata.hidden && item.id !== "deleted") as item (item.id)}
                    <option value={item.id}>{item.metadata.name || item.id}</option>
                {/each}
            </select>
            <button class="button" onclick={create}>新建属性</button>
        </div>
        {#if draft}
            <label>名称<input bind:value={draft.metadata.name} maxlength="100" /></label>
            <label>类型<select bind:value={draft.type} disabled={isBuiltin(draft.id)}>
                {#each attributeTypes as type (type)}
                    <option value={type}>{labels[type]}</option>
                {/each}
            </select></label>
            {#if draft.type === "select" || draft.type === "multiselect"}
                <p class="muted">选项改名会保留原有选择；移除选项前会预览影响。</p>
                {#each draft.metadata.options ?? [] as option (option.id)}
                    <div class="option">
                        <input bind:value={option.name} disabled={isBuiltin(draft.id) && draft.id !== "tags"} />
                        <button class="text-button" disabled={isBuiltin(draft.id) && draft.id !== "tags"} onclick={() => draft!.metadata.options = draft!.metadata.options!.filter(item => item.id !== option.id)}>移除</button>
                    </div>
                {/each}
                <button class="text-button" disabled={isBuiltin(draft.id) && draft.id !== "tags"} onclick={() => draft!.metadata.options = [...(draft!.metadata.options ?? []), { id: crypto.randomUUID(), name: "新选项" }]}>＋ 添加选项</button>
            {/if}
            <footer>
                <button class="button primary" disabled={busy} onclick={() => apply(draft)}>保存定义</button>
                {#if !isBuiltin(draft.id)}
                    <button class="button" disabled={busy} onclick={() => apply(null)}>删除属性</button>
                {/if}
            </footer>
            {#if error}
                <p class="error">{error}</p>
            {/if}
        {/if}
    </div>
</details>
<style>
    .manager { margin-top: 20px; box-shadow: none; font-size: 12px; }
    summary { padding: 15px 20px; cursor: pointer; font-weight: 700; }
    .manager-body { padding: 0 20px 20px; }
    .choose, .option, footer { display: flex; align-items: center; gap: 12px; margin: 10px 0; }
    label { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
    input, select { min-width: 0; flex: 1; padding: 8px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); }
    footer { margin-top: 18px; }
    .muted { color: var(--c-muted); line-height: 1.7; }
</style>
<script lang="ts">
    import { attributeTypes, type AttributeDefinition } from "../../../shared/types/attributes";
    import { isBuiltin } from "../../../shared/attrs/builtins";
    import { define, message, writeFromTab } from "./state.svelte";
    let { definitions, tabId }: { definitions: AttributeDefinition[]; tabId: string } = $props();
    let draft = $state<AttributeDefinition | null>(null), busy = $state(false), error = $state("");
    const labels = { string: "文本", number: "数字", boolean: "勾选", date: "日期", datetime: "日期与时间", select: "单选", multiselect: "多选", url: "网址", "page-link": "页面链接", "page-links": "多个页面链接", json: "JSON" };
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