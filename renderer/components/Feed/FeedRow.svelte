<script lang="ts">
    import type { FeedItem } from "../../../shared/types/feed";
    import { t } from "../../i18n.svelte";
    import Icon from "../utils/Icon.svelte";
    import { formatDate } from "./labels";

    let { item, overview = false }: { item: FeedItem; overview?: boolean } = $props();
</script>

<span class="title" class:unread={!overview && !item.isRead}>
    {#if !overview}<span class="dot" class:active={!item.isRead} role="img" aria-label={t(item.isRead ? "feed.read" : "feed.unread")}></span>{/if}
    <span data-list-label>{item.title || t("shell.untitled")}</span>
</span>
<span class="metadata">
    <span data-list-label>{[item.sourceName || t("shell.untitled"), overview ? "" : item.authors, formatDate(item.publishedAt)].filter(Boolean).join(" · ")}</span>
    {#if !overview && item.paperState === "saved"}<span class="saved" role="img" aria-label={t("feed.inLibrary")}><Icon name="book" size="var(--ui-icon-small)" /></span>{/if}
</span>

<style>
    .title, .metadata { display: flex; align-items: center; gap: var(--ui-space-2); min-width: 0; line-height: 1.4; }
    .title { font-size: var(--ui-font-body); }
    .unread { font-weight: 600; }
    .metadata { color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
    [data-list-label] { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dot { width: var(--ui-space-2); height: var(--ui-space-2); margin-inline: var(--ui-space-1); flex: none; border-radius: 50%; }
    .dot.active { background: var(--ui-accent); }
    .saved { flex: none; }
</style>