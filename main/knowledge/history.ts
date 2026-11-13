import { LabloomError } from "../../shared/failure";
import { randomUUID } from "node:crypto";
import { type Database } from "better-sqlite3";
import { decodeValue } from "../../shared/attrs/values";
import { type AttributeValue } from "../../shared/types/attributes";
import { type CommitResult } from "../../shared/types/content";
import { type HistoryState } from "../../shared/types/knowledge";
import { EditChanges, type PagePatch, type RowChanges, type StoredState } from "./changes";
import { decodeBlock } from "./records";
import { checkTab, KnowledgeService } from "./service";

type Node = { id: string; tab: string; parent: string | null; children: Set<string>; page: string; before: StoredState; after: StoredState; keys: string[]; time: number; order: number };
type Tab = { cursor: string | null; nodes: Set<string> };
type Store = { tabs: Map<string, Tab>; nodes: Map<string, Node>; objects: Map<string, Set<string>>; sequence: number };
// Windows share a native workspace connection. Reopening creates a new connection.
const workspaces = new WeakMap<Database, Store>();

export class EditHistory {
    private readonly store: Store;
    constructor(readonly service: KnowledgeService) {
        let store = workspaces.get(service.sql);
        if (!store) {
            store = { tabs: new Map(), nodes: new Map(), objects: new Map(), sequence: 0 };
            workspaces.set(service.sql, store);
        }
        this.store = store;
        service.onCommitted = (tab, page, rows) => this.capture(tab, page, rows);
        service.onInvalidated = (keys, except) => this.invalidate(keys, except);
    }

    capture(tabId: string, pageId: string, rows: RowChanges): void {
        const keys = [...new Set([...Object.keys(rows.before), ...Object.keys(rows.after)])];
        if (!keys.length) return;
        this.invalidate(keys, tabId);
        const definitions = new Set<string>();
        for (const state of [rows.before, rows.after]) for (const [key, value] of Object.entries(state)) {
            if (key.startsWith("page:") && value && "values" in value) for (const id of Object.keys(value.values ?? {})) definitions.add("attribute:" + id);
        }
        const tab = this.store.tabs.get(tabId) ?? { cursor: null, nodes: new Set<string>() };
        this.store.tabs.set(tabId, tab);
        const node: Node = { id: randomUUID(), tab: tabId, parent: tab.cursor, children: new Set(), page: pageId,
            ...structuredClone(rows), keys: [...keys, ...definitions], time: Date.now(), order: ++this.store.sequence };
        this.store.nodes.set(node.id, node);
        if (node.parent) this.store.nodes.get(node.parent)!.children.add(node.id);
        tab.nodes.add(node.id);
        tab.cursor = node.id;
        for (const key of node.keys) {
            const nodes = this.store.objects.get(key) ?? new Set<string>();
            nodes.add(node.id);
            this.store.objects.set(key, nodes);
        }
    }

    private remove(node: Node): void {
        this.store.nodes.delete(node.id);
        this.store.tabs.get(node.tab)?.nodes.delete(node.id);
        if (node.parent) this.store.nodes.get(node.parent)?.children.delete(node.id);
        for (const key of node.keys) {
            const nodes = this.store.objects.get(key)!;
            nodes.delete(node.id);
            if (!nodes.size) this.store.objects.delete(key);
        }
    }

    invalidate(keys: string[], exceptTab = ""): void {
        const removed = new Map<string, Node>();
        for (const key of keys) for (const id of this.store.objects.get(key) ?? []) {
            const node = this.store.nodes.get(id)!;
            if (node.tab !== exceptTab) removed.set(id, node);
        }
        const parentOf = (node: Node): string | null => {
            let parent = node.parent;
            while (parent && removed.has(parent)) parent = removed.get(parent)!.parent;
            return parent;
        };
        for (const node of removed.values()) {
            const parent = parentOf(node);
            for (const id of node.children) {
                if (removed.has(id)) continue;
                this.store.nodes.get(id)!.parent = parent;
                if (parent) this.store.nodes.get(parent)!.children.add(id);
            }
            const tab = this.store.tabs.get(node.tab)!;
            if (tab.cursor === node.id) tab.cursor = parent;
        }
        for (const node of removed.values()) this.remove(node);
    }

    state(tabId: string): HistoryState {
        checkTab(tabId);
        const tab = this.store.tabs.get(tabId);
        if (!tab) return { canUndo: false, redo: [] };
        const redo = [...tab.nodes].map(id => this.store.nodes.get(id)!).filter(node => node.parent === tab.cursor).sort((a, b) => b.order - a.order);
        return { canUndo: tab.cursor !== null, redo: redo.map(node => ({ id: node.id, time: node.time })) };
    }

    apply(tabId: string, direction: "undo" | "redo", branchId?: string, confirmation?: string): CommitResult {
        return this.service.transact(tabId, () => {
            const db = this.service, tab = this.store.tabs.get(tabId);
            if (!tab || !["undo", "redo"].includes(direction)) throw new LabloomError({ kind: "history-empty" });
            const id = direction === "undo" ? tab.cursor : this.state(tabId).redo.find(node => !branchId || node.id === branchId)?.id;
            const node = id ? this.store.nodes.get(id) : undefined;
            if (!node) throw new LabloomError({ kind: "history-branch-invalid" });
            const desired = direction === "undo" ? node.before : node.after;
            const plan = new EditChanges(db);
            for (const [key, value] of Object.entries(desired)) {
                if (!key.startsWith("block:")) continue;
                const id = key.slice(6);
                if (value && "content" in value) plan.putBlock(decodeBlock(value), value);
                plan.blocks.add(id);
            }
            const created: string[] = [];
            for (const [key, value] of Object.entries(desired)) {
                if (!key.startsWith("page:") || !value || "content" in value) continue;
                const id = key.slice(5), patch = value as PagePatch;
                if (patch.creation) created.push(id);
                if (patch.children) plan.pageChildren(id, patch.children);
                const values: Record<string, AttributeValue> = {}, detach: string[] = [];
                for (const [field, row] of Object.entries(patch.values ?? {})) {
                    if (patch.creation && field === "deleted") continue;
                    if (row) values[field] = decodeValue(db.attributes.definition(field), row.value);
                    else detach.push(field);
                }
                plan.attributes(id, values, detach, true);
                plan.pages.add(id);
            }
            for (const id of created) if (!plan.reachable({ kind: "page", id }, new Set())) plan.attributes(id, { deleted: true, recycle_reason: "unreachable", recycled_at: Math.floor(Date.now() / 1000) }, [], true);
            return db.historyCommit(plan, node.page, tabId, { direction, tabId, node: node.id }, confirmation, rows => {
                this.invalidate([...new Set([...Object.keys(desired), ...Object.keys(rows.after)])], tabId);
                tab.cursor = direction === "undo" ? node.parent : node.id;
            });
        });
    }

    close(tabId: string): void {
        checkTab(tabId);
        for (const id of this.store.tabs.get(tabId)?.nodes ?? []) this.remove(this.store.nodes.get(id)!);
        this.store.tabs.delete(tabId);
    }

    clear(): void {
        this.store.tabs.clear();
        this.store.nodes.clear();
        this.store.objects.clear();
    }
}