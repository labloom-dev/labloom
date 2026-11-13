import { existsSync, renameSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { validUUID } from "../../shared/attrs/values";
import type { Target } from "../../shared/types/content";
import type { PurgeResult } from "../../shared/types/knowledge";
import { fingerprint } from "./attributes";
import { EditChanges } from "./changes";
import { EditHistory } from "./history";
import { checkTab, KnowledgeService } from "./service";

/** Other recycle material also retains its dependencies until it is explicitly purged. */
class RecycleRetention extends EditChanges {
    constructor(data: KnowledgeService, readonly removed: Set<string>, readonly candidates: Set<string>) {
        super(data);
    }
    override flags(id: string): { deleted: boolean; independent: boolean } {
        return { deleted: this.removed.has(id), independent: !this.candidates.has(id) };
    }
}

export class PurgeService {
    constructor(readonly data: KnowledgeService, readonly history: EditHistory, readonly root: string) { }

    private plan(ids: string[] | null): { pages: string[]; blocks: string[]; links: number } {
        const db = this.data;
        const selected = ids === null ? db.statement("SELECT page_id FROM page_attrs WHERE attr_id='deleted' AND value=1").pluck().all() as string[] : ids;
        if (!Array.isArray(selected) || selected.some(id => !validUUID(id))) throw new Error("页面选择无效。");
        const removed = new Set(selected);
        for (const id of removed) {
            db.header(id);
            if (!db.flags(id).deleted) throw new Error("只能永久删除回收站中的页面。");
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
            queue.push(...db.outgoing(target).map(edge => ({ kind: edge.targetKind, id: edge.targetId })));
        }
        const retention = new RecycleRetention(db, removed, candidates);
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
        const db = this.data, moved: { from: string; to: string }[] = [];
        let result: PurgeResult;
        try {
            result = db.sql.transaction((): PurgeResult => {
                const plan = this.plan(ids), pages = plan.pages.map(id => ({ id, title: db.title(id) }));
                const token = fingerprint({ ids, ...plan, pages });
                if (pages.length && token !== confirmation) return { status: "confirmation", token, pages, links: plan.links };
                if (!pages.length) return { status: "deleted", pages: [], blocks: [] };
                this.history.invalidate([...plan.pages.map(id => "page:" + id), ...plan.blocks.map(id => "block:" + id)]);
                const pageJSON = JSON.stringify(plan.pages);
                const files = db.statement("SELECT DISTINCT a.id, a.stored_name AS name FROM page_attachments p JOIN attachments a ON a.id=p.file_id WHERE p.page_id IN (SELECT value FROM json_each(?))").all(pageJSON) as { id: string; name: string }[];
                for (const id of plan.blocks) {
                    const block = db.blockRow(id);
                    if (block?.type !== "source") continue;
                    const anchor = JSON.parse(block.content ?? "{}").source?.anchorId;
                    const file = db.statement("SELECT a.id, a.stored_name AS name FROM attachments a JOIN anchors n ON n.file_id=a.id WHERE n.id=?").get(anchor ?? "") as { id: string; name: string } | undefined;
                    if (file && !files.some(existing => existing.id === file.id)) files.push(file);
                }
                db.statement("DELETE FROM page_attachments WHERE page_id IN (SELECT value FROM json_each(?))").run(pageJSON);
                db.statement("DELETE FROM reminder_schedules WHERE page_id IN (SELECT value FROM json_each(?))").run(pageJSON);
                db.statement("DELETE FROM notifications WHERE page_id IN (SELECT value FROM json_each(?))").run(pageJSON);
                db.statement("DELETE FROM link_index WHERE source_kind='page' AND source_id IN (SELECT value FROM json_each(?))").run(pageJSON);
                db.statement("DELETE FROM pages WHERE id IN (SELECT value FROM json_each(?))").run(pageJSON);
                // Older history can restore shallow child pointers or source/anchor references.
                const held = new Set<string>(), heldAnchors = new Set<string>(), historicalMarks = new Map<string, Set<string>>();
                const children = (value: unknown): void => { if (Array.isArray(value)) for (const id of value) if (typeof id === "string") held.add(id); };
                for (const row of db.statement("SELECT before_state AS before, after_state AS after FROM undo_nodes").all() as { before: string; after: string }[]) {
                    for (const serialized of [row.before, row.after]) {
                        const state = JSON.parse(serialized) as Record<string, Record<string, unknown> | null>;
                        for (const [key, value] of Object.entries(state)) {
                            if (!value) continue;
                            children(value.children);
                            if (key.startsWith("highlight:") && typeof value.anchorId === "string") {
                                const ids = historicalMarks.get(value.anchorId) ?? new Set<string>();
                                ids.add(key.slice("highlight:".length)); historicalMarks.set(value.anchorId, ids);
                            }
                            if (key.startsWith("block:") && value.type === "source" && typeof value.content === "string") {
                                const anchorId = JSON.parse(value.content).source?.anchorId;
                                if (typeof anchorId === "string") heldAnchors.add(anchorId);
                            }
                            if (key.startsWith("page:")) {
                                const legacy = value.page as { children?: unknown; titleBlockId?: string } | undefined;
                                if (legacy) { children(legacy.children); if (legacy.titleBlockId) held.add(legacy.titleBlockId); }
                                const values = value.values as Record<string, { value?: unknown } | null> | undefined;
                                const anchor = values?.annotation_anchor?.value;
                                if (typeof anchor === "string") heldAnchors.add(anchor);
                                const attrs = value.attrs as { attrId: string; value: unknown }[] | undefined;
                                for (const attr of attrs ?? []) if (attr.attrId === "annotation_anchor" && typeof attr.value === "string") heldAnchors.add(attr.value);
                            }
                        }
                    }
                }
                const keep = plan.blocks.filter(id => held.has(id));
                while (keep.length) {
                    const id = keep.pop()!;
                    for (const child of db.children({ kind: "block", id })) if (!held.has(child)) {
                        held.add(child); keep.push(child);
                    }
                }
                const blocks = plan.blocks.filter(id => !held.has(id)), blockJSON = JSON.stringify(blocks);
                db.statement("DELETE FROM link_index WHERE source_kind='block' AND source_id IN (SELECT value FROM json_each(?))").run(blockJSON);
                db.statement("DELETE FROM blocks WHERE id IN (SELECT value FROM json_each(?))").run(blockJSON);
                for (const file of files) {
                    if (db.statement("SELECT 1 FROM page_attachments WHERE file_id=? LIMIT 1").get(file.id)) continue;
                    const anchors = db.statement("SELECT id FROM anchors WHERE file_id=?").pluck().all(file.id) as string[];
                    if (anchors.some(id => heldAnchors.has(id) || db.statement("SELECT 1 FROM blocks WHERE type='source' AND json_extract(content,'$.source.anchorId')=? LIMIT 1").get(id))) continue;
                    const marks = db.statement("SELECT id FROM highlights WHERE anchor_id IN (SELECT id FROM anchors WHERE file_id=?)").pluck().all(file.id) as string[];
                    for (const anchor of anchors) for (const id of historicalMarks.get(anchor) ?? []) if (!marks.includes(id)) marks.push(id);
                    this.history.invalidate(marks.map(id => "highlight:" + id));
                    if (basename(file.name) !== file.name) throw new Error("附件存储名称无效。");
                    const from = join(this.root, "attachments", file.name), to = from + ".purge-" + randomUUID();
                    if (existsSync(from)) {
                        renameSync(from, to); moved.push({ from, to });
                    }
                    db.statement("DELETE FROM highlights WHERE anchor_id IN (SELECT id FROM anchors WHERE file_id=?)").run(file.id);
                    db.statement("DELETE FROM anchors WHERE file_id=?").run(file.id);
                    db.statement("DELETE FROM attachments WHERE id=?").run(file.id);
                }
                return { status: "deleted", pages: plan.pages, blocks };
            })();
        }
        catch (error) {
            for (const file of moved.reverse()) renameSync(file.to, file.from); throw error;
        }
        for (const file of moved) unlinkSync(file.to);
        if (result.status === "deleted") db.onChanged?.({ sourceTab: tabId, pages: result.pages, blocks: result.blocks, backlinks: result.pages, purged: result.pages });
        return result;
    }
}