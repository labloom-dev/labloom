<script lang="ts">
    import { Tabs } from "bits-ui";
    import { type Command } from "../../../shared/content/commands";
    import { type PageSearchResult } from "../../../shared/types/content";
    import { commandLabel, t } from "../../i18n.svelte";
    import Button from "../../components/base/Button.svelte";
    import ListRow from "../../components/base/ListRow.svelte";
    import Popover from "../../components/base/Popover.svelte";
    import NavBar from "../../components/layout/NavBar.svelte";
    import ActivityBar from "../../components/layout/ActivityBar.svelte";
    import SidePanel from "../../components/layout/SidePanel.svelte";
    import PanelGroup from "../../components/layout/PanelGroup.svelte";
    import { type Destination, destinationIcons } from "../../components/layout/destinations";
    import TabBar from "../../components/Tab/TabBar.svelte";
    import TabItem from "../../components/Tab/TabItem.svelte";
    import Resizer from "../../components/utils/Resizer.svelte";
    import SearchTrigger from "../../components/globalSearch/SearchTrigger.svelte";
    import GSPopover, { type SearchChoice } from "../../components/globalSearch/GSPopover.svelte";
    import { type IconName } from "../../components/utils/Icon.svelte";

    type ExampleTab = { id: string; title: string; icon: IconName; dirty?: boolean; syncing?: boolean };
    type Group = { id: number; active: string; tabs: ExampleTab[] };
    const pages = [
        { id: "A", title: "材料 A", kind: "editable", body: "材料改变后，重新记录测量值。" },
        { id: "B", title: "测量记录 B", kind: "paper", body: "第二次测量使用同一批材料。" }
    ] as const;
    let groups = $state<Group[]>([
        { id: 1, active: "A", tabs: [{ id: "A", title: pages[0].title, icon: "edit", dirty: true }, { id: "B", title: pages[1].title, icon: "book", syncing: true }] },
        { id: 2, active: "calendar", tabs: [{ id: "calendar", title: "日历", icon: "calendar" }] }
    ]);
    let focused = $state(1), sideBySide = $state(true), nextId = 3, width = $state(200);
    let collapsed = $state(false), filter = $state(""), expanded = $state(true), overlay = $state(false), query = $state("材料");
    let activeDestination = $state<Destination>("library");
    const group = $derived(groups.find(item => item.id === focused)!);
    const format = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" });
    function add(tab: ExampleTab): void {
        if (!group.tabs.some(item => item.id === tab.id)) group.tabs.push(tab);
        group.active = tab.id;
    }
    function openDestination(id: Destination): void {
        activeDestination = id; add({ id, title: commandLabel(id), icon: destinationIcons[id] });
    }
    function split(down: boolean): void {
        const current = group.tabs.find(tab => tab.id === group.active);
        const id = nextId++;
        groups.push({ id, active: current?.id ?? "", tabs: current ? [{ ...current }] : [] });
        focused = id; sideBySide = !down;
    }
    function merge(): void {
        if (groups.length < 2) return;
        const source = group, target = groups.find(item => item !== source)!;
        focused = target.id;
        for (const tab of source.tabs) add(tab);
        groups = groups.filter(item => item.id !== source.id);
    }
    function close(owner: Group, id: string): void {
        owner.tabs = owner.tabs.filter(tab => tab.id !== id);
        if (owner.active === id) owner.active = owner.tabs.at(-1)?.id ?? "";
    }
    function command(id: Command): void {
        if (id === "sidebar") collapsed = !collapsed;
        else if (id === "search" || id === "commandPalette") {
            if (id === "commandPalette") query = ">";
            overlay = true;
        }
        else if (id === "mergeGroup") merge();
        else if (id === "splitRight" || id === "splitDown") split(id === "splitDown");
        else if (id === "closeTab") close(group, group.active);
        else if (id === "newPage") add({ id: String(nextId++), title: t("shell.untitled"), icon: "edit" });
        else if (id in destinationIcons) openDestination(id as Destination);
    }
    function choose(choice: SearchChoice): void {
        overlay = false;
        if ("command" in choice) command(choice.command);
        else {
            const page = pages.find(item => item.id === choice.page)!;
            if (choice.otherGroup && groups.length > 1) focused = groups.find(item => item.id !== focused)!.id;
            add({ id: page.id, title: page.title, icon: page.kind === "editable" ? "edit" : "book" });
        }
    }
    async function search(keyword: string): Promise<{ items: PageSearchResult[]; total: number }> {
        const items: PageSearchResult[] = [];
        for (const page of pages) {
            const title = page.title.includes(keyword);
            if (title || page.body.includes(keyword)) items.push({ ...page, excerpt: page.body, attributes: {},
                match: title ? { field: "title" } : { field: "body", snippet: page.body } });
        }
        return { items, total: items.length };
    }
    const disabled = (id: Command): boolean => id === "mergeGroup" && groups.length === 1;
