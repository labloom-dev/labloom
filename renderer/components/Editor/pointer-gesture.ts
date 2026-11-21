import { isComposingKey } from "../../../shared/content/commands";

type Point = { x: number; y: number };
type Gesture = { move: (point: Point) => void; end: (dragged: boolean, cancelled: boolean, point: Point) => void };

// All geometry is read once per animation frame. Pointer capture keeps gestures inside their tab.
export function trackPointer(root: HTMLElement, down: PointerEvent, kind: "drag" | "marquee", gesture: Gesture): () => void {
    const pane = root.closest<HTMLElement>("[data-tabs-content]") ?? root;
    const id = down.pointerId, origin = { x: down.clientX, y: down.clientY };
    let point = origin, dragged = false, frame = 0, moved = false, finished = false;
    function draw(): void {
        frame = 0;
        if (!dragged) return;
        const rect = pane.getBoundingClientRect();
        const edge = Math.min(60, rect.height / 4);
        const edgeSpeed = (distance: number): number => Math.ceil(28 * Math.min(1, Math.max(0, 1 - distance / edge)) ** 2);
        const speed = edgeSpeed(rect.bottom - point.y) - edgeSpeed(point.y - rect.top);
        const previous = pane.scrollTop;
        if (speed) pane.scrollTop += speed;
        if (moved || previous !== pane.scrollTop) gesture.move(point);
        moved = false;
        if (speed && previous !== pane.scrollTop) frame = requestAnimationFrame(draw);
    }
    function move(event: PointerEvent): void {
        if (event.pointerId !== id) return;
        point = { x: event.clientX, y: event.clientY };
        if (!dragged && Math.hypot(point.x - origin.x, point.y - origin.y) >= 5) {
            dragged = true;
            root.dataset.gesture = kind;
        }
        moved = true;
        if (dragged && !frame) frame = requestAnimationFrame(draw);
    }
    function finish(cancelled: boolean): void {
        if (finished) return;
        finished = true;
        delete root.dataset.gesture;
        cancelAnimationFrame(frame);
        root.removeEventListener("pointermove", move);
        root.removeEventListener("pointerup", up);
        root.removeEventListener("lostpointercapture", cancel);
        root.removeEventListener("pointercancel", cancel);
        document.removeEventListener("keydown", key, true);
        if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
        if (!cancelled && dragged && moved) gesture.move(point);
        gesture.end(dragged, cancelled, point);
    }
    function up(event: PointerEvent): void {
        if (event.pointerId !== id) return;
        move(event); finish(false);
    }
    function cancel(): void {
        finish(true);
    }
    function key(event: KeyboardEvent): void {
        if (event.key === "Escape" && !isComposingKey(event)) {
            event.preventDefault(); event.stopPropagation(); cancel();
        }
    }
    down.preventDefault();
    root.setPointerCapture(id);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("lostpointercapture", cancel);
    root.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", key, true);
    return cancel;
}