import type { EditorView } from "@tiptap/pm/view";
import { Selection } from "@tiptap/pm/state";
import { adjacent } from "./block-selection";
import { blankBlock, kindOf } from "./document";
import { selectionIn } from "./transactions";

function nearest(container: HTMLElement, y: number): HTMLElement {
    const children = container.children;
    let lo = 0, hi = children.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (children[mid].getBoundingClientRect().top <= y) lo = mid + 1;
        else hi = mid;
    }
    const before = children[Math.max(0, lo - 1)] as HTMLElement;
    const after = children[lo] as HTMLElement | undefined;
    if (!before) return container;
    const row = after && y - before.getBoundingClientRect().bottom > after.getBoundingClientRect().top - y ? after : before;
    if (row.matches("section[data-block-id]:not([data-folded])") && row.children.length > 1) return nearest(row, y);
    return row;
}

export function rowAtHeight(view: EditorView, y: number): HTMLElement {
    if (y >= 0 && y < innerHeight) {
        const column = view.dom.getBoundingClientRect();
        const hit = document.elementFromPoint((column.left + column.right) / 2, y)?.closest<HTMLElement>("[data-body], [data-code-line], [data-kind=title], [data-kind=hr], [data-kind=blocked_reference], td, th");
        if (hit && view.dom.contains(hit)) return hit.closest<HTMLElement>("[data-block-id]")!;
    }
    return nearest(view.dom, y).closest<HTMLElement>("[data-block-id]") ?? view.dom.firstElementChild as HTMLElement;
}

export function handleRowAtHeight(view: EditorView, y: number): HTMLElement | null {
    if (y > view.dom.lastElementChild!.getBoundingClientRect().bottom) return null;
    const row = nearest(view.dom, y).closest<HTMLElement>("[data-block-id]");
    // A widget or the padding before the title has no editable body row.
    return !row || row.dataset.kind === "title" ? null : row;
}

export function blockPosition(view: EditorView, element: HTMLElement): number {
    const inside = view.posAtDOM(element, 0);
    if (inside > 0 && view.state.doc.nodeAt(inside - 1)?.attrs.blockId === element.dataset.blockId) return inside - 1;
    return inside;
}

export function inMargin(view: EditorView, root: HTMLElement, event: PointerEvent): boolean {
    const { dom } = view, target = event.target;
    if (event.button !== 0 || (target !== root && target !== dom.parentElement && target !== dom)) return false;
    const column = dom.getBoundingClientRect();
    // Gaps between blocks also hit the document element. They belong to native text selection.
    return event.clientX < column.left || event.clientX >= column.right
        || event.clientY < dom.firstElementChild!.getBoundingClientRect().top
        || event.clientY >= dom.lastElementChild!.getBoundingClientRect().bottom;
}

export function intersectingBlocks(view: EditorView, rect: DOMRect): [number, number] | null {
    const { doc } = view.state;
    if (doc.childCount < 2) return null;
    const column = view.dom.getBoundingClientRect();
    if (rect.right < column.left || rect.left > column.right) return null;
    const initial = doc.firstChild!.nodeSize;
    const first = view.nodeDOM(initial) as HTMLElement, last = view.dom.lastElementChild!;
    if (rect.bottom < first.getBoundingClientRect().top || rect.top > last.getBoundingClientRect().bottom) return null;
    function intersect(pos: number, direction: number): number | null {
        for (let current: number | null = Math.max(initial, pos); current !== null; current = adjacent(doc, current, direction)) {
            const el = view.nodeDOM(current) as HTMLElement;
            const row = (el.querySelector(":scope > [data-body], :scope > .code-content") ?? el).getBoundingClientRect();
            if (direction > 0 && row.top > rect.bottom || direction < 0 && row.bottom < rect.top) break;
            if (rect.left <= row.right && rect.right >= row.left && rect.top <= row.bottom && rect.bottom >= row.top) return current;
        }
        return null;
    }
    const a = intersect(blockPosition(view, rowAtHeight(view, rect.top)), 1);
    if (a === null) return null;
    const b = intersect(blockPosition(view, rowAtHeight(view, rect.bottom)), -1);
    return b === null || a > b ? null : [a, b];
}

export function clickPage(view: EditorView, x: number, y: number, writable: boolean): void {
    const { doc, schema } = view.state;
    const last = view.dom.lastElementChild!;
    const tr = view.state.tr;
    if (y >= last.getBoundingClientRect().bottom) {
        const node = doc.lastChild!, end = doc.content.size;
        if (writable && !(kindOf(node) === "paragraph" && !node.firstChild!.content.size && node.childCount === 1))
            selectionIn(tr.insert(end, blankBlock(schema)), end + 2);
        else tr.setSelection(Selection.atEnd(doc));
    }
    else {
        const row = rowAtHeight(view, y);
        const body = row.querySelector<HTMLElement>(":scope > [data-body]") ?? row;
        const rect = body.getBoundingClientRect();
        const point = view.posAtCoords({ left: Math.max(rect.left + 1, Math.min(x, rect.right - 1)), top: Math.max(rect.top + 1, Math.min(y, rect.bottom - 1)) });
        selectionIn(tr, point?.pos ?? blockPosition(view, row) + 1);
    }
    view.dispatch(tr);
    view.focus();
}