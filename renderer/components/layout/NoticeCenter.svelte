<script lang="ts">
    import { onMount, tick, untrack } from "svelte";
    import { isBuiltin } from "../../../shared/attrs/builtins";
    import { secondsToSecond } from "../../../shared/content/time";
    import type { Notice } from "../../../shared/types/knowledge";
    import { commandLabel, failure, message, t, type ErrorValue } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Menu, { type MenuItem } from "../base/Menu.svelte";
    import Popover from "../base/Popover.svelte";
    import VirtualList from "../base/VirtualList.svelte";
    import { pickerValueText } from "../base/date-picker";
    import { perform } from "../Knowledge/feedback.svelte";
    import { openPage } from "./navigation";
    import { currentTimeZone } from "./preferences.svelte";
    import { shell } from "./shell.svelte";

    let rows = $state.raw<Notice[]>([]), unread = $state(0), pending = $state(true), error = $state<ErrorValue>("");
    let version = 0, alive = true;
    let list: VirtualList, bell: HTMLButtonElement;
    let focused = $state<string>();
    let skipRestore = false;
    const zone = $derived(currentTimeZone());
    const byId = $derived(new Map(rows.map(notice => [
        JSON.stringify([notice.pageId, notice.attrId, notice.leadSeconds, notice.firedAt]), notice
    ])));
    const ids = $derived([...byId.keys()]);
    let contextOpen = $state(false), target = $state<string>(), point = $state({ x: 0, y: 0 });
    const anchor = { getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) };
    const contextItems = $derived.by((): MenuItem[] => {
        const notice = target && byId.get(target);
        if (!notice) return [];
        return [
            { label: t(notice.seen ? "notice.markUnread" : "notice.markRead"), onselect: () => act(() => setRead(notice, !notice.seen)) },
            { label: t("notice.clear"), onselect: () => act(() => window.api.timers.clearNotice(notice)) }
        ];
    });
    function setRead(notice: Notice, seen: boolean): Promise<void> {
        return seen ? window.api.timers.readNotice(notice.pageId, notice.attrId, notice.leadSeconds, notice.firedAt)
            : window.api.timers.unreadNotice(notice);
    }
    function act(action: () => Promise<void>): void {
        void perform(action);
    }
    function openNotice(id: string): void {
        const notice = byId.get(id);
        if (!notice) return;
        act(async () => {
            if (!notice.seen) await setRead(notice, true);
            skipRestore = true;
            shell.noticesOpen = false;
            openPage(notice.pageId);
        });
    }
    function onContext(id: string, x: number, y: number): void {
        focused = target = id;
        point = { x, y };
        contextOpen = true;
    }
    function attributeLabel(notice: Notice): string {
        return isBuiltin(notice.attrId) ? t(`attributeName.${notice.attrId}`) : notice.attrName;
    }
    async function refresh(show: boolean): Promise<void> {
        const request = ++version;
        try {
            if (!show) {
                const total = await window.api.timers.unreadCount();
                if (alive && version === request) unread = total;
                return;
            }
            const result = await window.api.timers.notices();
            if (!alive || version !== request) return;
            const position = list?.position();
            rows = result;
            unread = result.filter(notice => !notice.seen).length;
            error = "";
            pending = false;
            await tick();
            if (alive && version === request) list?.restorePosition(position);
        }
        catch (problem) {
            if (alive && version === request) {
                error = failure(problem);
                pending = false;
            }
        }
    }
    $effect(() => {
        if (!shell.noticesOpen) return;
        untrack(() => {
            skipRestore = false;
            if (!rows.length) pending = true;
            void refresh(true);
        });
    });
    onMount(() => {
        if (!shell.noticesOpen) void refresh(false);
        const stop = window.api.pages.onChanged(change => {
            const show = shell.noticesOpen;
            if (change.notices || change.definition || change.purged?.length || change.recycledPages?.length
                || show && change.titlePages?.some(id => rows.some(notice => notice.pageId === id))) void refresh(show);
        });
        return () => {
            alive = false;
            stop();
            shell.noticesOpen = false;
        };
    });
</script>

