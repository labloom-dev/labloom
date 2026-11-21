<script lang="ts">
    import { onMount, tick } from "svelte";
    import Icon, { type IconName } from "../utils/Icon.svelte";
    import "./controls.css";

    let { items, selected, onselect, bounds, label }: {
        items: { label: string; icon: IconName; shortcut?: string; group: number }[]; selected: number;
        onselect: (index: number) => void; bounds: () => DOMRect; label: string;
    } = $props();
    let element: HTMLDivElement;
    function position(): void {
        const caret = bounds(), rect = element.getBoundingClientRect();
        element.style.left = Math.max(0, Math.min(caret.left, innerWidth - rect.width)) + "px";
        element.style.top = Math.max(0, caret.bottom + rect.height <= innerHeight ? caret.bottom : caret.top - rect.height) + "px";
    }
    onMount(() => {
        element.showPopover();
        position();
        window.addEventListener("scroll", position, true);
        window.addEventListener("resize", position);
        return () => {
            window.removeEventListener("scroll", position, true); window.removeEventListener("resize", position);
        };
    });
    $effect(() => {
        void items; const row = selected;
        void tick().then(() => {
            if (!element?.isConnected) return;
            position(); element.querySelectorAll("button")[row]?.scrollIntoView({ block: "nearest" });
        });
    });
</script>
<div bind:this={element} popover="manual" class="ui-popup ui-menu suggestion-menu" role="listbox" aria-label={label}>
    {#each items as item, index (item.label)}
        {#if index && item.group !== items[index - 1].group}<div class="ui-menu-separator"></div>{/if}
        <button type="button" role="option" aria-selected={index === selected} tabindex="-1" class="ui-menu-item" data-highlighted={index === selected || undefined}
            onpointerdown={event => event.preventDefault()} onclick={() => onselect(index)}>
            <span class="ui-menu-leading"><Icon name={item.icon} /></span><span class="ui-menu-label">{item.label}</span>
            {#if item.shortcut}<kbd class="ui-shortcut">{item.shortcut}</kbd>{/if}
        </button>
    {/each}
</div>
<style>
    .suggestion-menu { position: fixed; inset: auto; margin: 0; max-height: min(60vh, var(--ui-editor-preview-width)); overflow-y: auto; }
    .ui-menu-item { align-items: center; border: 0; background: transparent; color: inherit; text-align: start; }
</style>