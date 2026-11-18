import { randomUUID } from "node:crypto";
import { LabloomError } from "../../shared/failure";
import type { HistorySource } from "../../shared/history/ipc";
import type { HistoryState } from "../../shared/types/knowledge";
import * as settings from "../settings/store";
import * as workspace from "../workspace-state";
import type { RowChanges, StoredState } from "./changes";
import * as events from "./events";

type Entry = RowChanges & { id: string; page: string; keys: string[]; dependencies: Set<string>; time: number; order: number; nodes: Map<Tree, Node> };
type Node = { entry: Entry; parent: Node | null; children: Set<Node> };
type Tree = { source: HistorySource; roots: Set<Node>; cursor: Node | null };
export type Replay = { tree: Tree; node: Node; direction: "undo" | "redo" };
export type Invalidation = { keys: string[]; permanent: boolean };
export type Capture = { source: HistorySource; page: string; rows: RowChanges; replay?: Replay };

const trees = new Map<string, Tree>();
// Map iteration follows insertion order, including after unrelated records are removed.
const entries = new Map<string, Entry>();
const objects = new Map<string, Map<Tree, Set<Node>>>();
// A replay also needs its context page and the blocks named by stored child lists
// to exist. Editing their contents is safe, physically deleting them is not.
const dependents = new Map<string, Set<Entry>>();
let sequence = 0;
const treeKey = (source: HistorySource): string => source.kind === "page" ? "page:" + source.id : "workspace";

