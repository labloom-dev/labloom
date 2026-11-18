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
    write: typeof edits.writeAttributes; cache: typeof edits.cacheAttributes;
    detach: typeof edits.detachAttributes; changePageKind: typeof edits.changePageKind;
    applyDefinition: typeof attributes.persistDefinition;
} {
    return {
        ...attributes, write: edits.writeAttributes, cache: edits.cacheAttributes, detach: edits.detachAttributes, changePageKind: edits.changePageKind,
        applyDefinition: (id, input, token) => commit.run({ sourceTab: "", history: false }, context => {
            const result = attributes.persistDefinition(id, input, token);
            if (result) context.skip();
            else context.change({ definition: id });
            return result;
        })
    };
}
export function timerServices(): Omit<typeof timers, "check"> & { check: (deliver: (notice: Notice, body: string) => void, refresh?: (id: string) => Promise<void>) => Promise<void> } {
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
export function knowledgeServices(): Knowledge {
    return {
        ...records, ...edits, create: edits.createPage, attributes: attributeServices(), timers: timerServices(),
        db: session.getDatabase(), sql: session.getNative(),
        transaction: <T>(action: () => T): T => commit.run({ sourceTab: "", history: false }, action)
    };
}
export function feedServices(): typeof feed & { knowledge: Knowledge; checkDue: typeof scheduler.check } {
    return { ...feed, knowledge: knowledgeServices(), checkDue: scheduler.check };
}
export function historyServices(): typeof history {
    return history;
}
export function paperServices(): typeof papers {
    return papers;
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
export type Knowledge = typeof records & typeof edits & {
    attributes: ReturnType<typeof attributeServices>;
    timers: ReturnType<typeof timerServices>;
    db: ReturnType<typeof session.getDatabase>;
    sql: ReturnType<typeof session.getNative>;
    transaction: <T>(action: () => T) => T;
};
export type Attributes = ReturnType<typeof attributeServices>;
export type History = typeof history;
export type Papers = typeof papers;
export type Purge = typeof purge;