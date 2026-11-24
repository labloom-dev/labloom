<script lang="ts">
    import { isComposingKey } from "../../../shared/content/commands";
    import type { FeedSource } from "../../../shared/types/feed";
    import { message, t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Input from "../base/Input.svelte";
    import Tooltip from "../base/Tooltip.svelte";
    import { intervalLabel, formatDate } from "./labels";

    let { source, followed, keywords, total, onkeywords, onretry }: {
        source?: FeedSource; followed: boolean; keywords: string[]; total: number;
        onkeywords: (words: string[]) => Promise<boolean>; onretry: (id: string) => void;
    } = $props();
    const uid = $props.id();
    let word = $state(""), editing = $state(false), diagnostic = $state("");
    const failed = $derived(source?.status === "enabled" ? source.error : null);
    const open = $derived(!!failed?.diagnostic && diagnostic === source?.id + failed.diagnostic);
    async function save(words: string[], added?: string): Promise<void> {
        if (editing) return;
        editing = true;
        try {
            if (await onkeywords(words) && word === added) word = "";
        }
        finally {
            editing = false;
        }
    }
    function keydown(event: KeyboardEvent): void {
        if (event.key !== "Enter" || isComposingKey(event)) return;
        event.preventDefault();
        if (word.trim()) void save([...keywords, word.trim()], word);
    }
</script>

{#if source || followed || total}
    <div class="feed-status">
        {#if source}
            {#if source.status === "cancelled"}<span>{t("feed.cancelled")}</span>
            {:else if source.status === "paused"}<span>{t("feed.paused")}</span>
            {:else if failed}
                <Tooltip text={message(failed)} canOpen={element => element.scrollWidth > element.clientWidth}>
                    {#snippet trigger({ props })}<span {...props} class="failed">{message(failed)}</span>{/snippet}
                </Tooltip>
                <Button disabled={source.refreshing} onclick={() => onretry(source.id)}>{t("dialog.retry")}</Button>
                {#if failed.diagnostic}
                    <Button variant="text" aria-expanded={open} aria-controls={uid} onclick={() => diagnostic = open ? "" : source.id + failed.diagnostic}>
                        {t("dialog.details")}
                    </Button>
                {/if}
            {:else}
                <span class="last-refresh">{source.lastRefreshed === null ? t("feed.neverRefreshed") : t("feed.lastRefreshed", { time: formatDate(source.lastRefreshed) })}
                    · {source.autoRefresh ? t("feed.refreshInterval", { interval: intervalLabel(source.intervalMinutes) }) : t("feed.manualRefresh")}</span>
            {/if}
        {:else if followed}
            <div class="keywords">
                {#each keywords as keyword (keyword)}
                    <span class="keyword"><span>{keyword}</span>
                        <IconButton label={t("feed.removeKeyword", { word: keyword })} icon="close" size="var(--ui-icon-small)" disabled={editing}
                            onclick={() => void save(keywords.filter(entry => entry !== keyword))} />
                    </span>
                {/each}
                <Input label={t("feed.addKeyword")} placeholder={t("feed.addKeyword")} bind:value={word} inputProps={{ onkeydown: keydown }} />
            </div>
        {/if}
        <span class="total">{t("feed.count", { count: total })}</span>
    </div>
    {#if open}<div class="diagnostic" id={uid}>{failed?.diagnostic}</div>{/if}
{/if}

<style>
    .feed-status { display: flex; align-items: center; gap: var(--ui-space-2); padding-inline: var(--ui-space-3); min-height: var(--ui-toolbar-height); flex: none; min-width: 0; font-size: var(--ui-font-small); line-height: 1.3; color: var(--ui-text-secondary); }
    .feed-status :global(button) { font-size: inherit; flex: none; }
    .total { flex: none; margin-inline-start: auto; white-space: nowrap; }
    .last-refresh { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .failed { color: var(--ui-warning); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .diagnostic { color: var(--ui-text-secondary); white-space: pre-wrap; overflow: auto; max-height: 10em; user-select: text; padding: var(--ui-space-2) var(--ui-space-3); font: var(--ui-font-small)/1.4 var(--ui-font-mono); }
    .keywords { display: flex; align-items: center; gap: var(--ui-space-2); overflow-x: auto; min-width: 0; padding-block: var(--ui-space-1); }
    .keywords :global(.ui-field) { width: 9em; flex: none; }
    .keyword { flex: none; display: inline-flex; align-items: center; border-radius: var(--ui-radius-control); background: var(--ui-surface-panel); padding-inline-start: var(--ui-space-2); white-space: nowrap; }
    .keyword :global(.ui-icon-button) { height: var(--ui-icon-large); width: var(--ui-icon-large); }
</style>