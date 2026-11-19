import { attributeTargets, decodeValue } from "../../shared/attrs/values";
import { references } from "../../shared/content/blocks";
import type { AttributeDefinition, AttributeValue } from "../../shared/types/attributes";
import { type FeedSourceInput } from "../../shared/types/feed";
import { type HistorySource } from "../../shared/history/ipc";
import { type AnnotationInput } from "../../shared/types/papers";
import { pageHistory } from "./history";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import * as session from "../../main/session";
import * as state from "../../main/workspace-state";
import * as scheduler from "../../main/knowledge/scheduler";
import * as records from "../../main/knowledge/records";
import * as edits from "../../main/knowledge/edits";
import * as attributes from "../../main/knowledge/attributes";
import * as history from "../../main/knowledge/history";
import * as papers from "../../main/knowledge/papers";
import * as purge from "../../main/knowledge/purge";
import * as timers from "../../main/knowledge/timers";
import * as commit from "../../main/knowledge/commit";
import * as feed from "../../main/feed/service";
import * as events from "../../main/knowledge/events";
import * as startup from "../../main/startup/startup";
import { type FeedLoader } from "../../main/feed/service";
import { type SessionOptions } from "../../main/session";
import { type TestContext } from "node:test";
import { type Notice } from "../../shared/types/knowledge";
export { type OpenWorkspace } from "../../main/storage/workspace";
export { session, events };
let options: SessionOptions = {};
export function createWorkspace(path: string, input: SessionOptions = {}): ReturnType<typeof session.open> {
    options = input;
    return session.open(path, "create", options);
}
export function openWorkspace(path: string, expectedId?: string, input?: SessionOptions): ReturnType<typeof session.open> {
    options = { ...options, ...input };
    return session.open(path, "open", options, expectedId);
}
export function openTest(t: TestContext, input: SessionOptions = {}): ReturnType<typeof session.open> {
    const root = process.env.LABLOOM_TEST_ROOT ?? join(process.cwd(), ".local");
    options = input;
    mkdirSync(root, { recursive: true });
    const workspace = session.open(mkdtempSync(join(root, "session-test-")), "create", options);
    t.after(() => session.close());
    return workspace;
}
export function attributeServices(): typeof attributes & {
    values(pageId: string): Record<string, AttributeValue>;
    write: typeof edits.writeAttributes; cache: typeof edits.cacheAttributes;
    detach(pageId: string, ids: string[]): void;
    applyDefinition: typeof attributes.persistDefinition;
} {
    return {
        values: pageId => records.get(pageId).attributes,
        ...attributes, write: edits.writeAttributes, cache: edits.cacheAttributes, detach: (pageId, ids) => {
            edits.commitEdit({ pageId, batch: 0, blocks: [], detach: ids }, pageHistory(pageId));
        },
        applyDefinition: (id, input, token) => commit.run({ history: false }, context => {
            const result = attributes.persistDefinition(id, input, token);
            if (result) context.skip();
            else context.change({ definition: id });
            return result;
        })
    };
}
function timerServices(): Omit<typeof timers, "check"> & { check: (deliver: (notice: Notice, body: string) => void, refresh?: (id: string) => Promise<void>) => Promise<void> } {
    return {
        ...timers, check: async (deliver, refresh) => {
            const unsubscribe = events.subscribe(event => {
                if (event.type === "reminder") deliver(event.notice, event.body);
            });
            try {
                for (const id of await timers.check()) if (refresh) await refresh(id);
            }
            finally {
                unsubscribe();
            }
        }
    };
}
function rebuildLinks(): void {
    commit.run({}, () => {
        records.statement("DELETE FROM link_refs").run();
        const insert = records.statement("INSERT OR IGNORE INTO link_refs(source_kind,source_id,source_field,target_kind,target_id) VALUES (?,?,?,?,?)");
        const ids = records.statement("SELECT id FROM blocks").pluck().all() as string[];
        for (const block of records.readBatch(ids)) for (const t of references(block)) insert.run("block", block.id, "payload", t.kind, t.id);
        const rows = records.statement("SELECT page_id AS pageId, attr_id AS field, value, type FROM page_attrs JOIN attrs_meta ON attrs_meta.id=attr_id WHERE type IN ('page-link','page-links','file','files') AND value IS NOT NULL").all() as { pageId: string; field: string; value: string; type: AttributeDefinition["type"] }[];
        for (const row of rows) {
            const definition = attributes.definition(row.field);
            for (const target of attributeTargets(row.type, decodeValue(definition, row.value))) insert.run("page", row.pageId, row.field, target.kind, target.id);
        }
    });
}

export function knowledgeServices(): Knowledge {
    return {
        ...records, ...edits, rebuildLinks, create: edits.createPage, attributes: attributeServices(), timers: timerServices(),
        db: session.getDatabase(), sql: session.getNative(),
        transaction: <T>(action: () => T): T => commit.run({ history: false }, action)
    };
}
export async function saveFeed(input: FeedSourceInput): Promise<string> {
    const resolution = await feed.resolveSource(input);
    return resolution ? feed.saveSource(resolution) : "";
}
type Feed = Omit<typeof feed, "saveSource" | "importItem"> & {
    saveSource: typeof saveFeed;
    importItem(id: string, replace?: boolean): string;
    knowledge: Knowledge;
    checkDue: typeof scheduler.check;
};
export function feedServices(): Feed {
    return { ...feed, saveSource: saveFeed, importItem: (id: string, replace?: boolean) => feed.importItem(id, replace).pageId,
        knowledge: knowledgeServices(), checkDue: scheduler.check };
}
export function historyServices(): typeof history {
    return history;
}
export async function annotate(pageId: string, input: AnnotationInput | string, source: HistorySource, color?: string): Promise<string> {
    if (!await papers.prepareAnnotation(pageId, input)) return "";
    return typeof input === "string" ? input : papers.annotate(pageId, input, source, color);
}
export function paperServices(): Papers {
    return { ...papers, annotate };
}
export function purgeServices(): typeof purge {
    return purge;
}
export function startupServices(root: string): typeof startup {
    startup.initialize(root);
    return startup;
}
export function watchKnowledge(listener: (change: import("../../shared/types/content").KnowledgeChange) => void): () => void {
    return events.subscribe(event => {
        if (event.type === "knowledge") listener(event.change);
    });
}
export function watchFeed(listener: () => void): () => void {
    return events.subscribe(event => {
        if (event.type === "feed") listener();
    });
}
export type Knowledge = typeof records & Omit<typeof edits, "create"> & {
    create: typeof edits.createPage;
    rebuildLinks: typeof rebuildLinks;
    attributes: ReturnType<typeof attributeServices>;
    timers: ReturnType<typeof timerServices>;
    db: ReturnType<typeof session.getDatabase>;
    sql: ReturnType<typeof session.getNative>;
    transaction: <T>(action: () => T) => T;
};
export type Attributes = ReturnType<typeof attributeServices>;
export type History = typeof history;
export type Papers = Omit<typeof papers, "annotate"> & { annotate: typeof annotate };
export type Purge = typeof purge;