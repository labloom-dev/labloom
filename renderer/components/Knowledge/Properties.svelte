<section class="properties">
    <Popover.Root bind:open={adding}>
        <Popover.Trigger class="button add-property" disabled={locked}>＋ 添加属性</Popover.Trigger>
        <Popover.Portal><Popover.Content class="compact-menu add-property-menu" sideOffset={4} collisionPadding={8}>
            <input aria-label="搜索属性" placeholder="搜索属性…" bind:value={query} onkeydown={searchKey} />
            {#if creating}
                {#each attributeTypes as type (type)}<button class="compact-item" onclick={() => void create(type)}>{attributeLabels[type]}</button>{/each}
            {:else}
                {#each available as item, index (item.id)}<button class="compact-item" class:highlight={index === active} onclick={() => attach(item)}>{item.metadata.name}</button>{/each}
                {#if query.trim() && !definitions.some(item => item.metadata.name === query.trim())}<button class="compact-item" onclick={() => creating = true}>新建属性 {query.trim()}</button>{/if}
                <button class="compact-item" onclick={() => {
                    adding = false; openDestination("attributes");
                }}>管理属性…</button>
            {/if}
        </Popover.Content></Popover.Portal>
    </Popover.Root>
    {#each visible as definition (definition.id)}
        <div class="property">
            <span class="property-label" title={definition.metadata.name}>{definition.metadata.name || definition.id}</span>
            <div class="value">
                {#if definition.id === "tags"}<TagInput {definition} value={page.attributes.tags} tabId={session.tabId} disabled={locked} onchange={value => session.attr("tags", value)} />
                {:else}<AttributeInput {definition} value={page.attributes[definition.id]} disabled={locked} onchange={value => session.attr(definition.id, value)} />{/if}
            </div>
            {#if !definition.metadata.readonly}
                <div class="property-actions">
                    {#if nullable(definition.type)}<button title="清空" aria-label={`清空${definition.metadata.name}`} disabled={locked} onclick={() => session.attr(definition.id, emptyValue(definition.type))}>×</button>{/if}
                    {#if !isBuiltin(definition.id)}<button title="从页面移除属性" aria-label={`移除${definition.metadata.name}`} disabled={locked} onclick={() => session.detach(definition.id)}>−</button>{/if}
                </div>
            {/if}
        </div>
    {/each}
    {#if error}<p class="error">{error}</p>{/if}
</section>
<style>
    .properties { padding: 8px; background: var(--c-paper); font-size: var(--font-secondary); }
    :global(.add-property) { margin-bottom: 8px; }
    :global(.add-property-menu input) { width: 100%; height: var(--button-height); background: var(--c-paper); color: inherit; border: var(--border-width) solid var(--c-line); padding-inline: 6px; }
    :global(.add-property-menu .highlight) { background: var(--c-sage); }
    .property { position: relative; display: flex; align-items: center; height: var(--property-row-height); gap: 6px; border-bottom: var(--border-width) solid var(--c-line); }
    .property-label { width: var(--property-label-width); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--c-muted); }
    .value { flex: 1; min-width: 0; }
    .property-actions { display: flex; opacity: 0; position: absolute; right: 0; top: 1px; background: var(--c-paper); }
    .property-actions button { width: 16px; height: var(--button-height); }
    .property:hover .property-actions, .property:focus-within .property-actions { opacity: 1; }
    .error { color: var(--c-reader-error-text); }
</style>
<script lang="ts">
    import { Popover } from "bits-ui";
    import { isBuiltin } from "../../../shared/attrs/builtins";
    import { defaultValue, emptyValue, nullable } from "../../../shared/attrs/values";
    import { attributeTypes, type AttributeType, type AttributeDefinition } from "../../../shared/types/attributes";
    import { type PageSession, define, writeFromTab, message } from "./state.svelte";
    import { attributeLabels } from "./attribute-labels";
    import { openDestination } from "../layout/navigation";
    import AttributeInput from "./AttributeInput.svelte";
    import TagInput from "./TagInput.svelte";
    let { session, definitions }: { session: PageSession; definitions: AttributeDefinition[] } = $props();
    const page = $derived(session.state.page!);
    const locked = $derived(session.state.loading || !!page.attributes.deleted);
    const visible = $derived(definitions.filter(item => Object.hasOwn(page.attributes, item.id) && !item.metadata.hidden && item.id !== "deleted").sort((a, b) => Number(["created_at", "modified_at"].includes(a.id)) - Number(["created_at", "modified_at"].includes(b.id))));
    let adding = $state(false), query = $state(""), creating = $state(false), active = $state(0), error = $state("");
    const available = $derived(definitions.filter(item => !isBuiltin(item.id) && !Object.hasOwn(page.attributes, item.id) && (item.metadata.name ?? "").toLocaleLowerCase().includes(query.toLocaleLowerCase())));
    $effect(() => {
        void query; creating = false; active = 0;
    });
    function attach(definition: AttributeDefinition): void {
        session.attr(definition.id, defaultValue(definition.type)); adding = false; query = "";
    }
    async function create(type: AttributeType): Promise<void> {
        const definition: AttributeDefinition = { id: `custom:${crypto.randomUUID()}`, type, metadata: { name: query.trim() } };
        try {
            if (await writeFromTab(session.tabId, () => define(definition.id, definition, session.tabId))) attach(definition);
        }
        catch (problem) {
            error = message(problem);
        }
    }
    function searchKey(event: KeyboardEvent): void {
        if (event.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); active = Math.max(0, Math.min(available.length, active + (event.key === "ArrowDown" ? 1 : -1)));
        }
        else if (event.key === "Enter") {
            event.preventDefault(); if (available[active]) attach(available[active]); else if (query.trim()) creating = true;
        }
    }
</script>