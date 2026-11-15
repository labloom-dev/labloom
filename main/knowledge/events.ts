import { type KnowledgeChange, type PageKind } from "../../shared/types/content";
import { type Notice } from "../../shared/types/knowledge";
import * as workspace from "../workspace-state";
import * as data from "./records";

export type Event =
    | { type: "knowledge"; change: KnowledgeChange }
    | { type: "feed" }
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
export function publish(input: KnowledgeChange, feed = false): void {
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
        const rows = data.statement("SELECT id,kind FROM pages WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify(pages)) as { id: string; kind: PageKind }[];
        change.kinds = Object.fromEntries(rows.map(row => [row.id, row.kind]));
    }
    emit({ type: "knowledge", change });
    if (feed || Object.values(change.kinds ?? {}).includes("feed") || change.purged?.length) emit({ type: "feed" });
}
export function feedChanged(): void {
    workspace.requireWorkspace();
    emit({ type: "feed" });
}
export function reminder(notice: Notice, body: string): void {
    workspace.requireWorkspace();
    emit({ type: "reminder", notice, body });
}