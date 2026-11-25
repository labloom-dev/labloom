<script lang="ts">
    import { untrack } from "svelte";
    import { attachmentURL, type MediaFile } from "../../../shared/content/media";
    import type { BlockMedia, MediaKind } from "../../../shared/types/content";
    import { currentLanguage, t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import Icon, { type IconName } from "../utils/Icon.svelte";

    let { kind, media, file, visible, writable, resize, open, save }: {
        kind: MediaKind; media: BlockMedia; file?: MediaFile; visible: boolean; writable: () => boolean;
        resize: (width?: number) => void; open: (anchor: HTMLElement) => void; save: () => void;
    } = $props();

    let frame: HTMLDivElement;
    let preview = $state<number>(), failed = $state(false), resizing = $state(false);
    let drag: { pointer: number; x: number; width: number; available: number; direction: -1 | 1; minimum: number } | undefined;
    const name = $derived(file?.originalName ?? (media.fileId === null ? media.name : ""));
    const ratio = $derived(media.aspectRatio);
    const missingFile = $derived(!file || failed);
    const width = $derived(preview ?? media.width);
    const length = $derived(width !== undefined ? `${width * 100}%` : kind === "image" ? `min(100%, ${media.naturalWidth}px)` : "100%");
    const src = $derived(visible && file && !failed ? attachmentURL(file.id) : undefined);
    const canResize = $derived(!!file && !failed && ratio !== undefined && writable());
    const icon = $derived(fileIcon(file?.mediaType));
    const size = $derived(file && formatSize(file.size));

    $effect(() => {
        if (kind !== "file" || !visible || !file) return;
        let current = true;
        void window.api.attachments.available(file.id).then(available => {
            if (current) failed = !available;
        }).catch(() => {
            if (current) failed = true;
        });
        return () => {
            current = false;
        };
    });

    function fileIcon(mime?: string): IconName {
        if (mime?.startsWith("image/")) return "file-media";
        if (mime?.startsWith("audio/")) return "music";
        if (mime?.startsWith("video/")) return "play-circle";
        if (mime?.startsWith("text/")) return "file-text";
        if (mime === "application/pdf") return "file-pdf";
        if (mime && /zip|rar|tar|compressed/u.test(mime)) return "file-zip";
        return "file";
    }
    function formatSize(bytes: number): string {
        const units = ["B", "KB", "MB", "GB", "TB", "PB"];
        const unit = bytes ? Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1000))) : 0;
        return new Intl.NumberFormat(currentLanguage(), { maximumFractionDigits: 1 }).format(bytes / 1000 ** unit) + " " + units[unit];
    }

    function start(event: PointerEvent, direction: -1 | 1): void {
        if (!canResize || event.button !== 0 || drag) return;
        const button = event.currentTarget as HTMLButtonElement;
        event.preventDefault();
        const available = frame.parentElement!.clientWidth;
        if (!available) return;
        button.setPointerCapture(event.pointerId);
        drag = { pointer: event.pointerId, x: event.clientX, width: frame.getBoundingClientRect().width, available,
            direction, minimum: Math.min(1, 2 * button.offsetWidth / available) };
        resizing = true;
    }
    function move(event: PointerEvent): void {
        if (!drag || event.pointerId !== drag.pointer || event.clientX === drag.x && preview === undefined) return;
        const fraction = (drag.width + 2 * drag.direction * (event.clientX - drag.x)) / drag.available;
        preview = Math.min(1, Math.max(drag.minimum, fraction));
    }
    function finish(event: PointerEvent, commit: boolean): void {
        if (!drag || event.pointerId !== drag.pointer) return;
        if (commit && canResize && preview !== undefined) resize(preview);
        drag = undefined;
        preview = undefined;
        resizing = false;
    }
    function reset(): void {
        if (canResize) resize();
    }
    $effect(() => {
        if (!canResize && untrack(() => preview) !== undefined) preview = undefined;
    });
