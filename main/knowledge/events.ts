import type { HistorySource } from "../../shared/history/ipc";
import { type KnowledgeChange, type PageKind } from "../../shared/types/content";
import { type Notice } from "../../shared/types/knowledge";
import * as workspace from "../workspace-state";
import * as data from "./records";

export type Event =
    | { type: "history"; sources: HistorySource[] }
    | { type: "knowledge"; change: KnowledgeChange }
    | { type: "feed" }
    | { type: "feed-due" }
    | { type: "reminder"; notice: Notice; body: string };
const listeners = new Set<(event: Event) => void>();

export function subscribe(listener: (event: Event) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
function emit(event: Event): void {
    for (const listener of listeners) listener(event);
}
/** Every writer uses the same owner expansion and page-kind calculation. */
export function expand(input: KnowledgeChange): KnowledgeChange {
    workspace.requireWorkspace();
    const change = { ...input };
    if (change.blocks.length) {
        const owners = data.statement(`WITH RECURSIVE owners(kind,id) AS (
            SELECT container_kind,container_id FROM sync_refs WHERE block_id IN (SELECT value FROM json_each(?))
            UNION SELECT u.container_kind,u.container_id FROM owners o JOIN sync_refs u ON o.kind='block' AND u.block_id=o.id
        ) SELECT id FROM owners WHERE kind='page'`).pluck().all(JSON.stringify(change.blocks)) as string[];
        change.summaryPages = [...new Set([...change.pages, ...owners])];
    }
    const pages = change.summaryPages ?? change.pages;
    if (pages.length) {
        const rows = data.statement("SELECT id,kind,title_block_id AS titleId FROM pages WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify(pages)) as { id: string; kind: PageKind; titleId: string }[];
        if (change.blocks.length) {
            const blocks = new Set(change.blocks);
            const titles = rows.filter(row => blocks.has(row.titleId)).map(row => row.id);
            if (titles.length) change.titlePages = titles;
        }
        change.kinds = Object.fromEntries(rows.map(row => [row.id, row.kind]));
        const highlights = new Set(change.highlightPages);
        for (const id of change.recycledPages ?? []) if (change.kinds[id] === "paper") highlights.add(id);
        const annotations = rows.filter(row => row.kind === "annotation").map(row => row.id);
        if (annotations.length) {
            const papers = data.statement(`SELECT DISTINCT l.source_id
                FROM json_each(?) j CROSS JOIN link_refs l ON l.target_kind='page' AND l.target_id=j.value
                WHERE l.source_kind='page' AND l.source_field='paper_annotations'`).pluck().all(JSON.stringify(annotations)) as string[];
            for (const id of papers) highlights.add(id);
        }
        if (highlights.size) change.highlightPages = [...highlights];
    }
    return change;
}
export function historyChanged(sources: HistorySource[]): void {
    if (sources.length) emit({ type: "history", sources });
}
export function publish(change: KnowledgeChange, feed: boolean): void {
    emit({ type: "knowledge", change });
    if (feed || Object.values(change.kinds ?? {}).includes("feed") || change.purged?.length) emit({ type: "feed" });
}
export function feedChanged(): void {
    workspace.requireWorkspace();
    emit({ type: "feed" });
}
export function feedDue(): void {
    emit({ type: "feed-due" });
}
export function reminder(notice: Notice, body: string): void {
    workspace.requireWorkspace();
    emit({ type: "reminder", notice, body });
}