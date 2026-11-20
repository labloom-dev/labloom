<ActivityBar active={activeDestination} onopen={openDestination} />
{#if !shell.collapsed}
    <SidePanel width={shell.width} bind:filter>
        <SidebarGroup groupKey="pinned" title={t("shell.pinned")} query={{ pinned: true }} keyword={applied} {currentPage} />
        {#each tags as tag (tag.id)}<SidebarGroup groupKey={"tag:" + tag.id} title={tag.name} query={{ tags: [tag.id] }} keyword={applied} {currentPage} />{/each}
        <SidebarGroup groupKey="independent" title={t("shell.independent")} query={{ attributes: { independent: true } }} keyword={applied} {currentPage} />
    </SidePanel>
    <Resizer direction="vertical" label={t("shell.resizePanel")} origin={shell.width} min={minPanelWidth} max={maxPanelWidth} changeCB={value => {
        shell.width = value; persistPanel();
    }} />
{/if}
<script lang="ts">
    import SidePanel from "./SidePanel.svelte";
    import ActivityBar from "./ActivityBar.svelte";
    import { t } from "../../i18n.svelte";
    import { onMount } from "svelte";
    import { tabState } from "../Tab/state.svelte";
    import Resizer from "../utils/Resizer.svelte";
    import SidebarGroup from "./SidebarGroup.svelte";
    import { destinationViews, sameView, openDestination } from "./navigation";
    import { type Destination } from "./destinations";
    import { minPanelWidth, maxPanelWidth } from "../../../shared/settings/defaults";
    import { shell, persistPanel } from "./shell.svelte";
    let tags = $state<{ id: string; name: string }[]>([]), filter = $state(""), applied = $state("");
    const group = $derived(tabState.groups.find(group => group.id === tabState.focusedGroupId));
    const activeView = $derived(group?.tabs.find(tab => tab.id === group.activeTabId)?.view);
    const currentPage = $derived(activeView?.type === "page" ? activeView.params.page.id : undefined);
    const activeDestination = $derived((Object.keys(destinationViews) as Destination[]).find(id => sameView(activeView, destinationViews[id])));
    $effect(() => {
        const value = filter; const timer = setTimeout(() => applied = value, 200); return () => clearTimeout(timer);
    });
    onMount(() => {
        let live = true;
        const load = (): void => {
            void window.api.attributes.definitions().then(definitions => {
                if (live) tags = definitions.find(item => item.id === "tags")?.metadata.options ?? [];
            });
        };
        load();
        const off = window.api.pages.onChanged(change => {
            if (change.definition === "tags") load();
        });
        return () => {
            live = false; off();
        };
    });
</script>