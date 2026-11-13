import { LabloomError } from "../../shared/failure";
import { validUUID } from "../../shared/attrs/values";
import { withFileCleanup } from "../storage/files";
import type { Target } from "../../shared/types/content";
import type { PurgeResult } from "../../shared/types/knowledge";
import { fingerprint } from "./attributes";
import { EditChanges } from "./changes";
import { EditHistory } from "./history";
import { checkTab, KnowledgeService } from "./service";

/** Other recycle material also retains its dependencies until it is explicitly purged. */
class RecycleRetention extends EditChanges {
    constructor(data: KnowledgeService, readonly removed: Set<string>) {
        super(data);
    }
    override flags(id: string): { deleted: boolean; independent: boolean } {
        return { deleted: this.removed.has(id), independent: this.data.flags(id).independent };
    }
}

export class PurgeService {
    constructor(readonly data: KnowledgeService, readonly history: EditHistory, readonly root: string) { }

    private plan(ids: string[] | null): { pages: string[]; blocks: string[]; links: number } {
        const db = this.data;
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
        const retention = new RecycleRetention(db, removed);
        while (true) {
            const lost = [...candidates].filter(id => !removed.has(id) && !retention.reachable({ kind: "page", id }, removed));
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

    purge(ids: string[] | null, tabId: string, confirmation?: string): PurgeResult {
        checkTab(tabId);
        const db = this.data;
        const result = withFileCleanup(db.db, this.root, (cleanup): PurgeResult => {
            const plan = this.plan(ids), pages = plan.pages.map(id => ({ id, title: db.title(id) }));
            const token = fingerprint({ ids, ...plan, pages });
            if (pages.length && token !== confirmation) return { status: "confirmation", token, pages, links: plan.links };
            if (!pages.length) return { status: "deleted", pages: [], blocks: [] };
            const pageJSON = JSON.stringify(plan.pages);
            const retained = db.statement("SELECT page_id AS pageId,value FROM page_attrs WHERE attr_id='paper_annotations'").all() as { pageId: string; value: string }[];
            for (const row of retained) {
                if (plan.pages.includes(row.pageId)) continue;
                const current = JSON.parse(row.value) as string[], next = current.filter(id => !plan.pages.includes(id));
                if (next.length !== current.length) db.attributes.write(row.pageId, { paper_annotations: next }, true);
            }
            db.statement("DELETE FROM link_refs WHERE source_kind='page' AND source_id IN (SELECT value FROM json_each(?))").run(pageJSON);
            db.statement("DELETE FROM pages WHERE id IN (SELECT value FROM json_each(?))").run(pageJSON);
            const blocks = plan.blocks, blockJSON = JSON.stringify(blocks);
            db.statement("DELETE FROM link_refs WHERE source_kind='block' AND source_id IN (SELECT value FROM json_each(?))").run(blockJSON);
            db.statement("DELETE FROM blocks WHERE id IN (SELECT value FROM json_each(?))").run(blockJSON);
            cleanup();
            return { status: "deleted", pages: plan.pages, blocks };
        });
        if (result.status === "deleted" && result.pages.length) this.history.clear();
        if (result.status === "deleted") db.onChanged?.({ sourceTab: tabId, pages: result.pages, blocks: result.blocks, backlinks: result.pages, purged: result.pages });
        return result;
    }
}