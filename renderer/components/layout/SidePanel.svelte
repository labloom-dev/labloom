<script lang="ts">
    import { type Snippet } from "svelte";
    import { commandLabel, t } from "../../i18n.svelte";
    import Input from "../base/Input.svelte";
    import { panelNavigation } from "./panel-navigation";
    let { width, filter = $bindable(""), children }: { width: number; filter?: string; children: Snippet } = $props();
</script>

<aside class="left-panel" style:width={width + "px"}>
    <header>{commandLabel("library")}</header>
    <div class="filter"><Input search label={t("shell.filter")} placeholder={t("shell.filterHint")} clearLabel={t("shell.clearFilter")} bind:value={filter} /></div>
    <div class="groups" {@attach panelNavigation}>{@render children()}</div>
</aside>

<style>
    .left-panel { display: flex; flex-direction: column; flex: none; min-width: 0; min-height: 0; color: var(--ui-text); background: var(--ui-surface-panel); font: var(--ui-font-body)/1.3 var(--ui-font-family); }
    header { display: flex; align-items: center; height: var(--ui-tabbar-height); flex: none; padding-inline: var(--ui-space-4); font-size: var(--ui-font-small); font-weight: 600; }
    .filter { display: grid; padding: 0 var(--ui-space-3) var(--ui-space-2); }
    .groups { overflow: auto; flex: 1; min-height: 0; }
</style>