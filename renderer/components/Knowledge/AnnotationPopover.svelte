<script lang="ts">
    import { onDestroy, tick, untrack, type Snippet } from "svelte";
    import { type Editor as TiptapEditor } from "@tiptap/core";
    import { Selection } from "@tiptap/pm/state";
    import { type HistorySource } from "../../../shared/history/ipc";
    import { failure, message, t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import IconButton from "../base/IconButton.svelte";
    import { showLayer } from "../base/top-layer";
    import Editor from "../Editor/Editor.svelte";
    import { openPage } from "../layout/navigation";
    import { AnchorLayout, controlsReaderView, keepInView } from "../Reader/anchor-layout";
    import { type ReaderAnchorGeometry } from "../Reader/defs";
    import { dirtyPages } from "../Tab/dirty.svelte";
    import Icon from "../utils/Icon.svelte";
    import { knowledgeState } from "./feedback.svelte";
    import { mountedSession, session } from "./page-sessions";

    type Point = { x: number; y: number };
    let { pageId, tabId, source, geometry, position, visible, readOnly = false, focusOnOpen,
        actions, retain, onmove, restoreFocus, onclose }: {
        source: HistorySource; pageId: string; tabId: string; visible: boolean; readOnly?: boolean; focusOnOpen: boolean;
        geometry: ReaderAnchorGeometry | null; position: Point | null; actions: Snippet<[boolean]>;
        retain: () => boolean; onmove: (position: Point) => void;
        restoreFocus: () => void; onclose: () => void;
    } = $props();
    const current = untrack(() => session(tabId, pageId, source));
    const origin = document.activeElement;
    const key = untrack(() => tabId + ":" + pageId);
    const locked = $derived(readOnly || !!current.state.page?.attributes.deleted);
    let popup = $state<HTMLElement>();
    let height = $state(0), titleHeight = $state(0);
    let contentHeight = $state(0), viewportHeight = $state(0);
    const placement = new AnchorLayout();
    let drag: { pointer: number; x: number; y: number } | null = null;
    let closing = $state(false);
    let pendingClose: Promise<boolean> | null = null;

    const layout = $derived.by(() => {
        if (!geometry) return;
        const { viewport } = geometry;
        const width = Math.min(440, viewport.width);
        const maxHeight = Math.max(titleHeight + 2, Math.min(400, viewport.height));
        return { ...placement.place(geometry, width, Math.min(height || maxHeight, maxHeight), position), width, maxHeight };
    });
    onDestroy(() => {
        dirtyPages.delete(key);
        if (!retain() && mountedSession(tabId, pageId) === current) current.release();
    });
    $effect(() => {
        if (current.state.dirty || current.state.saving) dirtyPages.set(key, tabId); else dirtyPages.delete(key);
    });
    $effect(() => {
        if (knowledgeState.change.purged?.includes(pageId)) onclose();
    });
    export function close(restore = true): Promise<boolean> {
        if (pendingClose) return pendingClose;
        closing = true;
        pendingClose = current.flush().then(saved => {
            if (!saved) {
                knowledgeState.error = current.state.error || { kind: "page-composing" };
                return false;
            }
            onclose();
            if (restore) {
                if (origin instanceof HTMLElement && origin.isConnected && origin !== document.body) origin.focus({ preventScroll: true });
                else restoreFocus();
            }
            return true;
        }).catch(error => {
            knowledgeState.error = failure(error);
            return false;
        }).finally(() => {
            closing = false;
            pendingClose = null;
        });
        return pendingClose;
    }
    async function openInTab(): Promise<void> {
        const id = pageId;
        if (await close(false)) openPage(id, { currentGroup: true });
    }
    function mountPopup(element: HTMLElement): () => void {
        const tab = element.closest<HTMLElement>("[data-tabs-content]");
        const hide = showLayer(element, () => void close());
        function dismiss(event: MouseEvent): void {
            if (event.button !== 0 || event.type === "click" && event.detail || event.composedPath().includes(element)) return;
            // Deliver annotation clicks before saving can repaint their targets.
            if (event.target instanceof Element && event.target.closest(".knowledge-highlights,.annotation-row,.paper-sash")) return;
            if (geometry && controlsReaderView(event, geometry.viewport)) return;
            void close(false);
        }
        tab?.addEventListener("pointerdown", dismiss, true);
        tab?.addEventListener("click", dismiss, true);
        if (untrack(() => focusOnOpen && layout?.visible)) element.focus({ preventScroll: true });
        return () => {
            drag = null;
            tab?.removeEventListener("pointerdown", dismiss, true);
            tab?.removeEventListener("click", dismiss, true);
            hide();
        };
    }
    function focusBody(element: HTMLElement): void {
        void tick().then(() => {
            if (!element.isConnected || locked || document.activeElement !== popup) return;
            const editor = element.querySelector<HTMLElement & { editor?: TiptapEditor }>(".editor-document")?.editor;
            if (!editor) return;
            const { view, state } = editor;
            // The tab can still be refreshing when a newly created annotation mounts.
            if (!view.editable) view.dom.focus({ preventScroll: true });
            view.dispatch(state.tr.setSelection(Selection.atEnd(state.doc)).scrollIntoView());
            view.focus();
        });
    }
    function startDrag(event: PointerEvent & { currentTarget: HTMLElement }): void {
        if (!popup || event.button !== 0 || (event.target as Element).closest("button") || drag) return;
        const rect = popup.getBoundingClientRect();
        drag = { pointer: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function moveDrag(event: PointerEvent): void {
        if (drag?.pointer !== event.pointerId || !geometry || !popup) return;
        const { target, viewport } = geometry;
        const origin = keepInView({ x: event.clientX - drag.x, y: event.clientY - drag.y }, popup.offsetWidth, popup.offsetHeight, viewport);
        onmove({ x: origin.x - target.left, y: origin.y - target.bottom });
    }
    function endDrag(event: PointerEvent): void {
        if (drag?.pointer === event.pointerId) drag = null;
    }
</script>

{#if visible && layout}
    <section class="annotation-popover ui-popup ui-popover" role="dialog" tabindex="-1" bind:this={popup} bind:offsetHeight={height}
        aria-label={t("reader.annotations")}
        style:left={layout.x + "px"} style:top={layout.y + "px"}
        style:width={layout.width + "px"} style:max-height={layout.maxHeight + "px"}
        style:clip-path={layout.clip} style:visibility={layout.visible ? "visible" : "hidden"}
        inert={!layout.visible} popover="manual" {@attach mountPopup}>
        <div class="annotation-editor" data-history-page={pageId}>
            <header bind:offsetHeight={titleHeight} onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={endDrag}
                onlostpointercapture={endDrag} onpointercancel={endDrag}>
                <strong>{t("reader.annotations")}{#if current.state.dirty || current.state.saving}
                    <span aria-label={t("shell.unsaved")}><Icon name="circle-small-filled" size="1em" /></span>{/if}
                </strong>
                {@render actions(locked)}
                <Button class="open-in-tab" variant="text" onclick={() => void openInTab()} disabled={closing}>{t("reader.openAnnotation")}</Button>
                <IconButton icon="close" label={t("dialog.close")} onclick={() => void close()} disabled={closing} />
            </header>
            <div class="annotation-content" class:scrolling={contentHeight > viewportHeight} bind:clientHeight={viewportHeight}>
                <div class="annotation-body" bind:offsetHeight={contentHeight}>
                    {#if current.state.error}<div data-paragraph role="alert">{message(current.state.error)}</div>{/if}
                    {#if current.state.page && !current.state.loading}
                        <div class="body-only" {@attach focusBody}><Editor session={current} {tabId} readOnly={locked} /></div>
                    {:else}<div data-paragraph>{t("reader.loading")}</div>{/if}
                </div>
            </div>
        </div>
    </section>
{/if}

<style>
    .ui-popover.annotation-popover {
        position: fixed; inset: auto; margin: 0; padding: 0; max-width: none; overflow: hidden; display: flex;
    }
    .annotation-editor { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
    .annotation-content { min-height: 0; overflow: auto; }
    .annotation-content.scrolling { scrollbar-gutter: stable both-edges; }
    .annotation-body { display: flow-root; }
    header {
        display: flex; flex: none; align-items: center; gap: var(--ui-space-2); padding: var(--ui-space-2) var(--ui-space-3);
        border-bottom: var(--ui-stroke) solid var(--ui-divider); cursor: move; user-select: none; touch-action: none;
    }
    header strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
    header :global(.open-in-tab) { min-width: 0; overflow: hidden; }
    header :global(.ui-icon-button) { flex: none; }
    .body-only :global(.editor), .body-only :global(.tiptap) { min-height: var(--annotation-min-height); }
    .body-only :global(.editor-canvas) {
        --ui-editor-gutter: calc(2 * var(--ui-button-height) + var(--handle-gap) + var(--ui-focus-width) + var(--ui-focus-offset));
    }
    .body-only :global(.tiptap > [data-kind="title"]) { display: none; }
    .body-only :global(.tiptap) { padding-block: var(--ui-space-4) var(--ui-space-5); }
    :where([data-paragraph]) { margin: var(--ui-space-3); color: var(--ui-text-secondary); }
    :where([data-paragraph])[role="alert"] { color: var(--ui-danger); }
</style>