<Popover label={t("notice.title")} side="right" align="end" bind:open={() => shell.noticesOpen, open => shell.noticesOpen = open}
    contentProps={{ role: "dialog", class: "notice-popup",
        onOpenAutoFocus: event => {
            event.preventDefault();
            void tick().then(() => list?.focus());
        },
        onCloseAutoFocus: event => {
            event.preventDefault();
            if (!skipRestore) bell?.focus({ preventScroll: true });
        },
        onInteractOutside: event => {
            if (!(event.target instanceof Node && bell?.contains(event.target))) skipRestore = true;
        } }}>
    {#snippet trigger({ props })}
        <IconButton {...props} class="notification-toggle" icon="bell" size="var(--ui-icon-large)" badge={unread}
            label={unread ? t("notice.unreadCount", { count: unread }) : commandLabel("showNotices")} pressed={shell.noticesOpen}
            {@attach (element: HTMLButtonElement) => {
                bell = element;
            }} />
    {/snippet}
    <header>
        <h2>{t("notice.title")}</h2>
        <IconButton icon="check" label={t("notice.readAll")} disabled={!unread || pending} onclick={() => act(() => window.api.timers.readAllNotices())} />
        <IconButton icon="trash" label={t("notice.clearAll")} disabled={!rows.length || pending} onclick={() => act(() => window.api.timers.clearAllNotices())} />
    </header>
    {#if error}<div role="alert">{message(error)} <Button onclick={() => void refresh(true)}>{t("dialog.retry")}</Button></div>{/if}
    <VirtualList bind:this={list} {ids} {pending} label={t("notice.title")} empty={t("notice.empty")}
        selected={focused && byId.has(focused) ? focused : ids[0]} onrange={() => {}} onmove={id => focused = id} onopen={openNotice} oncontext={onContext}>
        {#snippet row(id)}
            {@const notice = byId.get(id)}
            {#if notice}
                <div class="notice-row" class:unread={!notice.seen}>
                    <div class="notice-body">
                        <div class="notice-title" data-list-label>{notice.title || t("shell.untitled")}</div>
                        <div class="notice-details" data-list-label>
                            {attributeLabel(notice)} · {notice.attrValue === null ? t("property.empty") : pickerValueText(notice.attrType, notice.attrValue, zone)} · {secondsToSecond(notice.firedAt, zone)}
                        </div>
                    </div>
                    <IconButton icon="close" class="clear" label={t("notice.clear")} tabindex={-1} onclick={event => {
                        event.stopPropagation();
                        act(() => window.api.timers.clearNotice(notice));
                    }} />
                </div>
            {/if}
        {/snippet}
    </VirtualList>
    <Menu bind:open={contextOpen} {anchor} items={contextItems} first onrestore={() => list?.focus()} />
</Popover>

<style>
    :global(.notice-popup.ui-popover) { display: flex; flex-direction: column; width: 30em; height: min(27em, var(--bits-popover-content-available-height)); padding: 0; }
    header { display: flex; align-items: center; flex: none; gap: var(--ui-space-1); min-height: var(--ui-toolbar-height); padding-inline: var(--ui-space-3); border-bottom: var(--ui-stroke) solid var(--ui-divider); }
    h2 { flex: 1; margin: 0; font-size: var(--ui-font-body); }
    [role="alert"] { padding: var(--ui-space-2); color: var(--ui-text-danger); }
    .notice-row { display: flex; align-items: center; gap: var(--ui-space-2); min-width: 0; height: 100%; }
    .notice-body { flex: 1; min-width: 0; }
    .notice-title, .notice-details { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .notice-title { position: relative; padding-inline-start: var(--ui-space-3); }
    .notice-details { padding-inline-start: var(--ui-space-3); font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
    .unread .notice-title { font-weight: 600; }
    .unread .notice-title::before { content: ""; position: absolute; inset: 50% auto auto 0; width: var(--ui-space-2); height: var(--ui-space-2); border-radius: 50%; background: var(--ui-accent); transform: translateY(-50%); }
    .notice-row :global(.clear) { flex: none; opacity: 0; pointer-events: none; }
    .notice-row:is(:hover, :focus-within) :global(.clear) { opacity: 1; pointer-events: auto; }
</style>