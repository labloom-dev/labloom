import { randomUUID } from "node:crypto";
import { LabloomError } from "../../shared/failure";
import type { HistorySource } from "../../shared/history/ipc";
import type { HistoryState } from "../../shared/types/knowledge";
import * as settings from "../settings/store";
import * as workspace from "../workspace-state";
import type { RowChanges, StoredState } from "./changes";
import * as events from "./events";

type Entry = RowChanges & { id: string; page: string; keys: string[]; dependencies: Set<string>; nodes: Map<Timeline, Node> };
type Node = { entry: Entry; previous: Node | null; next: Node | null };
type Timeline = { source: HistorySource; first: Node | null; cursor: Node | null };
export type Replay = { timeline: Timeline; node: Node; direction: "undo" | "redo" };
export type Invalidation = { keys: string[]; permanent: boolean };
export type Capture = { source: HistorySource; page: string; rows: RowChanges; replay?: Replay };

const timelines = new Map<string, Timeline>();
// Map iteration follows insertion order, including after unrelated records are removed.
const entries = new Map<string, Entry>();
const objects = new Map<string, Map<Timeline, Set<Node>>>();
// A replay also needs its context page and the blocks named by stored child lists
// to exist. Editing their contents is safe, physically deleting them is not.
const dependents = new Map<string, Set<Entry>>();
const sourceKey = (source: HistorySource): string => source.kind === "page" ? "page:" + source.id : "workspace";

