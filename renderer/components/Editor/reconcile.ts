import { Fragment, type Node as DocNode } from "@tiptap/pm/model";
import { Mapping, type Step } from "@tiptap/pm/transform";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { type PageRecord } from "../../../shared/types/content";
import { blockJSON, childIds, indexDoc, pageDocument, subtree } from "./document";
import { located, remoteEdit } from "./transactions";

export function replay(state: EditorState, steps: Step[], through: Mapping): Transaction {
    const tr = state.tr;
    let mapping = through;
    for (const step of steps) {
        const mapped = step.map(mapping);
        const next = new Mapping([step.getMap().invert()]);
        next.appendMapping(mapping);
        if (mapped && !tr.maybeStep(mapped).failed) next.appendMap(mapped.getMap(), 0);
        mapping = next;
    }
    return tr;
}
export function inverse(trs: Transaction[]): Step[] {
    return trs.flatMap(tr => tr.steps.map((step, i) => step.invert(tr.docs[i]))).reverse();
}
export function patchDocument(state: EditorState, page: PageRecord, ids: string[], whole: boolean): Transaction | null {
    const { doc, schema, selection } = state;
    const previous = indexDoc(doc), changed = new Set(ids), cache = new Map<string, DocNode>();
    const at = located(state, selection.head);
    const occurrence = at ? previous.get(at.node.attrs.blockId)!.findIndex(p => p.pos === at.pos) : -1;
    const offset = at ? selection.head - at.pos : 0;
    function read(id: string): DocNode {
        const saved = cache.get(id);
        if (saved) return saved;
        const old = previous.get(id)?.[0].node, b = page.blocks[id];
        let node: DocNode;
        if (!old) node = schema.nodeFromJSON(subtree(id, page.blocks));
        else {
            const values = (changed.has(id) ? b.children : childIds(old)).map(read);
            const base = changed.has(id) ? schema.nodeFromJSON(blockJSON(b)) : old;
            if (base.type.name === "pageBlock") {
                const content = Fragment.fromArray([base.firstChild!, ...values]);
                node = base.content.eq(content) ? base : base.copy(content);
            }
            else node = base;
        }
        cache.set(id, node);
        return node;
    }
    const next = whole ? schema.nodeFromJSON(pageDocument(page)) : doc.copy(Fragment.fromArray([read(page.titleBlockId), ...(changed.has(page.id) ? page.children : childIds(doc)).map(read)]));
    const start = doc.content.findDiffStart(next.content);
    if (start == null) return null;
    const ends = doc.content.findDiffEnd(next.content)!;
    const overlap = Math.max(0, start - Math.min(ends.a, ends.b));
    const tr = state.tr.replace(start, ends.a + overlap, next.slice(start, ends.b + overlap)).setMeta(remoteEdit, true);
    if (at && selection.empty) {
        const positions = indexDoc(tr.doc).get(at.node.attrs.blockId);
        const place = positions?.[occurrence] ?? positions?.[0];
        if (place) {
            const line = place.node.type.name === "pageTitle" ? place.node : place.node.firstChild;
            const oldLine = at.node.type.name === "pageTitle" ? at.node : at.node.firstChild;
            const atEnd = selection.$head.parent === oldLine && selection.$head.parentOffset === oldLine.content.size;
            const newOffset = atEnd && line?.inlineContent ? line.content.size + (line === place.node ? 1 : 2) : offset;
            tr.setSelection(TextSelection.near(tr.doc.resolve(place.pos + Math.min(newOffset, place.node.nodeSize - 1))));
        }
    }
    return tr;
}