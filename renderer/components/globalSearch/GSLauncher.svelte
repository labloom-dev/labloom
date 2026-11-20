<script lang="ts">
    import { Popover } from "bits-ui";
    import { tick } from "svelte";
    import { type PageSummary } from "../../../shared/types/content";
    import { t } from "../../i18n.svelte";
    import { navigationState } from "../Tab/persistence.svelte";
    import { commandDisabled, prepareCommands, rememberFocus, runCommand } from "../layout/commands";
    import { openPage } from "../layout/navigation";
    import { appearance, currentTimeZone } from "../layout/preferences.svelte";
    import { shell, restoreSearchFocus, showSearch } from "../layout/shell.svelte";
    import GSPopover, { type SearchChoice } from "./GSPopover.svelte";
    import SearchTrigger from "./SearchTrigger.svelte";

    let input = $state<HTMLInputElement>(), trigger = $state<HTMLButtonElement | null>(null);
    let choice: SearchChoice | undefined;
    const clock = $derived(new Intl.DateTimeFormat(appearance.language, { dateStyle: "short", timeStyle: "short", timeZone: currentTimeZone() }));

    async function recent(): Promise<(PageSummary & { openedAt: number })[]> {
        const history = navigationState.recentPages;
        if (!history.length) return [];
        const { items } = await window.api.pages.list({ ids: history.map(entry => entry.id), limit: history.length });
        const byId = new Map(items.map(page => [page.id, page]));
        return history.flatMap(({ id, openedAt }) => {
            const page = byId.get(id);
            return page ? [{ ...page, openedAt }] : [];
        });
    }
    function setOpen(value: boolean): void {
        if (value) {
            prepareCommands(); showSearch(false);
        }
        else shell.search = false;
    }
    function opened(event: Event): void {
        event.preventDefault();
        void tick().then(() => {
            input?.focus({ preventScroll: true });
            if (shell.commandStart) input?.setSelectionRange(1, 1);
            else input?.select();
        });
    }
    async function finishClose(open: boolean): Promise<void> {
        if (open) return;
        await tick();
        if (shell.search) return;
        restoreSearchFocus();
        const selected = choice;
        choice = undefined;
        if (!selected) return;
        if ("page" in selected) openPage(selected.page, { currentGroup: true, otherGroup: selected.otherGroup });
        else {
            rememberFocus(); runCommand(selected.command);
        }
    }
</script>

<Popover.Root bind:open={() => shell.search, setOpen} onOpenChangeComplete={finishClose}>
    <Popover.Trigger bind:ref={trigger}>
        {#snippet child({ props })}
            <SearchTrigger {...props} onmousedown={event => event.preventDefault()} />
        {/snippet}
    </Popover.Trigger>
    <Popover.Portal>
        <Popover.Content class="ui-popup search-popup" aria-label={t("quickOpen.input")} align="center"
            sideOffset={-(trigger?.offsetHeight ?? 0)} collisionPadding={{ left: 8, right: 8 }} onOpenAutoFocus={opened} onCloseAutoFocus={event => event.preventDefault()}>
            {#if shell.search}
                <GSPopover bind:input bind:query={shell.query} search={(keyword, offset) => window.api.pages.search(keyword, offset)}
                    {recent} formatTime={ms => clock.format(ms)} disabled={commandDisabled}
                    onchoose={selected => {
                        if (shell.search) {
                            choice = selected; shell.search = false;
                        }
                    }} />
            {/if}
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>

<style>
    :global(.search-popup) {
        -webkit-app-region: no-drag;
        width: min(var(--ui-search-width), calc(100vw - 2 * var(--ui-space-3)));
        max-height: min(calc(100vh - var(--ui-space-5)), var(--bits-popover-content-available-height));
        overflow: hidden;
        z-index: var(--ui-z-popover);
    }
</style>