export function release(): void {
    timelines.clear();
    entries.clear();
    objects.clear();
    dependents.clear();
}
function timelineFor(source: HistorySource): Timeline {
    const key = sourceKey(source);
    let timeline = timelines.get(key);
    if (!timeline) {
        timeline = { source, first: null, cursor: null };
        timelines.set(key, timeline);
    }
    return timeline;
}
function next(timeline: Timeline): Node | null {
    return timeline.cursor ? timeline.cursor.next : timeline.first;
}
export function state(source: HistorySource): HistoryState {
    workspace.requireWorkspace();
    const timeline = timelines.get(sourceKey(source));
    return { canUndo: !!timeline?.cursor, canRedo: !!timeline && !!next(timeline) };
}
export function select(source: HistorySource, direction: Replay["direction"]): Replay {
    workspace.requireWorkspace();
    const timeline = timelines.get(sourceKey(source));
    const node = timeline && (direction === "undo" ? timeline.cursor : next(timeline));
    if (!timeline || !node) throw new LabloomError({ kind: "history-empty" });
    return { timeline, node, direction };
}
function attach(timeline: Timeline, entry: Entry): void {
    // Only this timeline gives up its redo references. Other owners keep theirs.
    let redo = next(timeline);
    while (redo) {
        const following = redo.next;
        remove(timeline, redo);
        redo = following;
    }
    const node: Node = { entry, previous: timeline.cursor, next: null };
    if (timeline.cursor) timeline.cursor.next = node;
    else timeline.first = node;
    timeline.cursor = node;
    timelines.set(sourceKey(timeline.source), timeline);
    entry.nodes.set(timeline, node);
    for (const key of entry.keys) {
        let holders = objects.get(key);
        if (!holders) objects.set(key, holders = new Map());
        let nodes = holders.get(timeline);
        if (!nodes) holders.set(timeline, nodes = new Set());
        nodes.add(node);
    }
}
function remove(timeline: Timeline, node: Node): void {
    if (node.previous) node.previous.next = node.next;
    else timeline.first = node.next;
    if (node.next) node.next.previous = node.previous;
    if (timeline.cursor === node) timeline.cursor = node.previous;
    const entry = node.entry;
    entry.nodes.delete(timeline);
    if (!entry.nodes.size) {
        entries.delete(entry.id);
        for (const key of entry.dependencies) {
            const records = dependents.get(key)!;
            records.delete(entry);
            if (!records.size) dependents.delete(key);
        }
    }
    for (const key of entry.keys) {
        const holders = objects.get(key)!, nodes = holders.get(timeline)!;
        nodes.delete(node);
        if (!nodes.size) holders.delete(timeline);
        if (!holders.size) objects.delete(key);
    }
    if (!timeline.first) timelines.delete(sourceKey(timeline.source));
}
function invalidate(keys: Iterable<string>, changed: Set<Timeline>, except?: Set<Timeline>): void {
    for (const key of keys) for (const [timeline, nodes] of objects.get(key) ?? []) {
        if (except?.has(timeline)) continue;
        changed.add(timeline);
        for (const node of nodes) remove(timeline, node);
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
function capture(inputs: Capture[], pages: string[], changed: Set<Timeline>): void {
    if (!inputs.length) return;
    let rows = inputs[0].rows;
    if (inputs.length > 1) {
        rows = { before: {}, after: {} };
        for (const input of inputs) mergeState(rows.after, input.rows.after);
        for (let i = inputs.length - 1; i >= 0; i--) mergeState(rows.before, inputs[i].rows.before);
    }
    const keys = new Set([...Object.keys(rows.before), ...Object.keys(rows.after)]);
    if (!keys.size && !inputs.some(input => input.replay)) return;
    const targets = new Set(pages.map(id => timelineFor({ kind: "page", id })));
    for (const { source, replay } of inputs) {
        targets.add(timelineFor(source));
        if (!replay) continue;
        for (const timeline of replay.node.entry.nodes.keys()) targets.add(timeline);
        replay.timeline.cursor = replay.direction === "undo" ? replay.node.previous : replay.node;
        changed.add(replay.timeline);
    }
    invalidate(keys, changed, targets);
    for (const { replay } of inputs) if (replay) targets.delete(replay.timeline);
    if (!targets.size) return;
    const dependencies = new Set(inputs.map(({ page }) => "page:" + page));
    // Attribute definitions are dependencies of saved page values. A definition change
    // invalidates those values, while editing the same field on a different page does not.
    for (const side of [rows.before, rows.after]) for (const value of Object.values(side)) {
        for (const id of value?.children ?? []) dependencies.add("block:" + id);
        if (value && "values" in value) for (const id of Object.keys(value.values ?? {})) keys.add("attribute:" + id);
    }
    const entry: Entry = { ...structuredClone(rows), id: randomUUID(), page: inputs[0].page, keys: [...keys], dependencies,
        nodes: new Map() };
    entries.set(entry.id, entry);
    for (const key of dependencies) {
        let records = dependents.get(key);
        if (!records) dependents.set(key, records = new Set());
        records.add(entry);
    }
    for (const timeline of targets) {
        attach(timeline, entry);
        changed.add(timeline);
    }
}
function trim(limit: number | null, changed: Set<Timeline>): void {
    if (limit === null || entries.size <= limit) return;
    for (const entry of entries.values()) {
        for (const [timeline, node] of entry.nodes) {
            remove(timeline, node);
            changed.add(timeline);
        }
        if (entries.size <= limit) break;
    }
}
export function finish(captures: Capture[], invalid: Invalidation[], pages: string[]): void {
    const changed = new Set<Timeline>();
    capture(captures, pages, changed);
    for (const { keys, permanent } of invalid) {
        invalidate(keys, changed);
        if (permanent) for (const key of keys) for (const entry of dependents.get(key) ?? []) {
            for (const [timeline, node] of entry.nodes) {
                remove(timeline, node);
                changed.add(timeline);
            }
        }
    }
    trim(settings.get().settings.history.limit, changed);
    events.historyChanged([...changed].map(timeline => timeline.source));
}
settings.subscribe(snapshot => {
    const changed = new Set<Timeline>();
    trim(snapshot.settings.history.limit, changed);
    events.historyChanged([...changed].map(timeline => timeline.source));
});