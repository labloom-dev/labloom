import { Fragment, Slice, type Node as DocNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, Selection, SelectionRange, type SelectionBookmark } from "@tiptap/pm/state";
import type { Mappable } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { isBlock, type Location } from "./document";

function selectable(doc: DocNode, pos: number): boolean {
    const node = doc.nodeAt(pos);
    return !!node && isBlock(node) && node.type.name !== "pageTitle";
}
function bookmark(anchor: number, head: number): SelectionBookmark {
    return {
        map: mapping => bookmark(mapping.map(anchor, 1), mapping.map(head, 1)),
        resolve: doc => selectable(doc, anchor) && selectable(doc, head) ? new BlockSelection(doc, anchor, head) : Selection.near(doc.resolve(Math.min(anchor, doc.content.size)))
    };
}
export class BlockSelection extends Selection {
    constructor(doc: DocNode, readonly first: number, readonly last: number) {
        const lo = Math.min(first, last), hi = Math.max(first, last);
        const start = doc.resolve(lo), end = doc.resolve(hi + doc.nodeAt(hi)!.nodeSize);
        const ranges: SelectionRange[] = [];
        if (start.sameParent(end)) ranges.push(new SelectionRange(start, end));
        else {
            // Select roots in document order. A selected parent's descendants are already included.
            let from = lo, to = lo;
            doc.nodesBetween(lo, hi + 1, (node, pos) => {
                if (!isBlock(node)) return false;
                if (pos < lo) return true;
                if (pos !== to) {
                    if (to > from) ranges.push(new SelectionRange(doc.resolve(from), doc.resolve(to)));
                    from = pos;
                }
                to = pos + node.nodeSize;
                return false;
            });
            if (to > from) ranges.push(new SelectionRange(doc.resolve(from), doc.resolve(to)));
        }
        super(doc.resolve(first), doc.resolve(last), ranges);
    }
    override visible = false;
    eq(other: Selection): boolean {
        return other instanceof BlockSelection && other.first === this.first && other.last === this.last;
    }
    map(doc: DocNode, mapping: Mappable): Selection {
        return this.getBookmark().map(mapping).resolve(doc);
    }
    getBookmark(): SelectionBookmark {
        return bookmark(this.first, this.last);
    }
    toJSON(): { type: string; anchor: number; head: number } {
        return { type: "workspaceBlocks", anchor: this.first, head: this.last };
    }
    static fromJSON(doc: DocNode, json: { anchor: number; head: number }): BlockSelection {
        return new BlockSelection(doc, json.anchor, json.head);
    }
    content(): Slice {
        return new Slice(Fragment.fromArray(this.places().map(p => p.node)), 0, 0);
    }
    places(): Location[] {
        const result: Location[] = [];
        for (const { $from, $to } of this.ranges) {
            let pos = $from.pos;
            for (let i = $from.index(); pos < $to.pos; i++) {
                const node = $from.parent.child(i);
                result.push({ pos, node }); pos += node.nodeSize;
            }
        }
        return result;
    }
}
Selection.jsonID("workspaceBlocks", BlockSelection);

export function adjacent(doc: DocNode, pos: number, direction: number, descend = true): number | null {
    const node = doc.nodeAt(pos)!;
    if (direction > 0 && descend && node.type.name === "pageBlock" && node.childCount > 1 && !node.attrs.collapsed)
        return pos + 1 + node.firstChild!.nodeSize;
    const at = doc.resolve(pos);
    if (direction < 0) {
        const previous = at.nodeBefore;
        if (!previous || !isBlock(previous) || previous.type.name === "pageTitle") return at.depth ? at.before() : null;
        let end = pos, candidate = previous;
        while (descend && !candidate.attrs.collapsed && candidate.type.name === "pageBlock" && candidate.childCount > 1) {
            end--; candidate = candidate.lastChild!;
        }
        return end - candidate.nodeSize;
    }
    for (let depth = at.depth; depth >= 0; depth--) {
        const index = at.index(depth) + 1;
        if (index < at.node(depth).childCount) return depth === at.depth ? pos + node.nodeSize : at.after(depth + 1);
    }
    return null;
}
export const bandThreshold = 64;
export const movingBlocks = new PluginKey<DecorationSet>("movingBlocks");
export function selectionDecorations(): Plugin {
    return new Plugin({ key: movingBlocks, state: {
        init: () => DecorationSet.empty,
        apply(tr, previous) {
            const places = tr.getMeta(movingBlocks) as Location[] | undefined;
            if (places) return DecorationSet.create(tr.doc, places.map(({ pos, node }) =>
                Decoration.node(pos, pos + node.nodeSize, { class: "moving-block" })));
            return tr.docChanged ? DecorationSet.empty : previous;
        }
    }, props: { decorations(state) {
        const moving = movingBlocks.getState(state)!;
        const selection = state.selection;
        if (!(selection instanceof BlockSelection)) return moving;
        const decorations: Decoration[] = [];
        for (const { $from, $to } of selection.ranges) {
            if ($to.index() - $from.index() > bandThreshold) continue;
            let pos = $from.pos;
            for (let i = $from.index(); pos < $to.pos; i++) {
                const end = pos + $from.parent.child(i).nodeSize;
                decorations.push(Decoration.node(pos, end, { class: "range-single" }));
                pos = end;
            }
        }
        return moving.add(state.doc, decorations);
    } } });
}
export function wholeSelection(selection: Selection): BlockSelection | null {
    if (selection instanceof BlockSelection) return selection;
    if (selection instanceof NodeSelection && isBlock(selection.node) && selection.node.type.name !== "pageTitle")
        return new BlockSelection(selection.$from.doc, selection.from, selection.from);
    return null;
}