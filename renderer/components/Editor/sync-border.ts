import { Plugin, PluginKey } from "@tiptap/pm/state";
import { type Node } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { childIds, indexDoc } from "./document";
export const borders = new PluginKey<DecorationSet>("syncBorders");
export function borderPlugin(server: () => Record<string, number>): Plugin {
    let baseline: Map<string, number>;
    function uses(doc: Node): Map<string, number> {
        const counts = new Map<string, number>();
        const add = (ids: string[]): void => ids.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
        add(childIds(doc));
        for (const places of indexDoc(doc).values()) if (places[0].node.childCount > 1) add(childIds(places[0].node));
        return counts;
    }
    function decorate(doc: Node, read: boolean): DecorationSet {
        const current = uses(doc), shared = server(), items: Decoration[] = [];
        if (read) baseline = current;
        for (const [id, n] of current) {
            const prior = baseline.get(id) ?? 0;
            if (Math.max(n, (shared[id] ?? prior) + n - prior) < 2) continue;
            for (const p of indexDoc(doc).get(id) ?? []) items.push(Decoration.node(p.pos, p.pos + p.node.nodeSize, { class: "sync-block" }));
        }
        return DecorationSet.create(doc, items);
    }
    return new Plugin({
        key: borders, state: {
            init: (_config, state) => decorate(state.doc, true),
            apply(tr, prev) {
                if (tr.getMeta(borders)) return decorate(tr.doc, true);
                if (!tr.docChanged) return prev;
                let structure = false;
                tr.mapping.maps.forEach((map, i) => map.forEach((from, to) => {
                    const start = tr.docs[i].resolve(from);
                    if (!start.parent.inlineContent || !start.sameParent(tr.docs[i].resolve(to))) structure = true;
                }));
                return structure ? decorate(tr.doc, false) : prev.map(tr.mapping, tr.doc);
            }
        }, props: { decorations: state => borders.getState(state) }
    });
}