</script>

{#snippet palette()}
    <GSPopover bind:query {search} recent={async () => pages.map((page, i) => ({ ...page, openedAt: Date.UTC(2026, 10, 20, 6 - i) }))}
        {disabled} formatTime={ms => format.format(ms)} onchoose={choose} />
{/snippet}

<div class="spec-shell">
    <NavBar {collapsed} oncommand={command} {disabled}>
        <Popover label={t("quickOpen.input")} bind:open={overlay} align="center" contentProps={{ class: "example-picker" }}>
            {#snippet trigger({ props })}<SearchTrigger {...props} />{/snippet}
            {@render palette()}
        </Popover>
    </NavBar>
    <div class="workbench">
        <ActivityBar active={activeDestination} onopen={openDestination} />
        {#if !collapsed}
            <SidePanel {width} bind:filter>
                <PanelGroup groupKey="pinned" title={t("shell.pinned")} {expanded} ontoggle={() => expanded = !expanded}>
                    {#each pages.filter(page => page.title.includes(filter)) as page (page.id)}
                        <ListRow title={page.title} icon={page.kind === "paper" ? "book" : "edit"} selected={group.active === page.id}
                            buttonProps={{ tabindex: -1, "data-panel-node": "page", "data-panel-key": page.id }} onclick={event => choose({ page: page.id, otherGroup: event.ctrlKey })} />
                    {/each}
                </PanelGroup>
            </SidePanel>
            <Resizer direction="vertical" label={t("shell.resizePanel")} origin={width} min={120} max={320} changeCB={value => width = value} />
        {/if}
        <div class="example-groups" class:stacked={!sideBySide}>
            {#each groups as owner (owner.id)}
                <div class="example-group" role="presentation" onfocusin={() => focused = owner.id} onpointerdowncapture={() => focused = owner.id}>
                    <Tabs.Root bind:value={owner.active}>
                        <TabBar focused={focused === owner.id} canMerge={groups.length > 1} hasTabs={!!owner.tabs.length} onsplit={split} onmerge={merge}
                            oncloseall={() => {
                                owner.tabs = []; owner.active = "";
                            }} oncreate={() => command("newPage")}>
                            {#each owner.tabs as tab (tab.id)}
                                <TabItem {...tab} active={tab.id === owner.active} onactivate={() => owner.active = tab.id} onclose={() => close(owner, tab.id)}
                                    menu={[{ label: t("shell.close"), onselect: () => close(owner, tab.id) }]} />
                            {/each}
                        </TabBar>
                    </Tabs.Root>
                </div>
            {/each}
        </div>
    </div>
</div>
<h3>搜索面板</h3>
<div class="mode-choice">
    {#each [["页面结果", "材料"], ["命令", ">拆分"], ["最近打开", ""]] as [label, value] (label)}
        <Button variant="text" aria-pressed={query === value} onclick={() => {
            query = value; overlay = false;
        }}>{label}</Button>
    {/each}
</div>
<div class="ui-popup example-picker">{@render palette()}</div>

<style>
    .spec-shell { position: relative; border: var(--ui-stroke) solid var(--ui-divider); background: var(--ui-surface-window); margin-bottom: var(--ui-space-5); }
    .workbench, .example-groups { display: flex; min-width: 0; }
    .workbench { height: calc(6 * var(--ui-activity-item-height)); overflow: hidden; }
    .example-groups, .example-group { flex: 1; min-width: 0; }
    .example-group + .example-group { border-left: var(--ui-stroke) solid var(--ui-divider); }
    .example-groups.stacked { flex-direction: column; }
    .example-picker { width: min(100%, var(--ui-search-width)); }
    :global(.ui-popover.example-picker) { width: min(var(--ui-search-width), calc(100vw - 2 * var(--ui-space-3))); padding: 0; }
    .mode-choice { display: flex; gap: var(--ui-space-2); margin-bottom: var(--ui-space-2); }
</style>