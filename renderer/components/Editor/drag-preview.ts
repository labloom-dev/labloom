import { showLayer } from "../base/top-layer";

type Point = { x: number; y: number };

export function dragPreview(rows: HTMLElement[], grabbed: HTMLElement, grip: Point): { move: (point: Point) => void; close: () => void } {
    const ghost = document.createElement("div");
    ghost.className = "editor-document editor-drag-ghost";
    ghost.popover = "manual";
    ghost.inert = true;
    ghost.setAttribute("aria-hidden", "true");
    document.body.append(ghost);
    const hide = showLayer(ghost);

    const first = rows[0].getBoundingClientRect(), last = rows[rows.length - 1].getBoundingClientRect();
    const origin = grabbed.getBoundingClientRect(), pointer = { x: origin.left + grip.x, y: origin.top + grip.y };
    const height = Math.min(last.bottom - first.top, parseFloat(getComputedStyle(ghost).maxHeight));
    const top = pointer.y > first.top + height ? Math.min(last.bottom - height, pointer.y - height / 2) : first.top;
    const bottom = top + height;
    // Only copy roots within the clipped preview, even when the whole page is selected.
    let lo = 0, hi = rows.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (rows[mid].getBoundingClientRect().bottom <= top) lo = mid + 1; else hi = mid;
    }
    const visible: { row: HTMLElement; rect: DOMRect }[] = [];
    for (let i = lo; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (rect.top >= bottom) break;
        visible.push({ row: rows[i], rect });
    }
    const left = visible.reduce((x, item) => Math.min(x, item.rect.left), origin.left);
    const right = visible.reduce((x, item) => Math.max(x, item.rect.right), origin.right);
    ghost.style.width = right - left + "px";
    ghost.style.height = height + "px";
    ghost.toggleAttribute("data-clipped", last.bottom - first.top > height);
    for (const { row, rect } of visible) {
        const copy = row.cloneNode(true) as HTMLElement;
        copy.removeAttribute("id");
        for (const child of copy.querySelectorAll("[id]")) child.removeAttribute("id");
        copy.classList.remove("moving-block", "range-single", "ProseMirror-selectednode");
        Object.assign(copy.style, { position: "absolute", margin: "0", left: rect.left - left + "px", top: rect.top - top + "px", width: rect.width + "px" });
        ghost.append(copy);
    }
    return {
        move(point) {
            ghost.style.transform = `translate3d(${left + point.x - pointer.x}px, ${top + point.y - pointer.y}px, 0)`;
        },
        close: () => {
            hide();
            ghost.remove();
        }
    };
}