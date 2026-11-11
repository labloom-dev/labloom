<section class="properties">
    <header>
        <h2>页面属性</h2>
        <span>{kindNames[page.kind]}</span>
    </header>
    {#each definitions.filter(item => Object.hasOwn(page.attributes, item.id) && !item.metadata.hidden && item.id !== "deleted") as definition (definition.id)}
        <div class="property">
            <div class="property-label">
                <span>{definition.metadata.name || definition.id}</span>
                <div>
                    {#if !definition.metadata.readonly}
                        {#if nullable(definition.type)}
                            <button disabled={locked} onclick={() => session.attr(definition.id, emptyValue(definition.type))}>清空</button>
                        {/if}
                        {#if !isBuiltin(definition.id)}
                            <button disabled={locked} onclick={() => session.detach(definition.id)}>移除</button>
                        {/if}
                    {/if}
                </div>
            </div>
            <AttributeInput {definition} value={page.attributes[definition.id]} disabled={locked} onchange={value => session.attr(definition.id, value)} />
        </div>
    {/each}
    <div class="attach">
        <select bind:value={attachId} disabled={locked}>
            <option value="">选择要附加的属性</option>
            {#each definitions.filter(item => !isBuiltin(item.id) && !Object.hasOwn(page.attributes, item.id)) as item (item.id)}
                <option value={item.id}>{item.metadata.name}</option>
            {/each}
        </select>
        <button class="button" disabled={locked || !attachment} onclick={() => {
            if (attachment) session.attr(attachment.id, defaultValue(attachment.type));
            attachId = "";
        }}>附加</button>
    </div>
    <AttributeManager {definitions} tabId={session.tabId} />
</section>
<style>
    .properties { padding: 20px; background: var(--c-paper); font-size: 12px; }
    header, .property-label, .property-label div { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    h2 { margin: 0; font-size: 15px; }
    header > span { color: var(--c-muted); }
    .property { margin-top: 18px; }
    .property-label { margin-bottom: 6px; color: var(--c-muted); font-size: 11px; }
    .property-label button { font-size: 10px; }
    .attach { margin-top: 24px; display: flex; gap: 8px; }
    select { min-width: 0; flex: 1; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); }
</style>
<script lang="ts">
    import { isBuiltin } from "../../../shared/attrs/builtins";
    import { defaultValue, emptyValue, nullable } from "../../../shared/attrs/values";
    import { type AttributeDefinition } from "../../../shared/types/attributes";
    import { type PageSession } from "./state.svelte";
    import AttributeInput from "./AttributeInput.svelte";
    import AttributeManager from "./AttributeManager.svelte";
    import { kindNames } from "./labels";
    let { session, definitions }: { session: PageSession; definitions: AttributeDefinition[] } = $props();
    const page = $derived(session.state.page!);
    const locked = $derived(session.state.loading || !!page.attributes.deleted);
    let attachId = $state("");
    const attachment = $derived(definitions.find(item => item.id === attachId));
</script>