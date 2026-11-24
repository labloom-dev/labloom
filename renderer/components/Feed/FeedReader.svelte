<script lang="ts">
    import { onMount, untrack } from "svelte";
    import type { FeedItemDetail } from "../../../shared/types/feed";
    import { message, t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import { sanitizeContent } from "./content";
    import { formatDate } from "./labels";

    let { item, single, shown, importing, downloading, previous, next, onback, onnavigate, onoriginal, onread, onimport, onpdf, onpaper, onposition }: {
        item?: FeedItemDetail; single: boolean; shown: boolean; importing: boolean; downloading: boolean; previous: boolean; next: boolean;
        onback: () => void; onnavigate: (delta: number) => void; onoriginal: (id: string) => void; onread: (id: string, value: boolean) => void;
        onimport: (id: string, replace?: boolean) => void; onpdf: (id: string) => void; onpaper?: (id: string) => void;
        onposition: (id: string, progress: number) => void;
    } = $props();

    let viewport: HTMLElement;
    let writing: ReturnType<typeof setTimeout> | undefined, moved = false, restoring = false, restored = "";
    const id = $derived(item?.id), content = $derived(item?.content ?? ""), base = $derived(item?.url);

    function markup(html: string, url?: string | null): (node: HTMLElement) => void {
        return node => node.replaceChildren(sanitizeContent(html, url));
    }
    export function savePosition(): void {
        clearTimeout(writing);
        if (!moved || !item || !viewport?.clientHeight) return;
        moved = false;
        const range = viewport.scrollHeight - viewport.clientHeight;
        onposition(item.id, range > 0 ? Math.max(0, Math.min(1, viewport.scrollTop / range)) : 0);
    }
    function scrolled(): void {
        if (restoring || !item || !viewport.clientHeight) return;
        moved = true;
        clearTimeout(writing);
        writing = setTimeout(savePosition, 500);
    }
    $effect(() => {
        if (!id) {
            restored = "";
            return;
        }
        if (!shown || id === restored) return;
        restored = id;
        restoring = true; moved = false;
        viewport.scrollTop = untrack(() => (item?.readingPosition?.progress ?? 0) * Math.max(0, viewport.scrollHeight - viewport.clientHeight));
        const frame = requestAnimationFrame(() => restoring = false);
        return () => {
            cancelAnimationFrame(frame);
            restoring = false;
        };
    });
    onMount(() => {
        window.addEventListener("workspace-flush", savePosition);
        return () => {
            window.removeEventListener("workspace-flush", savePosition);
            savePosition();
        };
    });
</script>

<div class="feed-reader" role="region" aria-label={t("feed.reader")} bind:this={viewport} onscroll={scrolled}>
    {#if item}
        {@const article = item}
        {@const busy = downloading || article.pdfStatus === "downloading"}
        <header class="reader-toolbar">
            {#if single}<IconButton icon="arrow-left" label={t("feed.back")} onclick={onback} />{/if}
            <IconButton icon="link-external" label={t("feed.openOriginal")} disabled={!article.url} onclick={() => onoriginal(article.id)} />
            <IconButton icon={article.isRead ? "circle-small-filled" : "check"} label={t(article.isRead ? "feed.markUnread" : "feed.markRead")}
                onclick={() => onread(article.id, !article.isRead)} />
            {#if article.paperState === "saved" && article.paperId}
                <IconButton icon="book" label={t("feed.openPaper")} disabled={!onpaper} onclick={() => onpaper?.(article.paperId!)} />
                {#if article.pdfURL && article.pdfStatus !== "saved"}
                    <IconButton icon={busy ? "loading" : "refresh"} label={t(busy ? "feed.fetchingPDF" : "feed.retryPDF")}
                        aria-busy={busy} disabled={busy} onclick={() => onpdf(article.id)} />
                {/if}
            {:else if article.paperState === "none"}
                <IconButton icon={importing ? "loading" : "add"} label={t(importing ? "feed.importing" : "feed.importPaper")} disabled={importing}
                    onclick={() => onimport(article.id)} />
            {/if}
            <div class="navigation">
                <IconButton icon="arrow-up" label={t("feed.previous")} disabled={!previous} onclick={() => onnavigate(-1)} />
                <IconButton icon="arrow-down" label={t("feed.next")} disabled={!next} onclick={() => onnavigate(1)} />
            </div>
        </header>
        {#if article.paperState === "recycled" || article.paperState === "missing"}
            <div class="reader-status">
                {t(article.paperState === "recycled" ? "dialog.reimportRecycled" : "dialog.reimportMissing")}
                <Button disabled={importing} onclick={() => onimport(article.id, true)}>{t("dialog.reimport")}</Button>
            </div>
        {:else if article.paperState === "saved" && article.pdfStatus === "failed"}
            <div class="reader-status failed" role="alert">{message(article.pdfFailure ?? { kind: "pdf-unavailable" })}</div>
        {/if}
        <article class="article">
            <h2>{article.title || t("shell.untitled")}</h2>
            <div class="metadata">
                <span>{[article.sourceName || t("shell.untitled"), formatDate(article.publishedAt), article.authors].filter(Boolean).join(" · ")}</span>
                {#if !article.fullContent}<span class="badge">{t("feed.summaryOnly")}</span>{/if}
            </div>
            {#if content}<div class="feed-content" {@attach markup(content, base)}></div>
            {:else if article.summary}<div class="feed-content plain">{article.summary}</div>{/if}
        </article>
    {/if}
</div>

<style>
    .feed-reader { flex: 1; min-height: 0; overflow: auto; overflow-anchor: none; background: var(--ui-surface-window); }
    .reader-toolbar { position: sticky; inset-block-start: 0; z-index: 1; display: flex; align-items: center; gap: var(--ui-space-2); min-height: var(--ui-toolbar-height); padding-inline: var(--ui-space-3); border-bottom: var(--ui-stroke) solid var(--ui-divider); background: var(--ui-surface-window); }
    .navigation { display: flex; gap: var(--ui-space-2); margin-inline-start: auto; }
    .reader-status { display: flex; align-items: center; gap: var(--ui-space-3); padding: var(--ui-space-2) var(--ui-space-3); color: var(--ui-text-secondary); font-size: var(--ui-font-small); line-height: 1.4; border-bottom: var(--ui-stroke) solid var(--ui-divider); }
    .reader-status :global(button) { flex: none; }
    .failed { color: var(--ui-warning); }
    .article { max-width: calc(var(--ui-editor-content-width) + 2 * var(--ui-editor-gutter)); box-sizing: border-box; margin-inline: auto; padding: var(--ui-space-6) var(--ui-editor-gutter); user-select: text; }
    h2 { margin: 0 0 var(--ui-space-4); font: 700 var(--ui-editor-font-title)/var(--ui-editor-heading-line-height) var(--ui-font-family); overflow-wrap: anywhere; }
    .metadata { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-space-2) var(--ui-space-3); margin-block-end: var(--ui-space-5); font-size: var(--ui-font-small); line-height: 1.4; color: var(--ui-text-secondary); }
    .badge { background: var(--ui-surface-panel); border-radius: var(--ui-radius-control); padding: var(--ui-space-1) var(--ui-space-2); }
    .feed-content { font: var(--ui-editor-font-body)/var(--ui-editor-line-height) var(--ui-font-family); overflow-wrap: anywhere; }
    .plain { white-space: pre-wrap; }
    .feed-content :global(:where([data-paragraph], div, ol, ul, dl, blockquote, pre, figure, h3, h4, h5, h6, hr, table)) { margin: 0; font: inherit; }
    .feed-content :global(:where([data-paragraph], div, ol, ul, dl, blockquote, pre, figure, hr, table) + *) { margin-block-start: var(--ui-editor-block-gap); }
    .feed-content :global(:is(h3, h4, h5, h6)) { font-weight: 700; line-height: var(--ui-editor-heading-line-height); }
    .feed-content :global(* + :is(h3, h4, h5, h6)) { margin-block-start: var(--ui-editor-heading-gap); }
    .feed-content :global(:is(h3, h4, h5, h6) + *) { margin-block-start: var(--ui-editor-block-gap); }
    .feed-content :global(h3) { font-size: var(--ui-editor-font-h1); }
    .feed-content :global(h4) { font-size: var(--ui-editor-font-h2); }
    .feed-content :global(:is(h5, h6)) { font-size: var(--ui-editor-font-h3); }
    .feed-content :global(:is(ul, ol, dd)) { padding-inline-start: var(--ui-editor-indent); }
    .feed-content :global(li + li) { margin-block-start: var(--ui-editor-block-gap); }
    .feed-content :global(ul ul) { list-style-type: circle; }
    .feed-content :global(ul ul ul) { list-style-type: square; }
    .feed-content :global(ol ol) { list-style-type: lower-alpha; }
    .feed-content :global(ol ol ol) { list-style-type: lower-roman; }
    .feed-content :global(blockquote) { border-inline-start: var(--ui-active-border) solid var(--ui-text-secondary); padding-inline-start: var(--ui-space-4); }
    .feed-content :global(pre) { font: var(--ui-editor-font-code)/var(--ui-editor-line-height) var(--ui-font-code); overflow: auto; padding: var(--ui-space-3) var(--ui-space-4); color: inherit; border-radius: var(--ui-radius-control); background: var(--ui-surface-panel); }
    .feed-content :global(code) { margin: 0; padding: calc(2em / 13) calc(4em / 13); border-radius: calc(2em / 13); background: var(--ui-hover); font-family: var(--ui-font-code); font-size: calc(13em / 15); line-height: inherit; }
    .feed-content :global(pre code) { padding: 0; font: inherit; background: transparent; }
    .feed-content :global(table) { border-collapse: collapse; width: 100%; table-layout: fixed; }
    .feed-content :global(:is(td, th)) { border: var(--ui-stroke) solid var(--ui-border-input); padding: var(--ui-space-2) var(--ui-space-3); text-align: start; vertical-align: top; }
    .feed-content :global(th) { background: var(--ui-surface-panel); }
    .feed-content :global(a[href]) { color: var(--ui-text-match); text-decoration: underline; }
    .feed-content :global(hr) { border: 0; border-top: var(--ui-stroke) solid var(--ui-divider); }
    .feed-content :global(img) { max-width: 100%; height: auto; }
</style>