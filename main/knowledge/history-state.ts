import { randomUUID } from "node:crypto";
import { type HistoryState } from "../../shared/types/knowledge";
import * as workspace from "../workspace-state";
import { type RowChanges, type StoredState } from "./changes";
import { checkTab } from "./validation";

type Node = { id: string; tab: string; parent: string | null; children: Set<string>; page: string; before: StoredState; after: StoredState; keys: string[]; time: number; order: number };
type Tab = { cursor: string | null; nodes: Set<string> };
type Store = { tabs: Map<string, Tab>; nodes: Map<string, Node>; objects: Map<string, Set<string>>; sequence: number };
let store: Store = { tabs: new Map(), nodes: new Map(), objects: new Map(), sequence: 0 };
export function release(): void {
    store = { tabs: new Map(), nodes: new Map(), objects: new Map(), sequence: 0 };
}
export function capture(tabId: string, pageId: string, rows: RowChanges): void {
    workspace.requireWorkspace();
    const keys = [...new Set([...Object.keys(rows.before), ...Object.keys(rows.after)])];
    if (!keys.length) return;
    invalidate(keys, tabId);
    const definitions = new Set<string>();
    for (const state of [rows.before, rows.after]) for (const [key, value] of Object.entries(state)) {
        if (key.startsWith("page:") && value && "values" in value) for (const id of Object.keys(value.values ?? {})) definitions.add("attribute:" + id);
    }
    const tab = store.tabs.get(tabId) ?? { cursor: null, nodes: new Set<string>() };
    store.tabs.set(tabId, tab);
    const node: Node = {
        id: randomUUID(), tab: tabId, parent: tab.cursor, children: new Set(), page: pageId,
        ...structuredClone(rows), keys: [...keys, ...definitions], time: workspace.clock(), order: ++store.sequence
    };
    store.nodes.set(node.id, node);
    if (node.parent) store.nodes.get(node.parent)!.children.add(node.id);
    tab.nodes.add(node.id);
    tab.cursor = node.id;
    for (const key of node.keys) {
        const nodes = store.objects.get(key) ?? new Set<string>();
        nodes.add(node.id);
        store.objects.set(key, nodes);
    }
}

function remove(node: Node): void {
    store.nodes.delete(node.id);
    store.tabs.get(node.tab)?.nodes.delete(node.id);
    if (node.parent) store.nodes.get(node.parent)?.children.delete(node.id);
    for (const key of node.keys) {
        const nodes = store.objects.get(key)!;
        nodes.delete(node.id);
        if (!nodes.size) store.objects.delete(key);
    }
}

export function invalidate(keys: string[], exceptTab = ""): void {
    workspace.requireWorkspace();
    const removed = new Map<string, Node>();
    for (const key of keys) for (const id of store.objects.get(key) ?? []) {
        const node = store.nodes.get(id)!;
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
            store.nodes.get(id)!.parent = parent;
            if (parent) store.nodes.get(parent)!.children.add(id);
        }
        const tab = store.tabs.get(node.tab)!;
        if (tab.cursor === node.id) tab.cursor = parent;
    }
    for (const node of removed.values()) remove(node);
}

export function state(tabId: string): HistoryState {
    workspace.requireWorkspace();
    checkTab(tabId);
    const tab = store.tabs.get(tabId);
    if (!tab) return { canUndo: false, redo: [] };
    const redo = [...tab.nodes].map(id => store.nodes.get(id)!).filter(node => node.parent === tab.cursor).sort((a, b) => b.order - a.order);
    return { canUndo: tab.cursor !== null, redo: redo.map(node => ({ id: node.id, time: node.time })) };
}

export function close(tabId: string): void {
    workspace.requireWorkspace();
    checkTab(tabId);
    for (const id of store.tabs.get(tabId)?.nodes ?? []) remove(store.nodes.get(id)!);
    store.tabs.delete(tabId);
}

export function clear(): void {
    workspace.requireWorkspace();
    store.tabs.clear();
    store.nodes.clear();
    store.objects.clear();
}
export function tab(id: string): Tab | undefined {
    workspace.requireWorkspace();
    return store.tabs.get(id);
}
export function node(id: string): Node | undefined {
    workspace.requireWorkspace();
    return store.nodes.get(id);
}