</script>

<div class="media-frame" bind:this={frame} style:width={missingFile ? "100%" : length}
    style:aspect-ratio={missingFile ? undefined : ratio} data-resizing={resizing ? "" : undefined}
    class:visual={!missingFile && ratio !== undefined} class:audio={!missingFile && kind === "video" && ratio === undefined}>
    {#if missingFile}
        <div class="missing" title={name}><Icon name={icon} /><span class="name">{name}</span><span>{t("editor.missingFile")}</span></div>
    {:else if kind === "file"}
        <Button class="media-file" {icon} variant="text" title={name} onclick={save}><span class="name">{name}</span><span class="size">{size}</span></Button>
    {:else if kind === "image"}
        <button class="media-image" type="button" onclick={event => open(event.currentTarget)} disabled={!src}>
            {#if src}<img {src} alt={name} draggable="false" decoding="async" onerror={() => failed = true} />{/if}
        </button>
    {:else if ratio === undefined}
        {#if src}<audio {src} controls preload="metadata" aria-label={name} onerror={() => failed = true}></audio>{/if}
    {:else if src}
        <!-- svelte-ignore a11y_media_has_caption (The editable block caption is separate from any tracks in the imported file.) -->
        <video {src} controls preload="metadata" aria-label={name} onerror={() => failed = true}></video>
    {/if}
    {#if canResize}
        {#each ([-1, 1] as const) as direction (direction)}
            <button class="resize" class:left={direction < 0} type="button" tabindex="-1" aria-label={t("editor.resizeMedia")}
                onpointerdown={event => start(event, direction)} onpointermove={move}
                onpointerup={event => finish(event, true)} onpointercancel={event => finish(event, false)}
                onlostpointercapture={event => finish(event, false)} ondblclick={reset}></button>
        {/each}
    {/if}
</div>

<style>
    .media-frame { position: relative; margin-inline: auto; white-space: normal; }
    .visual { border-radius: var(--ui-radius-control); background: var(--ui-surface-panel); }
    .media-image, img, video { display: block; width: 100%; height: 100%; border-radius: inherit; }
    .media-image { position: absolute; inset: 0; padding: 0; border: 0; background: var(--ui-surface-clear); cursor: zoom-in; }
    .media-image:focus-visible { outline: var(--ui-focus-width) solid var(--ui-focus); outline-offset: var(--ui-focus-offset); }
    img, video { object-fit: contain; }
    .audio { height: calc(2 * var(--ui-row-height)); }
    audio { display: block; width: 100%; height: 100%; }
    video { position: absolute; inset: 0; }
    .missing, :global(.ui-control.media-file) { display: flex; gap: var(--ui-space-2); min-height: var(--ui-row-height); align-items: center; }
    .missing { color: var(--ui-text-secondary); font-size: var(--ui-font-small); white-space: nowrap; }
    :global(.ui-control.media-file) { width: 100%; padding-inline: 0; justify-content: flex-start; text-align: start; }
    .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .size { flex: none; margin-inline-start: auto; color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
    .resize {
        position: absolute; inset: 50% var(--ui-space-1) auto auto; transform: translateY(-50%);
        display: grid; place-items: center; opacity: 0; width: var(--ui-icon-normal); height: calc(3 * var(--ui-icon-normal));
        max-height: 100%; padding: 0; border: 0; background: var(--ui-surface-clear); cursor: ew-resize; touch-action: none;
    }
    .resize.left { inset-inline: var(--ui-space-1) auto; }
    .resize::before { content: ""; width: var(--ui-space-1); height: 100%; border-radius: var(--ui-radius-control); background: var(--ui-text-secondary); }
    .media-frame:hover .resize, .media-frame[data-resizing] .resize { opacity: 1; }
    .resize:hover::before, .media-frame[data-resizing] .resize::before { background: var(--ui-accent); }
</style>