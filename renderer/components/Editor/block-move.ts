import { Fragment, type Node as DocNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { canNest, isBlock, kindOf, type Location } from "./document";
import { adjacent } from "./block-selection";
import { blockPosition, rowAtHeight } from "./page-pointer";
import { selectionIn } from "./transactions";

type Span = { from: number; to: number };
export type Drop = { pos: number; left: number; top: number; right: number };

function spans(places: Location[]): Span[] {
    const result: Span[] = [];
    for (const { pos, node } of places) {
        const last = result.at(-1);
        if (last?.to === pos) last.to += node.nodeSize;
        else result.push({ from: pos, to: pos + node.nodeSize });
    }
    return result;
}
export function moveBlocks(state: EditorState, places: Location[], pos: number): { tr: Transaction; start: number } | null {
    // Two rendered occurrences of one synced parent are one underlying child array.
    // Express every edge edit for that array against the same occurrence before mirroring it.
    const { doc } = state;
    const owners = new Map<string, number>();
    function canonical(position: number): number {
        const at = doc.resolve(position), id = at.parent.attrs.blockId as string | undefined;
        if (!id) return position;
        const owner = owners.get(id);
        if (owner === undefined) {
            owners.set(id, at.start());
            return position;
        }
        return owner + position - at.start();
    }
    const mapped = new Map<number, Location>();
    for (const place of places) {
        const at = canonical(place.pos);
        if (!mapped.has(at)) mapped.set(at, { pos: at, node: place.node });
    }
    pos = canonical(pos);
    places = [...mapped.values()];
    const ranges = spans([...places].sort((a, b) => a.pos - b.pos));
    if (!ranges.length || ranges.some(r => pos > r.from && pos < r.to) ||
        ranges.length === 1 && (ranges[0].from === pos || ranges[0].to === pos)) return null;
    const at = state.doc.resolve(pos);
    if (at.index() === 0 || (at.depth && !canNest(kindOf(at.parent)))) return null;
    const ancestors = new Set<string>();
    for (let depth = 1; depth <= at.depth; depth++) ancestors.add(at.node(depth).attrs.blockId);
    if (ancestors.size && places.some(({ node }) => {
        let cycle = ancestors.has(node.attrs.blockId);
        node.descendants(child => {
            if (!cycle && isBlock(child)) cycle = ancestors.has(child.attrs.blockId);
            return !cycle && child.type.name === "pageBlock";
        });
        return cycle;
    })) return null;
    const tr = state.tr;
    for (const range of ranges.reverse()) tr.delete(range.from, range.to);
    const start = tr.mapping.map(pos);
    tr.insert(start, Fragment.fromArray(places.map(p => p.node))).setMeta("workspace.move", true);
    return { tr: selectionIn(tr, start + 1), start };
}

export function relativeDrop(doc: DocNode, places: Location[], action: "up" | "down" | "indent" | "outdent"): number | null {
    const first = places[0], last = places[places.length - 1];
    const at = doc.resolve(first.pos), end = doc.resolve(last.pos + last.node.nodeSize);
    const previous = at.nodeBefore, next = end.nodeAfter;
    if (action === "up") return previous && isBlock(previous) && kindOf(previous) !== "title" ? first.pos - previous.nodeSize : null;
    if (action === "down") return next && isBlock(next) ? end.pos + next.nodeSize : null;
    if (action === "indent") return previous && isBlock(previous) && canNest(kindOf(previous)) ? first.pos - 1 : null;
    return at.depth ? at.after() : null;
}

function ownBottom(row: HTMLElement): number {
    const body = row.firstElementChild;
    if (!row.hasAttribute("data-folded") && body?.hasAttribute("data-body") && body.nextElementSibling?.hasAttribute("data-block-id"))
        return body.getBoundingClientRect().bottom;
    return row.getBoundingClientRect().bottom;
}

export function dropAt(view: EditorView, x: number, y: number, indent: number): Drop | null {
    const { doc } = view.state, row = rowAtHeight(view, y);
    const start = blockPosition(view, row), middle = (row.getBoundingClientRect().top + ownBottom(row)) / 2;
    const above = y < middle && start > 0 ? adjacent(doc, start, -1) ?? 0 : start;
    const upper = doc.nodeAt(above);
    if (!upper) return null;
    const upperRow = above === start ? row : view.nodeDOM(above) as HTMLElement;
    const below = adjacent(doc, above, 1);
    const widget = upperRow.nextElementSibling;
    const bottom = above === 0 && widget?.classList.contains("ProseMirror-widget") ? widget.getBoundingClientRect().bottom : ownBottom(upperRow);
    const top = below === null ? bottom : (bottom + (view.nodeDOM(below) as HTMLElement).getBoundingClientRect().top) / 2;
    const right = view.dom.getBoundingClientRect().right;
    let left = upperRow.getBoundingClientRect().left, pos = above + upper.nodeSize;
    if (kindOf(upper) === "title") return { pos, left, top, right };

    // Choose among insertion depths at this visual boundary. Ascending past a
    // parent with remaining siblings would place the block at a different gap.
    const at = doc.resolve(pos), offset = Math.round((x - left) / indent);
    const expanded = upper.type.name === "pageBlock" && upper.childCount > 1 && !upper.attrs.collapsed;
    if (expanded || offset > 0) {
        if (!canNest(kindOf(upper))) return null;
        pos = expanded ? above + 1 + upper.firstChild!.nodeSize : pos - 1;
        left += indent;
    }
    else {
        const depth = Math.max(0, at.depth + offset);
        for (let d = at.depth; d > depth && at.indexAfter(d) === at.node(d).childCount; d--) {
            pos = at.after(d);
            left = (view.nodeDOM(at.before(d)) as HTMLElement).getBoundingClientRect().left;
        }
    }
    return { pos, left, top, right };
}