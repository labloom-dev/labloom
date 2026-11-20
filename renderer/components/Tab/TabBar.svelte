<script lang="ts">
    import { Tabs } from "bits-ui";
    import { type Snippet } from "svelte";
    import { commands } from "../../../shared/content/commands";
    import { commandLabel, t } from "../../i18n.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Menu from "../base/Menu.svelte";

    let { focused, canMerge, hasTabs, onsplit, onmerge, oncloseall, oncreate, ondragover, ondrop, children }: {
        focused: boolean; canMerge: boolean; hasTabs: boolean; onsplit: (down: boolean) => void;
        onmerge: () => void; oncloseall: () => void; oncreate: () => void; children: Snippet;
        ondragover?: (event: DragEvent) => void; ondrop?: (event: DragEvent) => void;
    } = $props();
    let list = $state<HTMLElement | null>(null);
    let alt = $state(false);
    const splitId = $derived(alt ? "splitDown" : "splitRight");
    function wheel(event: WheelEvent): void {
        if (!list || list.scrollWidth <= list.clientWidth) return;
        event.preventDefault(); list.scrollLeft += event.deltaY || event.deltaX;
    }
</script>

<svelte:window onkeydown={event => alt = event.altKey} onkeyup={event => alt = event.altKey} onblur={() => alt = false} />
<div class="group-header" class:focused role="presentation" {ondragover} {ondrop} onwheel={wheel} ondblclick={event => {
    if (event.target instanceof Element && !event.target.closest(".tab,button")) oncreate();
}}>
    <Tabs.List bind:ref={list} class="tab-list">{@render children()}</Tabs.List>
    <IconButton icon={alt ? "split-vertical" : "split-horizontal"} label={commandLabel(splitId)} shortcut={commands[splitId].shortcut}
        onpointerenter={event => alt = event.altKey} onclick={event => onsplit(event.altKey || alt)} />
    <Menu items={[
        { label: commandLabel("splitDown"), onselect: () => onsplit(true) },
        { label: commandLabel("mergeGroup"), disabled: !canMerge, onselect: onmerge },
        { label: t("shell.closeAll"), disabled: !hasTabs, onselect: oncloseall }
    ]}>
        {#snippet trigger({ props })}<IconButton {...props} icon="ellipsis" label={t("shell.groupActions")} />{/snippet}
    </Menu>
</div>

<style>
    .group-header { display: flex; align-items: center; flex: none; height: var(--ui-tabbar-height); padding-right: var(--ui-space-2); background: var(--ui-surface-panel); color: var(--ui-text-secondary); box-shadow: inset 0 calc(-1 * var(--ui-stroke)) var(--ui-divider); }
    .group-header > :global(.tab-list) { display: flex; align-self: stretch; overflow-x: auto; min-width: 0; flex: 1; scrollbar-width: none; }
    .group-header > :global(.ui-icon-button) { flex: none; }
</style>