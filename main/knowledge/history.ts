import { randomUUID } from "node:crypto";
import { type CommitResult } from "../../shared/types/content";
import { type HistoryState } from "../../shared/types/knowledge";
import { EditChanges, type PagePatch, type RowChanges, type StoredState } from "./changes";
import { decodeBlock } from "./records";
import { checkTab, KnowledgeService } from "./service";

type Node = { id: string; parent: string | null; page: string; before: string; after: string };
export class EditHistory {
    constructor(readonly service: KnowledgeService) {
        service.onCommitted = (tab, page, rows) => this.capture(tab, page, rows);
        service.onInvalidated = (keys, except) => this.invalidate(keys, except);
    }

    capture(tabId: string, pageId: string, rows: RowChanges): void {
        const keys = Object.keys(rows.after);
        if (!keys.length) return;
        this.invalidate(keys, tabId);
        const db = this.service;
        db.statement("INSERT OR IGNORE INTO edit_tabs(id) VALUES (?)").run(tabId);
        const parent = db.statement("SELECT cursor FROM edit_tabs WHERE id=?").pluck().get(tabId) as string | null;
        const id = randomUUID();
        db.statement("INSERT INTO undo_nodes(id,tab_id,parent_id,page_id,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?)")
            .run(id, tabId, parent, pageId, JSON.stringify(rows.before), JSON.stringify(rows.after), Date.now());
        for (const k of keys) db.statement("INSERT INTO undo_objects(node_id,object_key) VALUES (?,?)").run(id, k);
        db.statement("UPDATE edit_tabs SET cursor=? WHERE id=?").run(id, tabId);
    }

    invalidate(keys: string[], exceptTab = ""): void {
        if (!keys.length) return;
        const db = this.service;
        const nodes = db.statement(`SELECT DISTINCT n.id, n.parent_id AS parent, n.tab_id AS tab FROM undo_objects o
            JOIN undo_nodes n ON n.id=o.node_id WHERE o.object_key IN (SELECT value FROM json_each(?)) AND n.tab_id != ?`).all(JSON.stringify(keys), exceptTab) as { id: string; parent: string | null; tab: string }[];
        const removed = new Map(nodes.map(n => [n.id, n.parent]));
        for (const node of nodes) {
            let parent = node.parent;
            while (parent && removed.has(parent)) parent = removed.get(parent) ?? null;
            db.statement("UPDATE undo_nodes SET parent_id=? WHERE parent_id=?").run(parent, node.id);
            db.statement("UPDATE edit_tabs SET cursor=? WHERE id=? AND cursor=?").run(parent, node.tab, node.id);
        }
        for (const node of nodes) db.statement("DELETE FROM undo_nodes WHERE id=?").run(node.id);
    }

    state(tabId: string): HistoryState {
        checkTab(tabId);
        const db = this.service;
        const cursor = db.statement("SELECT cursor FROM edit_tabs WHERE id=?").pluck().get(tabId) as string | null;
        return { canUndo: !!cursor, redo: db.statement("SELECT id,created_at AS time FROM undo_nodes WHERE tab_id=? AND parent_id IS ? ORDER BY rowid DESC").all(tabId, cursor ?? null) as HistoryState["redo"] };
    }

    apply(tabId: string, direction: "undo" | "redo", branchId?: string, confirmation?: string): CommitResult {
        return this.service.transact(tabId, () => {
            const db = this.service, cursor = db.statement("SELECT cursor FROM edit_tabs WHERE id=?").pluck().get(tabId) as string | null;
            if (cursor === undefined || !["undo", "redo"].includes(direction)) throw new Error("此标签页没有可恢复的编辑记录。");
            const cols = "SELECT id,parent_id AS parent,page_id AS page,before_state AS before,after_state AS after FROM undo_nodes ";
            const node = (direction === "undo" ? db.statement(cols + "WHERE tab_id=? AND id=?").get(tabId, cursor)
                : db.statement(cols + "WHERE tab_id=? AND parent_id IS ? AND (? IS NULL OR id=?) ORDER BY rowid DESC LIMIT 1").get(tabId, cursor, branchId ?? null, branchId ?? null)) as Node | undefined;
            if (!node) throw new Error("该撤销或重做分支已失效。");
            const desired: StoredState = JSON.parse(direction === "undo" ? node.before : node.after);
            const plan = new EditChanges(db);
            const oldDeletes = direction === "redo" && Object.entries(desired).some(([k, v]) => k.startsWith("block:") && !v);
            for (const [key, value] of Object.entries(desired)) {
                if (key.startsWith("highlight:") && (!value || "anchorId" in value)) plan.setHighlight(key.slice("highlight:".length), value);
                if (!key.startsWith("block:")) continue;
                const id = key.slice(6);
                if (value && "content" in value) plan.putBlock(decodeBlock(value), value);
                else if (oldDeletes && !value) db.removeEverywhere(plan, id);
                plan.blocks.add(id);
            }
            for (const [key, value] of Object.entries(desired)) {
                if (!key.startsWith("page:") || !value || "content" in value) continue;
                const id = key.slice(5);
                let patch: PagePatch = value as PagePatch;
                if ("page" in value) {
                    // Nodes from older workspaces stored a whole page and all its stable attributes.
                    const stored = Object.fromEntries(value.attrs.map(row => [row.attrId, { value: row.value }]));
                    patch = { children: value.page.children, values: { ...stored } };
                    const existing = db.statement("SELECT attr_id FROM page_attrs WHERE page_id=? AND attr_id LIKE 'custom:%'").pluck().all(id) as string[];
                    for (const field of existing) if (!Object.hasOwn(stored, field)) patch.values![field] = null;
                }
                if (patch.children) plan.pageChildren(id, patch.children);
                for (const [field, row] of Object.entries(patch.values ?? {})) plan.setValue(id, field, row, db.attributes.definition(field));
                plan.pages.add(id);
            }
            return db.historyCommit(plan, node.page, tabId, { direction, tabId, node: node.id }, confirmation, rows => {
                this.invalidate([...new Set([...Object.keys(desired), ...Object.keys(rows.after)])], tabId);
                // Old delete-block nodes omitted the positions. Keep those we just removed for the next undo.
                if (oldDeletes) {
                    const before: StoredState = JSON.parse(node.before), after: StoredState = JSON.parse(node.after);
                    for (const key of Object.keys(rows.after)) if (!Object.hasOwn(after, key)) {
                        before[key] = rows.before[key];
                        after[key] = rows.after[key];
                        db.statement("INSERT OR IGNORE INTO undo_objects(node_id,object_key) VALUES (?,?)").run(node.id, key);
                    }
                    db.statement("UPDATE undo_nodes SET before_state=?,after_state=? WHERE id=?").run(JSON.stringify(before), JSON.stringify(after), node.id);
                }
                db.statement("UPDATE edit_tabs SET cursor=? WHERE id=?").run(direction === "undo" ? node.parent : node.id, tabId);
            });
        });
    }

    close(tabId: string): void {
        checkTab(tabId);
        this.service.sql.transaction(() => {
            this.service.statement("DELETE FROM undo_nodes WHERE tab_id=?").run(tabId);
            this.service.statement("DELETE FROM edit_tabs WHERE id=?").run(tabId);
        })();
    }
}