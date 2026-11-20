<script lang="ts">
    import { Tabs } from "bits-ui";
    import { t } from "../../i18n.svelte";
    import Icon, { type IconName } from "../utils/Icon.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Menu, { type MenuItem } from "../base/Menu.svelte";

    let { id, title, icon, active, dirty = false, syncing = false, menu, onactivate, onclose, ondragstart, ondrop }: {
        id: string; title: string; icon: IconName; active: boolean; dirty?: boolean; syncing?: boolean;
        menu: MenuItem[]; onactivate: () => void; onclose: () => void;
        ondragstart?: (event: DragEvent) => void; ondrop?: (event: DragEvent) => void;
    } = $props();
</script>

<Menu context items={menu}>
    {#snippet trigger({ props })}
        <div {...props} tabindex={-1} class="tab" class:active class:dirty draggable="true" role="presentation"
            {ondragstart} {ondrop} onmousedown={event => {
                if (event.button === 1) event.preventDefault();
            }}
            onauxclick={event => {
                if (event.button === 1) {
                    event.preventDefault(); onclose();
                }
            }}>
            <Tabs.Trigger value={id} class="ui-control tab-trigger" onclick={onactivate}>
                <Icon name={icon} size="var(--ui-icon-normal)" /><span class="tab-title">{title}</span>
                {#if syncing}<span role="status" aria-label={t("shell.syncing")}><Icon name="sync" size="var(--ui-icon-small)" /></span>{/if}
                {#if dirty}<span class="dirty-dot" role="img" aria-label={t("shell.unsaved")}><Icon name="circle-small-filled" size="var(--ui-icon-normal)" /></span>{/if}
            </Tabs.Trigger>
            <IconButton class="close-tab" icon="close" size="var(--ui-icon-small)" label={t("shell.closeNamed", { title })} onclick={event => {
                event.stopPropagation(); onclose();
            }} />
        </div>
    {/snippet}
</Menu>

<style>
    .tab { position: relative; display: flex; align-items: center; flex: none; min-width: var(--ui-tab-min-width); max-width: var(--ui-tab-max-width); border-right: var(--ui-stroke) solid var(--ui-divider); color: var(--ui-text-secondary); }
    .tab.active { background: var(--ui-surface-window); box-shadow: inset 0 var(--ui-active-border) var(--ui-divider); }
    :global(.group-header.focused) .tab.active { box-shadow: inset 0 var(--ui-active-border) var(--ui-accent); color: var(--ui-text); }
    .tab :global(.tab-trigger) { justify-content: flex-start; height: 100%; width: 100%; padding: 0 var(--ui-toolbar-height) 0 var(--ui-space-4); border: 0; border-radius: 0; color: inherit; background: var(--ui-surface-clear); outline-offset: calc(-1 * var(--ui-focus-width)); }
    .tab:focus-visible { outline: var(--ui-focus-width) solid var(--ui-focus); outline-offset: calc(-1 * var(--ui-focus-width)); }
    .tab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab :global(.close-tab), .dirty-dot { position: absolute; right: var(--ui-space-2); width: var(--ui-icon-large); height: var(--ui-icon-large); }
    .dirty-dot { display: grid; place-items: center; pointer-events: none; }
    .tab :global(.close-tab) { opacity: 0; }
    .tab:is(:hover, :focus-within) :global(.close-tab), .tab.active:not(.dirty) :global(.close-tab) { opacity: 1; }
    .tab:is(:hover, :focus-within) .dirty-dot { visibility: hidden; }
</style>