<div class="attribute-input">
    {#if definition.metadata.readonly || disabled}
        {#if definition.type === "page-link" && typeof value === "string"}
            <button class="text-button" onclick={() => openPage(value as string)}>打开关联页面</button>
        {:else}
            <span class="readonly">{display(value)}</span>
        {/if}
    {:else if definition.type === "boolean"}
        <select value={value === null ? "" : String(value)} onchange={event => onchange(event.currentTarget.value === "" ? null : event.currentTarget.value === "true")}>
            <option value="">未填写</option>
            <option value="true">是</option>
            <option value="false">否</option>
        </select>
    {:else if definition.type === "select"}
        <select value={String(value ?? "")} onchange={event => onchange(event.currentTarget.value || null)}>
            <option value="">未填写</option>
            {#each definition.metadata.options ?? [] as option (option.id)}
                <option value={option.id}>{option.name}</option>
            {/each}
        </select>
    {:else if definition.type === "multiselect"}
        <div class="options">
            {#each definition.metadata.options ?? [] as option (option.id)}
                <label><input type="checkbox" checked={Array.isArray(value) && value.includes(option.id)} onchange={event => {
                    const current = Array.isArray(value) ? value : []; onchange(event.currentTarget.checked ? [...current, option.id] : current.filter(id => id !== option.id));
                }} />{option.name}</label>
            {:else}
                <span class="readonly">暂无选项，可在共享属性中添加</span>
            {/each}
        </div>
    {:else if definition.type === "page-link" || definition.type === "page-links"}
        <div class="links">
            {#each (Array.isArray(value) ? value : typeof value === "string" ? [value] : []) as id (id)}
                <span>
                    <button class="text-button" onclick={() => openPage(String(id))}>打开页面</button>
                    <button onclick={() => onchange(Array.isArray(value) ? value.filter(item => item !== id) : null)}>移除</button>
                </span>
            {/each}
            <button class="text-button" onclick={() => picker = !picker}>选择页面</button>
        </div>
        {#if picker}
            <TargetPicker onclose={() => picker = false} onselect={target => {
                if (target.kind !== "page") {
                    error = "页面链接属性只能选择页面。"; return;
                } onchange(definition.type === "page-link" ? target.id : [...new Set([...(Array.isArray(value) ? value : []), target.id])]); picker = false;
            }} />
        {/if}
    {:else if definition.type === "datetime"}
        <input type="datetime-local" value={typeof value === "string" ? wallTime(value, zone) : ""} onchange={event => change(() => event.currentTarget.value ? toInstant(event.currentTarget.value, zone) : null)} />
        <small>{zone}</small>
    {:else if definition.type === "json"}
        <textarea value={value === null ? "" : JSON.stringify(value, null, 2)} onchange={event => change(() => event.currentTarget.value ? JSON.parse(event.currentTarget.value) : null)} placeholder="JSON 值"></textarea>
    {:else if definition.type === "number"}
        <input type="number" value={typeof value === "number" ? value : ""} onchange={event => onchange(event.currentTarget.value === "" ? null : event.currentTarget.valueAsNumber)} />
    {:else if definition.type === "date"}
        <input type="date" value={String(value ?? "")} onchange={event => onchange(event.currentTarget.value || null)} />
    {:else}
        <textarea rows={definition.id === "paper_abstract" ? 4 : 1} value={String(value ?? "")} onchange={event => onchange(event.currentTarget.value)}></textarea>
    {/if}
    {#if error}
        <small class="error">{error}</small>
    {/if}
</div>
<style>
    .attribute-input { min-width: 0; flex: 1; font-size: 12px; }
    input:not([type="checkbox"]), select, textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); font: inherit; min-width: 0; user-select: text; }
    textarea { resize: vertical; }
    .readonly { color: var(--c-muted); overflow-wrap: anywhere; white-space: pre-wrap; }
    .options, .links { display: flex; flex-wrap: wrap; gap: 8px 12px; }
    .options label, .links span { display: flex; gap: 6px; align-items: center; }
    small { display: block; margin-top: 5px; color: var(--c-muted); }
    .error { color: var(--c-reader-error-text); }
</style>
<script lang="ts">
    import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
    import { toInstant, wallTime } from "../../../shared/content/time";
    import { openPage } from "../layout/navigation";
    import { message } from "./state.svelte";
    import TargetPicker from "./TargetPicker.svelte";
    let { definition, value, disabled = false, zone = Intl.DateTimeFormat().resolvedOptions().timeZone, onchange }: { definition: AttributeDefinition; value: AttributeValue; disabled?: boolean; zone?: string; onchange: (value: AttributeValue) => void } = $props();
    let picker = $state(false), error = $state("");
    function change(read: () => AttributeValue): void {
        try {
            onchange(read());
            error = "";
        }
        catch (problem) {
            error = message(problem);
        }
    }
    function display(value: AttributeValue): string {
        return value === null ? "未填写" : typeof value === "object" ? JSON.stringify(value) : String(value);
    }
</script>