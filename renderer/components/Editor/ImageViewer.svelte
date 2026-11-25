<script module lang="ts">
    import type { BlockMedia } from "../../../shared/types/content";
    export type ViewImage = { media: BlockMedia; name: string; caption: string };
</script>

<script lang="ts">
    import { onMount } from "svelte";
    import { imageViewerShortcuts, isComposingKey } from "../../../shared/content/commands";
    import { attachmentURL } from "../../../shared/content/media";
    import { t } from "../../i18n.svelte";
    import IconButton from "../base/IconButton.svelte";
    import { showModal } from "../base/top-layer";

    let { images, start, onclose }: { images: ViewImage[]; start: number; onclose: () => void } = $props();
    let dialog: HTMLDialogElement, stage: HTMLDivElement, position = $state<number>(), viewWidth = $state(0), viewHeight = $state(0);
    let magnification = $state<number>(), x = $state(0), y = $state(0), failed = $state(false), panning = $state(false);
    let pointer: { id: number; x: number; y: number; offsetX: number; offsetY: number } | undefined;
    const index = $derived(position ?? start);
    const { media, name, caption } = $derived(images[index]);
    const width = $derived(media.naturalWidth ?? 1);
    const height = $derived(width / (media.aspectRatio ?? 1));
    const fit = $derived(viewWidth && viewHeight ? Math.min(1, viewWidth / width, viewHeight / height) : 1);
    const scale = $derived(magnification ?? fit);

    function navigate(step: -1 | 1): void {
        const next = index + step;
        if (next < 0 || next >= images.length) return;
        position = next;
        failed = false;
        reset();
    }
    function reset(): void {
        magnification = undefined;
        x = 0;
        y = 0;
    }
    function key(event: KeyboardEvent): void {
        if (isComposingKey(event) || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === imageViewerShortcuts.previous) navigate(-1);
        else if (event.key === imageViewerShortcuts.next) navigate(1);
        else if (event.key === imageViewerShortcuts.close) dialog.close();
        else return;
        event.preventDefault();
        event.stopPropagation();
    }
    function toggleSize(): void {
        if (scale === 1) reset();
        else {
            magnification = 1;
            x = y = 0;
        }
    }
    function wheel(event: WheelEvent): void {
        if (failed || !media.fileId) return;
        event.preventDefault();
        const rect = stage.getBoundingClientRect(), original = scale;
        const factor = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 24 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? rect.height : 1;
        const next = Math.max(fit / 4, Math.min(Math.max(fit, 1) * 16, original * Math.exp(-event.deltaY * factor / 480)));
        const mx = event.clientX - rect.left - rect.width / 2, my = event.clientY - rect.top - rect.height / 2;
        magnification = next;
        x = mx - (mx - x) * next / original;
        y = my - (my - y) * next / original;
    }
    function dragStart(event: PointerEvent): void {
        if (event.button !== 0 || scale <= fit || !(event.target instanceof HTMLImageElement)) return;
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, offsetX: x, offsetY: y };
        panning = true;
        event.target.setPointerCapture(event.pointerId);
    }
    function dragMove(event: PointerEvent): void {
        if (!pointer || event.pointerId !== pointer.id) return;
        x = pointer.offsetX + event.clientX - pointer.x;
        y = pointer.offsetY + event.clientY - pointer.y;
    }
    function dragEnd(event: PointerEvent): void {
        if (event.pointerId !== pointer?.id) return;
        pointer = undefined;
        panning = false;
    }
    onMount(() => {
        stage.focus({ preventScroll: true });
        stage.addEventListener("wheel", wheel, { passive: false });
        return () => stage.removeEventListener("wheel", wheel);
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events (Escape and the close button also close the viewer.) -->
<dialog bind:this={dialog} class="image-viewer" aria-label={t("editor.imageViewer")} {onclose} {@attach showModal}
    onkeydown={key} onclick={event => {
        if (event.target === stage || event.target === dialog) dialog.close();
    }}>
    <header>
        <IconButton icon="chevron-left" label={t("editor.previousImage")} shortcut={imageViewerShortcuts.previous}
            disabled={index === 0} onclick={() => navigate(-1)} />
        <span aria-live="polite">{t("editor.imageCount", { current: index + 1, total: images.length })}</span>
        <IconButton icon="chevron-right" label={t("editor.nextImage")} shortcut={imageViewerShortcuts.next}
            disabled={index + 1 === images.length} onclick={() => navigate(1)} />
        <IconButton class="image-viewer-close" icon="close" label={t("dialog.close")} shortcut={imageViewerShortcuts.close} onclick={() => dialog.close()} />
    </header>
    <div class="viewer-stage" tabindex="-1" bind:this={stage} bind:clientWidth={viewWidth} bind:clientHeight={viewHeight} class:panning class:zoomed={scale > fit}
        role="presentation" onpointerdown={dragStart} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd} onlostpointercapture={dragEnd}>
        {#if media.fileId && !failed}
            {#key index}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Double-click toggles between fitted and actual size.) -->
                <img src={attachmentURL(media.fileId)} alt={name} draggable="false" style:width={width * scale + "px"} style:height={height * scale + "px"}
                    style:translate={`calc(-50% + ${x}px) calc(-50% + ${y}px)`} ondblclick={toggleSize} onerror={() => failed = true} />
            {/key}
        {:else}
            <div class="viewer-missing"><span>{name}</span><span>{t("editor.missingFile")}</span></div>
        {/if}
    </div>
    {#if caption}<footer>{caption}</footer>{/if}
</dialog>

<style>
    .image-viewer {
        inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: var(--ui-titlebar-height) 0 0;
        background: var(--ui-surface-clear); border: 0; overflow: hidden;
        font: var(--ui-font-body)/var(--ui-editor-line-height) var(--ui-font-family);
    }
    .image-viewer[open] { display: flex; flex-direction: column; }
    .image-viewer::backdrop { background: var(--ui-surface-scrim); }
    header, footer, .viewer-missing {
        color: var(--ui-text); background: var(--ui-surface-popup); padding: var(--ui-space-1) var(--ui-space-3);
        border-radius: var(--ui-radius-panel); box-shadow: var(--ui-shadow-popup);
    }
    header { display: flex; align-items: center; justify-content: center; flex: none; align-self: center; margin: var(--ui-space-2); gap: var(--ui-space-2); }
    header span { white-space: nowrap; font-variant-numeric: tabular-nums; }
    :global(.image-viewer-close) { position: absolute; top: calc(var(--ui-titlebar-height) + var(--ui-space-2)); right: var(--ui-space-2); background: var(--ui-surface-popup); }
    footer { align-self: center; max-width: var(--ui-editor-content-width); max-height: 25%; overflow: auto; margin: var(--ui-space-2); overflow-wrap: anywhere; white-space: pre-wrap; }
    .viewer-stage { flex: 1; min-height: 0; position: relative; overflow: hidden; touch-action: none; outline: none; }
    img, .viewer-missing { position: absolute; left: 50%; top: 50%; }
    img { object-fit: contain; cursor: zoom-in; }
    .zoomed img { cursor: grab; }
    .panning img { cursor: grabbing; }
    .viewer-missing { translate: -50% -50%; display: grid; text-align: center; }
</style>