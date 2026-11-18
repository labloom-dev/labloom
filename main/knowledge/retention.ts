import { validUUID } from "../../shared/attrs/values";
import { LabloomError } from "../../shared/failure";
import * as workspace from "../workspace-state";
import { type LinkTarget, type Target } from "../../shared/types/content";
import { type EditChanges } from "./changes";
import * as data from "./records";
const key = (target: LinkTarget): string => target.kind + ":" + target.id;
type View = Pick<EditChanges, "flags" | "owners" | "parents" | "incoming" | "outgoing" | "children" | "seeds" | "recycleSources">;

const databaseView: View = {
    flags: data.flags, owners: data.owners, parents: id => data.uses(id),
    incoming: target => data.incoming(target).map(edge => ({ kind: edge.sourceKind, id: edge.sourceId })),
    outgoing: source => data.outgoing(source).map(edge => ({ kind: edge.targetKind, id: edge.targetId })),
    children: data.children, seeds: [], recycleSources: new Set()
};
/** Page retention: independent pages retain targets through links and synchronous placements. */
export function reachable(view: View, start: Target, recycled = new Set<string>(), removed?: Set<string>): boolean {
    workspace.requireWorkspace();
    const seen = new Set<string>(), queue = [start];
    for (let i = 0; i < queue.length; i++) {
        const t = queue[i];
        if (seen.has(key(t))) continue;
        seen.add(key(t));
        if (t.kind === "page") {
            const flags = view.flags(t.id);
            if ((removed ? removed.has(t.id) : flags.deleted) || recycled.has(t.id)) continue;
            if (flags.independent) return true;
            queue.push(...view.incoming(t));
        }
        else {
            if (!view.owners(t.id).some(id => !(removed ? removed.has(id) : view.flags(id).deleted) && !recycled.has(id))) continue;
            queue.push(...view.parents(t.id));
        }
    }
    return false;
}

/** Recycle pages that lose their last retaining path, including the draft's unpersisted changes. */
export function lostPages(view: View): string[] {
    workspace.requireWorkspace();
    if (!view.seeds.length) return [];
    const candidates = new Set<string>(), inspectedBlocks = new Set<string>(), recycled = new Set<string>();
    const expand = (seeds: Target[]): void => {
        const queue = [...seeds];
        while (queue.length) {
            const t = queue.pop()!;
            if (t.kind === "page") {
                candidates.add(t.id); continue;
            }
            if (inspectedBlocks.has(t.id)) continue;
            inspectedBlocks.add(t.id);
            for (const id of view.children(t)) queue.push({ kind: "block", id });
            queue.push(...view.outgoing(t).filter((target): target is Target => target.kind !== "file"));
        }
    };
    const expandPage = (id: string): void => {
        const t: Target = { kind: "page", id };
        const children = view.children(t);
        expand([...view.outgoing(t).filter((target): target is Target => target.kind !== "file"), ...[data.header(id).titleBlockId, ...children].map(id => ({ kind: "block" as const, id }))]);
    };
    expand(view.seeds);
    for (const id of view.recycleSources) expandPage(id);
    while (true) {
        const lost = [...candidates].filter(id => !recycled.has(id) && !view.flags(id).deleted && !reachable(view, { kind: "page", id }, recycled));
        if (!lost.length) return [...recycled].sort();
        for (const id of lost) {
            recycled.add(id); expandPage(id);
        }
    }
}

/** Purge closure: other recycle-bin pages still retain their dependencies; selected pages do not. */
export function purgePlan(ids: string[] | null): { pages: string[]; blocks: string[]; links: number } {
    workspace.requireWorkspace();
    const db = data;
    const selected = ids === null ? db.statement("SELECT page_id FROM page_attrs WHERE attr_id='deleted' AND value=1").pluck().all() as string[] : ids;
    if (!Array.isArray(selected) || selected.some(id => !validUUID(id))) throw new LabloomError({ kind: "page-invalid-selection" });
    const removed = new Set(selected);
    for (const id of removed) {
        db.header(id);
        if (!db.flags(id).deleted) throw new LabloomError({ kind: "purge-recycled-only" });
    }
    const candidates = new Set<string>(), seen = new Set<string>();
    const queue: Target[] = [...removed].map(id => ({ kind: "page", id }));
    while (queue.length) {
        const target = queue.pop()!, key = target.kind + ":" + target.id;
        if (seen.has(key)) continue;
        seen.add(key);
        if (target.kind === "page") {
            if (!removed.has(target.id)) {
                const flags = db.flags(target.id);
                if (!flags.deleted || flags.independent || !db.statement("SELECT 1 FROM pages WHERE id=?").get(target.id)) continue;
                candidates.add(target.id);
            }
            queue.push({ kind: "block", id: db.header(target.id).titleBlockId });
        }
        queue.push(...db.children(target).map(id => ({ kind: "block" as const, id })));
        queue.push(...db.outgoing(target).filter(edge => edge.targetKind === "page").map(edge => ({ kind: "page" as const, id: edge.targetId })));
    }
    const view = databaseView;
    while (true) {
        const lost = [...candidates].filter(id => !removed.has(id) && !reachable(view, { kind: "page", id }, removed, removed));
        if (!lost.length) break;
        for (const id of lost) removed.add(id);
    }
    const contained = new Set<string>(), blocks: string[] = [];
    const pending = [...removed].flatMap(id => [db.header(id).titleBlockId, ...db.children({ kind: "page", id })]);
    while (pending.length) {
        const id = pending.pop()!;
        if (contained.has(id)) continue;
        contained.add(id);
        pending.push(...db.children({ kind: "block", id }));
        if (!db.owners(id).some(owner => !removed.has(owner))) blocks.push(id);
    }
    const keys = new Set([...removed].map(id => "page:" + id));
    for (const id of blocks) keys.add("block:" + id);
    let links = 0;
    for (const target of [...[...removed].map(id => ({ kind: "page" as const, id })), ...blocks.map(id => ({ kind: "block" as const, id }))]) {
        links += db.incoming(target).filter(edge => !keys.has(edge.sourceKind + ":" + edge.sourceId) && (edge.sourceKind === "page" || db.owners(edge.sourceId).some(id => !removed.has(id)))).length;
    }
    return { pages: [...removed].sort(), blocks: blocks.sort(), links };
}

/** Physical block existence: every extant page, including recycle-bin pages, retains its sync tree. */
export function orphanBlocks(): string[] {
    workspace.requireWorkspace();
    return (data.statement(`WITH RECURSIVE retained(id) AS MATERIALIZED (
        SELECT block_id FROM sync_refs WHERE container_kind='page'
        UNION
        SELECT r.block_id FROM sync_refs r JOIN retained p ON r.container_kind='block' AND r.container_id=p.id
    ) SELECT id FROM blocks WHERE id NOT IN (SELECT id FROM retained)`).all() as { id: string }[]).map(row => row.id);
}