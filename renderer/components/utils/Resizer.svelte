<div
    class="sash" class:vertical={direction === "vertical"} class:dragging
    role="separator" aria-label={label} aria-orientation={direction} aria-valuenow={Math.round(origin)}
    aria-valuemin={min} aria-valuemax={max} tabindex="0"
    {onkeydown} {onpointerdown} {onpointermove} {onpointerup}
    onlostpointercapture={() => dragging = false} onpointercancel={onpointerup}
></div>

<style>
    .sash { position: relative; flex: none; touch-action: none; outline: none; background: var(--ui-surface-panel); }
    .sash.vertical { width: var(--ui-sash-size); cursor: ew-resize; }
    .sash:not(.vertical) { height: var(--ui-sash-size); cursor: ns-resize; }
    .sash::before, .sash::after { content: ""; position: absolute; inset: 0; pointer-events: none; }
    .sash::before { background: var(--ui-divider); }
    .sash.vertical::before { width: var(--ui-stroke); margin-inline: auto; }
    .sash:not(.vertical)::before { height: var(--ui-stroke); margin-block: auto; }
    .sash::after { background: var(--ui-accent); opacity: 0; }
    .sash:hover::after { opacity: 1; transition: opacity 0s var(--ui-sash-delay); }
    .sash:is(.dragging, :focus-visible)::after { opacity: 1; transition: none; }
</style>

<script lang="ts">
    import { isComposingKey } from "../../../shared/content/commands";
    import type { XYDirection } from "../types";

    type Props = {
        direction: XYDirection;
        label: string;
        changeCB: (value: number) => void;
        origin: number;
        min?: number;
        max?: number;
        /** Extra pointer travel in pixels beyond min/max before a callback fires. */
        overflowMargin?: number;
        /** Ends the drag before notifying the caller. Receives the unclamped size. */
        onMinExceeded?: (value: number) => void;
        onMaxExceeded?: (value: number) => void;
    };

    const {
        direction, label, changeCB, origin, min, max,
        overflowMargin = 0, onMinExceeded, onMaxExceeded
    }: Props = $props();

    let dragging = $state(false);
    let dragStart = 0;
    let dragOrigin = 0;
    let dragMin = -Infinity;
    let dragMax = Infinity;
    let dragMargin = 0;

    function getPos(event: PointerEvent): number {
        return direction === "horizontal" ? event.clientY : event.clientX;
    }
    function onkeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || isComposingKey(event) || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        const decreaseKey = direction === "vertical" ? "ArrowLeft" : "ArrowUp";
        const increaseKey = direction === "vertical" ? "ArrowRight" : "ArrowDown";
        if (event.key !== decreaseKey && event.key !== increaseKey) return;
        event.preventDefault();
        event.stopPropagation();
        const value = origin + (event.key === decreaseKey ? -1 : 1);
        changeCB(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value)));
    }
    function onpointerdown(event: PointerEvent): void {
        if (event.button !== 0) return;
        const handle = event.currentTarget as HTMLDivElement | null;
        if (!handle) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        dragging = true;
        dragStart = getPos(event);
        dragOrigin = origin;
        dragMin = min ?? -Infinity;
        dragMax = max ?? Infinity;
        dragMargin = Number.isFinite(overflowMargin) ? Math.max(0, overflowMargin) : 0;
    }
    function onpointermove(event: PointerEvent): void {
        const handle = event.currentTarget as HTMLDivElement | null;
        if (!handle) return;
        if (!handle.hasPointerCapture(event.pointerId)) return;
        const value = dragOrigin + getPos(event) - dragStart;
        const onExceeded = Number.isFinite(dragMin) && value <= dragMin - dragMargin
            ? onMinExceeded
            : Number.isFinite(dragMax) && value >= dragMax + dragMargin ? onMaxExceeded : undefined;
        if (onExceeded) handle.releasePointerCapture(event.pointerId);
        changeCB(Math.min(dragMax, Math.max(dragMin, value)));
        onExceeded?.(value);
    }
    function onpointerup(event: PointerEvent): void {
        const handle = event.currentTarget as HTMLDivElement | null;
        if (!handle) return;
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    }
</script>