export function release(): void {
    trees.clear();
    entries.clear();
    objects.clear();
    dependents.clear();
    sequence = 0;
}
function treeFor(source: HistorySource): Tree {
    const key = treeKey(source);
    let tree = trees.get(key);
    if (!tree) {
        tree = { source, roots: new Set(), cursor: null };
        trees.set(key, tree);
    }
    return tree;
}
function children(tree: Tree, parent: Node | null): Set<Node> {
    return parent?.children ?? tree.roots;
}
export function state(source: HistorySource): HistoryState {
    workspace.requireWorkspace();
    const tree = trees.get(treeKey(source));
    if (!tree) return { canUndo: false, redo: [] };
    const redo = [...children(tree, tree.cursor)].map(node => node.entry).sort((a, b) => b.order - a.order);
    return { canUndo: !!tree.cursor, redo: redo.map(({ id, time }) => ({ id, time })) };
}
export function select(source: HistorySource, direction: Replay["direction"], branchId?: string): Replay {
    workspace.requireWorkspace();
    const tree = trees.get(treeKey(source));
    if (!tree) throw new LabloomError({ kind: "history-empty" });
    let node = tree.cursor;
    if (direction === "redo") {
        const id = branchId ?? state(source).redo[0]?.id;
        node = id ? entries.get(id)?.nodes.get(tree) ?? null : null;
        if (node?.parent !== tree.cursor) node = null;
    }
    if (!node) throw new LabloomError({ kind: "history-branch-invalid" });
    return { tree, node, direction };
}
function attach(tree: Tree, entry: Entry): void {
    const node: Node = { entry, parent: tree.cursor, children: new Set() };
    children(tree, tree.cursor).add(node);
    tree.cursor = node;
    entry.nodes.set(tree, node);
    for (const key of entry.keys) {
        let holders = objects.get(key);
        if (!holders) objects.set(key, holders = new Map());
        let nodes = holders.get(tree);
        if (!nodes) holders.set(tree, nodes = new Set());
        nodes.add(node);
    }
}
function remove(tree: Tree, node: Node): void {
    const siblings = children(tree, node.parent);
    siblings.delete(node);
    for (const child of node.children) {
        child.parent = node.parent;
        siblings.add(child);
    }
    if (tree.cursor === node) tree.cursor = node.parent;
    const entry = node.entry;
    entry.nodes.delete(tree);
    if (!entry.nodes.size) {
        entries.delete(entry.id);
        for (const key of entry.dependencies) {
            const records = dependents.get(key)!;
            records.delete(entry);
            if (!records.size) dependents.delete(key);
        }
    }
    for (const key of entry.keys) {
        const holders = objects.get(key)!, nodes = holders.get(tree)!;
        nodes.delete(node);
        if (!nodes.size) holders.delete(tree);
        if (!holders.size) objects.delete(key);
    }
    if (!tree.roots.size) trees.delete(treeKey(tree.source));
}
function invalidate(keys: Iterable<string>, changed: Set<Tree>, except?: Set<Tree>): void {
    for (const key of keys) for (const [tree, nodes] of objects.get(key) ?? []) {
        if (except?.has(tree)) continue;
        changed.add(tree);
        for (const node of nodes) remove(tree, node);
    }
}
function mergeState(target: StoredState, state: StoredState): void {
    for (const [key, value] of Object.entries(state)) {
        const previous = target[key];
        if (previous && value && !("content" in previous) && !("content" in value)) {
            target[key] = { ...previous, ...value, values: { ...previous.values, ...value.values } };
        }
        else target[key] = value;
    }
}
function capture(inputs: Capture[], pages: string[], changed: Set<Tree>): void {
    if (!inputs.length) return;
    let rows = inputs[0].rows;
    if (inputs.length > 1) {
        rows = { before: {}, after: {} };
        for (const input of inputs) mergeState(rows.after, input.rows.after);
        for (let i = inputs.length - 1; i >= 0; i--) mergeState(rows.before, inputs[i].rows.before);
    }
    const keys = new Set([...Object.keys(rows.before), ...Object.keys(rows.after)]);
    if (!keys.size && !inputs.some(input => input.replay)) return;
    const targets = new Set(pages.map(id => treeFor({ kind: "page", id })));
    for (const { source, replay } of inputs) {
        targets.add(treeFor(source));
        if (!replay) continue;
        for (const tree of replay.node.entry.nodes.keys()) targets.add(tree);
        replay.tree.cursor = replay.direction === "undo" ? replay.node.parent : replay.node;
        changed.add(replay.tree);
    }
    invalidate(keys, changed, targets);
    for (const { replay } of inputs) if (replay) targets.delete(replay.tree);
    if (!targets.size) return;
    const dependencies = new Set(inputs.map(({ page }) => "page:" + page));
    // Attribute definitions are dependencies of saved page values. A definition change
    // invalidates those values, while editing the same field on a different page does not.
    for (const side of [rows.before, rows.after]) for (const value of Object.values(side)) {
        for (const id of value?.children ?? []) dependencies.add("block:" + id);
        if (value && "values" in value) for (const id of Object.keys(value.values ?? {})) keys.add("attribute:" + id);
    }
    const entry: Entry = { ...structuredClone(rows), id: randomUUID(), page: inputs[0].page, keys: [...keys], dependencies,
        time: workspace.clock(), order: ++sequence, nodes: new Map() };
    entries.set(entry.id, entry);
    for (const key of dependencies) {
        let records = dependents.get(key);
        if (!records) dependents.set(key, records = new Set());
        records.add(entry);
    }
    for (const tree of targets) {
        attach(tree, entry);
        changed.add(tree);
    }
}
function trim(limit: number | null, changed: Set<Tree>): void {
    if (limit === null || entries.size <= limit) return;
    for (const entry of entries.values()) {
        for (const [tree, node] of entry.nodes) {
            remove(tree, node);
            changed.add(tree);
        }
        if (entries.size <= limit) break;
    }
}
export function finish(captures: Capture[], invalid: Invalidation[], pages: string[]): void {
    const changed = new Set<Tree>();
    capture(captures, pages, changed);
    for (const { keys, permanent } of invalid) {
        invalidate(keys, changed);
        if (permanent) for (const key of keys) for (const entry of dependents.get(key) ?? []) {
            for (const [tree, node] of entry.nodes) {
                remove(tree, node);
                changed.add(tree);
            }
        }
    }
    trim(settings.get().settings.history.limit, changed);
    events.historyChanged([...changed].map(tree => tree.source));
}
settings.subscribe(snapshot => {
    const changed = new Set<Tree>();
    trim(snapshot.settings.history.limit, changed);
    events.historyChanged([...changed].map(tree => tree.source));
});