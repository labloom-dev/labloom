import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { blocks, pages, pageAttrs, editTabs, undoNodes } from "../storage/tables";
import { fingerprint } from "./attributes";
import { KnowledgeService, type StoredState } from "./service";
import { unreachablePages } from "../../shared/content/lifecycle";
import { decodeValue } from "../../shared/attrs/values";

export class EditHistory {
    constructor(readonly service: KnowledgeService) {
        service.onCommitted = (before, after, tab, page) => this.capture(before, after, tab, page);
        service.onInvalidated = keys => this.invalidate(new Set(keys));
        service.onDefinitionChanged = (id, definition, typeChanged) => {
            const affected = new Set<string>();
            for (const node of service.db.select().from(undoNodes).all()) {
                for (const state of [node.before, node.after] as StoredState[]) for (const [key, value] of Object.entries(state)) {
                    if (!value || !("attrs" in value)) continue;
                    const attr = value.attrs.find(row => row.attrId === id);
                    if (!attr) continue;
                    if (!definition || typeChanged) affected.add(key);
                    else {
                        try {
                            decodeValue(definition, attr.value);
                        }
                        catch {
                            affected.add(key);
                        }
                    }
                }
            }
            if (affected.size) this.invalidate(affected);
        };
    }

    private capture(before: StoredState, after: StoredState, tabId: string, pageId: string): void {
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => fingerprint(before[key] ?? null) !== fingerprint(after[key] ?? null));
        if (!keys.length) return;
        this.invalidate(new Set(keys), tabId);
        if (tabId === "attribute-definition" || !pageId) return;
        const db = this.service.db;
        db.insert(editTabs).values({ id: tabId }).onConflictDoNothing().run();
        const tab = db.select().from(editTabs).where(eq(editTabs.id, tabId)).get()!;
        const id = randomUUID();
        db.insert(undoNodes).values({ id, tabId, parentId: tab.cursor, pageId,
            before: Object.fromEntries(keys.map(key => [key, before[key] ?? null])),
            after: Object.fromEntries(keys.map(key => [key, after[key] ?? null])), createdAt: new Date().toISOString() }).run();
        db.update(editTabs).set({ cursor: id }).where(eq(editTabs.id, tabId)).run();
    }

    invalidate(keys: Set<string>, exceptTab?: string): void {
        const db = this.service.db, nodes = db.select().from(undoNodes).all();
        const byId = new Map(nodes.map(node => [node.id, node]));
        const removed = new Set(nodes.filter(node => node.tabId !== exceptTab && [...Object.keys(node.before), ...Object.keys(node.after)].some(key => keys.has(key))).map(node => node.id));
        if (!removed.size) return;
        const survivingParent = (id: string | null): string | null => {
            const seen = new Set<string>();
            while (id && removed.has(id) && !seen.has(id)) {
                seen.add(id);
                id = byId.get(id)?.parentId ?? null;
            }
            return id;
        };
        for (const node of nodes) if (!removed.has(node.id) && node.parentId && removed.has(node.parentId)) db.update(undoNodes).set({ parentId: survivingParent(node.parentId) }).where(eq(undoNodes.id, node.id)).run();
        for (const tab of db.select().from(editTabs).all()) if (tab.cursor && removed.has(tab.cursor)) db.update(editTabs).set({ cursor: survivingParent(tab.cursor) }).where(eq(editTabs.id, tab.id)).run();
        for (const id of removed) db.delete(undoNodes).where(eq(undoNodes.id, id)).run();
    }

    state(tabId: string): { canUndo: boolean; redo: { id: string; time: string }[] } {
        const db = this.service.db, cursor = db.select().from(editTabs).where(eq(editTabs.id, tabId)).get()?.cursor ?? null;
        return { canUndo: !!cursor, redo: db.select().from(undoNodes).where(eq(undoNodes.tabId, tabId)).all().filter(node => node.parentId === cursor).map(node => ({ id: node.id, time: node.createdAt })).reverse() };
    }

    apply(tabId: string, direction: "undo" | "redo", branchId?: string): string {
        const db = this.service.db;
        return db.$client.transaction(() => {
            const tab = db.select().from(editTabs).where(eq(editTabs.id, tabId)).get();
            if (!tab) throw new Error("此标签页没有可恢复的编辑记录。");
            const nodes = db.select().from(undoNodes).where(eq(undoNodes.tabId, tabId)).all();
            const node = direction === "undo" ? nodes.find(node => node.id === tab.cursor)
                : nodes.find(node => node.parentId === tab.cursor && node.id === (branchId ?? this.state(tabId).redo[0]?.id));
            if (!node) throw new Error("该撤销或重做分支已失效。");
            const expected = (direction === "undo" ? node.after : node.before) as StoredState;
            const desired = (direction === "undo" ? node.before : node.after) as StoredState;
            const current = this.service.snapshot();
            for (const [key, value] of Object.entries(expected)) {
                const existing = current[key] ?? null;
                // A newly created block is retained on undo, so other occurrences
                // and history never lose their content through implicit GC.
                if (key.startsWith("block:") && value === null && fingerprint(existing) === fingerprint(desired[key] ?? null)) continue;
                if (fingerprint(value) !== fingerprint(existing)) throw new Error("相关对象已变化，不能用旧历史覆盖当前内容。");
            }
            for (const [key, value] of Object.entries(desired)) if (key.startsWith("block:") && value && "content" in value) db.insert(blocks).values(value).onConflictDoUpdate({ target: blocks.id, set: value }).run();
            for (const [key, value] of Object.entries(desired)) {
                if (!key.startsWith("page:")) continue;
                if (!value) db.delete(pages).where(eq(pages.id, key.slice(5))).run();
                else if ("page" in value) {
                    db.insert(pages).values(value.page).onConflictDoUpdate({ target: pages.id, set: value.page }).run();
                    const ids = new Set(value.attrs.map(attr => attr.attrId));
                    for (const current of db.select().from(pageAttrs).where(eq(pageAttrs.pageId, value.page.id)).all()) if (current.attrId.startsWith("custom:") && !ids.has(current.attrId)) db.$client.prepare("DELETE FROM page_attrs WHERE page_id = ? AND attr_id = ?").run(current.pageId, current.attrId);
                    for (const attr of value.attrs) db.insert(pageAttrs).values(attr).onConflictDoUpdate({ target: [pageAttrs.pageId, pageAttrs.attrId], set: { value: attr.value } }).run();
                }
            }
            if (direction === "redo") for (const [key, value] of Object.entries(desired)) if (key.startsWith("block:") && value === null) db.delete(blocks).where(eq(blocks.id, key.slice(6))).run();
            this.service.touch(node.pageId);
            if (unreachablePages(this.service.graphPages(), this.service.readBlocks(), this.service.attributes.definitions()).length) throw new Error("当前引用关系已变化，无法安全恢复此历史节点。");
            this.service.rebuildLinks();
            this.service.onScheduled?.(current, this.service.snapshot());
            this.invalidate(new Set(Object.keys(desired)), tabId);
            db.update(editTabs).set({ cursor: direction === "undo" ? node.parentId : node.id }).where(eq(editTabs.id, tabId)).run();
            return node.pageId;
        })();
    }

    close(tabId: string): void {
        const db = this.service.db;
        db.$client.transaction(() => {
            db.delete(undoNodes).where(eq(undoNodes.tabId, tabId)).run();
            db.delete(editTabs).where(eq(editTabs.id, tabId)).run();
        })();
    }
}