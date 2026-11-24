import type { FeedScope } from "../../../shared/workspace/feed";
import type { FeedSource, FeedSourceAction } from "../../../shared/types/feed";
import { t } from "../../i18n.svelte";
import type { MenuItem } from "../base/Menu.svelte";

export function sourceMenu(scope: FeedScope, source: FeedSource | undefined, anyRefreshing: boolean, canRefresh: boolean, unread: number, actions: {
    refresh: (id?: string) => void;
    edit: (source: FeedSource) => void;
    status: (source: FeedSource, action: FeedSourceAction) => void;
    markAll: (source?: FeedSource) => void;
}): MenuItem[] {
    if (scope === "all") return [
        { label: t("feed.refreshAll"), icon: "refresh", disabled: anyRefreshing || !canRefresh, onselect: () => actions.refresh() },
        { label: t("feed.markAllRead"), icon: "check", disabled: !unread, onselect: () => actions.markAll() }
    ];
    if (!source) return [];
    if (source.status === "cancelled") return [{ label: t("feed.resubscribe"), icon: "undo", onselect: () => actions.status(source, "resume") }];
    const paused = source.status === "paused";
    return [
        { label: t("feed.refresh"), icon: "refresh", disabled: paused || source.refreshing, onselect: () => actions.refresh(source.id) },
        { label: t("feed.editSource"), icon: "edit", onselect: () => actions.edit(source) },
        { label: t(paused ? "feed.resume" : "feed.pause"), icon: paused ? "undo" : "debug-pause", onselect: () => actions.status(source, paused ? "resume" : "pause") },
        { label: t("feed.markAllRead"), icon: "check", disabled: !source.unreadCount, onselect: () => actions.markAll(source) },
        { label: t("feed.cancel"), icon: "close", onselect: () => actions.status(source, "cancel") }
    ];
}