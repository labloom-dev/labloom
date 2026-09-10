<div
    style:width={direction === "horizontal" ? "100%" : "5px"}
    style:height={direction === "vertical" ? "100%" : "5px"}
    style:cursor={direction === "horizontal" ? "ns-resize" : "ew-resize"}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
>

</div>


<style>
    div {
        /* todo: unify border color, should use var(--border-color) */
        background-color: aqua;
    }
</style>


<script lang="ts">
    type Props = {
        direction: "horizontal" | "vertical";
        changeCB: (value: number) => void;
        origin: number;
        min?: number;
        max?: number;
    };

    const { direction, changeCB: cb, origin, min, max }: Props = $props();

    let dragStart = 0;
    let dragOrigin = 0;

    function getPos(event: PointerEvent): number {
        return direction === "horizontal" ? event.clientY : event.clientX;
    }
    function onpointerdown(event: PointerEvent): void {
        if (event.button !== 0) return;
        const handle = event.currentTarget as HTMLDivElement | null;
        if (!handle) return;
        handle.setPointerCapture(event.pointerId);
        dragStart = getPos(event);
        dragOrigin = origin;
    }
    function onpointermove(event: PointerEvent): void {
        const handle = event.currentTarget as HTMLDivElement | null;
        if (!handle) return;
        if (!handle.hasPointerCapture(event.pointerId)) return;
        const value = dragOrigin + getPos(event) - dragStart;
        cb(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value)));
    }
    function onpointerup(event: PointerEvent): void {
        const handle = event.currentTarget as HTMLDivElement | null;
        if (!handle) return;
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    }
</script>