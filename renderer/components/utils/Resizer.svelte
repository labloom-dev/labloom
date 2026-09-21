<div
    style:width={direction === "horizontal" ? "100%" : thickness ? `${thickness}px` : "5px"}
    style:height={direction === "vertical" ? "100%" : thickness ? `${thickness}px` : "5px"}
    style:cursor={direction === "horizontal" ? "ns-resize" : "ew-resize"}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={onpointerup}
>

</div>


<style>
    div {
        background-color: var(--color-resizer-background);
    }
</style>


<script lang="ts">
    import type { XYDirection } from "../types";

    type Props = {
        direction: XYDirection;
        thickness?: number;
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
        direction, thickness, changeCB, origin, min, max,
        overflowMargin = 0, onMinExceeded, onMaxExceeded
    }: Props = $props();

    let dragStart = 0;
    let dragOrigin = 0;
    let dragMin = -Infinity;
    let dragMax = Infinity;
    let dragMargin = 0;

    function getPos(event: PointerEvent): number {
        return direction === "horizontal" ? event.clientY : event.clientX;
    }
    function onpointerdown(event: PointerEvent): void {
        if (event.button !== 0) return;
        const handle = event.currentTarget as HTMLDivElement | null;
        if (!handle) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
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