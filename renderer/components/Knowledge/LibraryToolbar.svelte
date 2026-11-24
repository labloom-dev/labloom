<script lang="ts">
    import type { Snippet } from "svelte";
    import type { ViewParams } from "../../../shared/workspace/views";
    import { t } from "../../i18n.svelte";
    import Input from "../base/Input.svelte";
    import Button from "../base/Button.svelte";
    import Select from "../base/Select.svelte";
    import Popover from "../base/Popover.svelte";

    type Scope = ViewParams["library"]["scope"];
    let { scope, keyword = $bindable(""), filtered, busy, pending, empty, restrictedTrash, filters, onscope, oncreate, onimport, onempty }: {
        scope: Scope; keyword?: string; filtered: boolean; busy: boolean; pending: boolean; empty: boolean; restrictedTrash: boolean; filters: Snippet;
        onscope: (value: Scope) => void; oncreate: () => void; onimport: () => void; onempty: () => void;
    } = $props();
    const scopes = $derived([{ value: "all", label: t("library.all") }, { value: "pinned", label: t("shell.pinned") }, { value: "trash", label: t("shell.trashView") }]);
</script>

<header class="library-toolbar">
    <Select label={t("library.scope")} options={scopes} value={scope} onchange={value => onscope(value as Scope)} />
    <div class="search" class:pending><Input search clearLabel={t("shell.clearFilter")} label={t("library.search")} placeholder={t("library.search")} bind:value={keyword} /></div>
    <Popover label={t("library.filter")} align="end">
        {#snippet trigger({ props })}<Button {...props} aria-pressed={filtered}>{t("library.filter")}</Button>{/snippet}
        {@render filters()}
    </Popover>
    {#if scope === "trash"}
        <Button disabled={busy || empty} onclick={onempty}>{t(restrictedTrash ? "library.purgeResults" : "library.emptyTrash")}</Button>
    {:else}
        <Button disabled={busy} onclick={oncreate}>{t("library.create")}</Button>
        <Button disabled={busy} onclick={onimport}>{t("command.importPDF")}</Button>
    {/if}
</header>

<style>
    .library-toolbar { display: flex; align-items: center; flex: none; gap: var(--ui-space-2); min-height: var(--ui-toolbar-height); padding-inline: var(--ui-space-2); border-bottom: var(--ui-stroke) solid var(--ui-divider); overflow-x: auto; }
    .pending::after { content: ""; position: absolute; inset: auto 0 0; height: var(--ui-active-border); background: var(--ui-accent); animation: progress 1s ease-in-out infinite alternate; transform-origin: left; }
    @keyframes progress { from { transform: scaleX(.2); } to { transform: scaleX(1); } }
    .search { position: relative; flex: 1; min-width: var(--ui-icon-large); }
    .search :global(.ui-field) { width: 100%; }
    header :global(button) { flex-shrink: 0; white-space: nowrap; }
    header :global([aria-pressed="true"]) { background: var(--ui-selected); color: var(--ui-text-selected); }
</style>