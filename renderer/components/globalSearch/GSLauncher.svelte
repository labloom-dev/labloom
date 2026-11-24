<script lang="ts">
    import { Popover } from "bits-ui";
    import { tick } from "svelte";
    import TopLayer from "../base/TopLayer.svelte";
    import { recent, search } from "./page-search";
    import { t } from "../../i18n.svelte";
    import { commandDisabled, prepareCommands, rememberFocus, runCommand } from "../layout/commands";
    import { openPage } from "../layout/navigation";
    import { appearance, currentTimeZone } from "../layout/preferences.svelte";
    import { shell, restoreSearchFocus, showSearch } from "../layout/shell.svelte";
    import GSPopover, { type SearchChoice } from "./GSPopover.svelte";
    import SearchTrigger from "./SearchTrigger.svelte";

    let input = $state<HTMLInputElement>(), trigger = $state<HTMLButtonElement | null>(null);
    let choice: SearchChoice | undefined;
    const clock = $derived(new Intl.DateTimeFormat(appearance.language, { dateStyle: "short", timeStyle: "short", timeZone: currentTimeZone() }));

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
    <Popover.Content class="ui-popup search-popup" aria-label={t("quickOpen.input")} align="center" strategy="fixed"
        sideOffset={-(trigger?.offsetHeight ?? 0)} collisionPadding={{ left: 8, right: 8 }} onOpenAutoFocus={opened} onCloseAutoFocus={event => event.preventDefault()}>
        {#snippet child({ props, wrapperProps })}
            <TopLayer props={wrapperProps}>
                <div {...props}>
                    {#if shell.search}
                        <GSPopover bind:input bind:query={shell.query} {search}
                            {recent} formatTime={ms => clock.format(ms)} disabled={commandDisabled}
                            onchoose={selected => {
                                if (shell.search) {
                                    choice = selected; shell.search = false;
                                }
                            }} />
                    {/if}
                </div>
            </TopLayer>
        {/snippet}
    </Popover.Content>
</Popover.Root>

<style>
    :global(.search-popup) {
        -webkit-app-region: no-drag;
        width: min(var(--ui-search-width), calc(100vw - 2 * var(--ui-space-3)));
        max-height: min(calc(100vh - var(--ui-space-5)), var(--bits-popover-content-available-height));
        overflow: hidden;
    }
</style>