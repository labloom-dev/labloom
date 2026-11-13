<div class="tags-input" bind:this={root} onfocusout={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) open = false;
}}>
    {#each chosen as option (option.id)}<span class="capsule">{option.name}<button aria-label={`取消${option.name}`} disabled={disabled || busy} onclick={() => onchange(selected.filter(id => id !== option.id))}>×</button></span>{/each}
    <input aria-label="标签" placeholder="添加标签…" {disabled} bind:value={query} onfocus={() => open = true} oninput={() => open = true} onclick={() => open = true} onkeydown={keydown} />
    {#if open && !disabled}
        <div class="tag-options" popover="manual" role="listbox" aria-label="可选标签" {@attach element => {
            element.showPopover(); const rect = root.getBoundingClientRect(); element.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 220)) + "px"; element.style.top = Math.min(rect.bottom, window.innerHeight - 220) + "px";
        }}>
            {#each matches as option, index (option.id)}<button role="option" aria-selected={active === index} class:active={active === index} disabled={busy} onmousedown={event => event.preventDefault()} onclick={() => void choose(index)}>{option.name}</button>{/each}
            {#if query.trim() && !options.some(item => item.name === query.trim())}<button role="option" aria-selected={active === matches.length} class:active={active === matches.length} disabled={busy} onmousedown={event => event.preventDefault()} onclick={() => void choose(matches.length)}>新建标签 {query.trim()}</button>{/if}
        </div>
    {/if}
    {#if error}<span class="error">{error}</span>{/if}
</div>
<style>
    .tags-input { position: relative; display: flex; align-items: center; flex-wrap: nowrap; gap: 3px; min-width: 0; height: var(--button-height); overflow-x: auto; scrollbar-width: none; }
    .capsule { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; white-space: nowrap; border-radius: var(--control-radius); background: var(--c-sage); padding: 2px 4px; font-size: var(--font-secondary); }
    input { flex: 1; min-width: 70px; width: 70px; height: var(--button-height); border: 0; background: transparent; color: inherit; font: inherit; outline: none; }
    .tag-options { position: fixed; inset: auto; margin: 0; min-width: 180px; color: var(--c-ink); max-height: 220px; overflow: auto; padding: 4px; border: var(--border-width) solid var(--c-line); border-radius: var(--control-radius); background: var(--c-paper); z-index: 45; }
    .tag-options button { display: block; height: var(--menu-row-height); width: 100%; padding-inline: 8px; text-align: left; }
    .tag-options button:hover, .tag-options .active { background: var(--c-sage); }
    .error { color: var(--c-reader-error-text); font-size: var(--font-min); }
</style>
<script lang="ts">
    import type { AttributeDefinition, AttributeValue } from "../../../shared/types/attributes";
    import { copyData, define, message, writeFromTab } from "./state.svelte";
    let { definition, value, tabId, disabled = false, onchange }: { definition: AttributeDefinition; value: AttributeValue; tabId: string; disabled?: boolean; onchange: (value: AttributeValue) => void } = $props();
    let root: HTMLDivElement;
    let query = $state(""), active = $state(0), open = $state(false), busy = $state(false), error = $state("");
    const options = $derived(definition.metadata.options ?? []), selected = $derived(Array.isArray(value) ? value : []);
    const chosen = $derived(options.filter(option => selected.includes(option.id)));
    const matches = $derived(options.filter(option => !selected.includes(option.id) && option.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
    $effect(() => {
        void query; active = 0;
    });
    async function choose(index: number): Promise<void> {
        if (disabled || busy) return;
        const existing = matches[index];
        if (existing) onchange([...selected, existing.id]);
        else if (query.trim()) {
            const name = query.trim(), same = options.find(item => item.name === name);
            if (same) onchange([...new Set([...selected, same.id])]);
            else {
                busy = true;
                try {
                    const fresh = { id: crypto.randomUUID(), name };
                    if (await writeFromTab(tabId, () => define(definition.id, { ...copyData(definition), metadata: { ...copyData(definition.metadata), options: [...copyData(options), fresh] } }, tabId))) onchange([...selected, fresh.id]);
                }
                catch (problem) {
                    error = message(problem); return;
                }
                finally {
                    busy = false;
                }
            }
        }
        query = ""; open = false;
    }
    function keydown(event: KeyboardEvent): void {
        if (event.isComposing) return;
        if (event.key === "Escape") {
            open = false; event.stopPropagation();
        }
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); open = true; active = Math.max(0, Math.min(matches.length - Number(!query.trim() || options.some(item => item.name === query.trim())), active + (event.key === "ArrowDown" ? 1 : -1)));
        }
        else if (event.key === "Enter" && open) {
            event.preventDefault(); void choose(active);
        }
    }
</script>