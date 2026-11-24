import type { HistorySource } from "../../shared/history/ipc";
import { type Changed, type ChangePreview, type CommitResult, type KnowledgeChange } from "../../shared/types/content";
import * as attachments from "../attachments/service";
import * as workspace from "../workspace-state";
import { fingerprint } from "./attributes";
import { type EditChanges, type RowChanges } from "./changes";
import * as events from "./events";
import * as history from "./history-state";
import * as data from "./records";
import * as retention from "./retention";
import * as timers from "./timer-state";

export type Options = {
    writeId?: string;
    // The writer checks editability of its direct target while planning the write.
    directPage?: string;
    history?: HistorySource | false;
    replay?: history.Replay;
    restoring?: boolean;
    updateModified?: boolean;
    confirmation?: string;
    feed?: boolean;
    cleanup?: boolean;
};
export type Context = {
    change(change: Partial<KnowledgeChange>): void;
    after(action: () => void): void;
    invalidate(keys: string[], permanent?: boolean): void;
    persist(plan: EditChanges, pageId?: string, rows?: RowChanges, check?: (projected?: Projection) => void): Changed;
    cleanup(): string[];
    skip(): void;
};
type Projection = ReturnType<typeof retention.project>;
type Review = { action: unknown; deletedBlocks?: ChangePreview["deletedBlocks"]; positions?: unknown };
class ConfirmationRollback extends Error {
    constructor(readonly preview: ChangePreview) {
        super("confirmation required");
    }
}
let effects: (() => void)[] = [];
type Scope = {
    options: Options; context: Context; captures: history.Capture[]; invalid: history.Invalidation[]; feed: boolean;
};
const contexts: Scope[] = [];
export function release(): void {
    effects = [];
    contexts.length = 0;
}
function current(): Context {
    workspace.requireWorkspace();
    // Internal assertion: mutation helpers are only used inside the common write boundary.
    if (!contexts.length) throw new Error("A write requires a commit context");
    return contexts[contexts.length - 1].context;
}
export function invalidate(keys: string[]): void {
    current().invalidate(keys);
}
export function run<T>(options: Options, action: (context: Context) => T): T {
    const session = workspace.requireWorkspace(), start = effects.length;
    let cleanup: (() => string[]) | undefined;
    const write = (): T => session.database.transaction(() => {
        const changed: KnowledgeChange = { pages: [], blocks: [] };
        const captures: history.Capture[] = [], invalid: history.Invalidation[] = [];
        let publish = true;
        const context: Context = {
            change(change) {
                for (const [key, value] of Object.entries(change)) {
                    if (Array.isArray(value)) (changed as unknown as Record<string, unknown>)[key] = [...new Set([...((changed as unknown as Record<string, unknown>)[key] as unknown[] ?? []), ...value])];
                    else (changed as unknown as Record<string, unknown>)[key] = value;
                }
            },
            after(action) {
                effects.push(action);
            },
            invalidate(keys, permanent = false) {
                invalid.push({ keys, permanent });
            },
            persist(plan, pageId, rows = plan.rows, check) {
                if (options.updateModified === false) plan.touches.clear();
                plan.persist();
                const projected = plan.seeds.size ? retention.project([...plan.seeds.values()]) : undefined;
                check?.(projected);
                const result = plan.changed(), schedules = new Map(plan.timerChanges().map(change => [change.pageId, change.fields]));
                if (projected) {
                    const status = retention.apply(projected);
                    result.pages = [...new Set([...result.pages, ...status.pages])];
                    if (status.backlinks.length) result.backlinks = [...new Set([...(result.backlinks ?? []), ...status.backlinks])];
                    for (const id of status.timers) schedules.set(id, [...(schedules.get(id) ?? []), "deleted"]);
                    if (status.pages.length) context.change({ recycledPages: status.pages });
                    if (status.restored.length && status.timers.length) context.after(() => {
                        if (data.statement(`SELECT 1 FROM timers WHERE attr_id='feed_refresh' AND due_at<=?
                            AND page_id IN (SELECT value FROM json_each(?)) LIMIT 1`).get(workspace.seconds(), JSON.stringify(status.restored))) events.feedDue();
                    });
                }
                for (const [id, fields] of schedules) if (timers.recalculate(id, fields)) context.change({ notices: true });
                if (plan.removesNotice) context.change({ notices: true });
                if (options.history && pageId) captures.push({ source: options.history, page: pageId, rows, dependencies: plan.dependencies, replay: options.replay });
                context.change(result);
                return result;
            },
            cleanup() {
                // Internal assertion: only irreversible cleanup commits request filesystem collection.
                if (!cleanup) throw new Error("This commit did not request cleanup");
                return cleanup();
            },
            skip() {
                publish = false;
            }
        };
        const scope: Scope = { options, context, captures, invalid, feed: !!options.feed };
        contexts.push(scope);
        try {
            if (options.history && options.history.kind === "page" && options.history.id !== options.directPage && !options.replay && !options.restoring)
                data.writable(options.history.id);
            const result = action(context);
            if (result && typeof result === "object" && "status" in result && result.status === "confirmation") publish = false;
            if (publish) {
                const parent = contexts[contexts.length - 2];
                if (parent) {
                    parent.context.change(changed);
                    parent.captures.push(...captures);
                    parent.invalid.push(...invalid);
                    parent.feed ||= scope.feed;
                }
                else effects.push(() => {
                    if (options.writeId !== undefined) changed.writeId = options.writeId;
                    const change = events.expand(changed);
                    const pages = change.summaryPages ?? change.pages;
                    history.finish(captures, invalid, change.highlightPages?.length ? [...new Set([...pages, ...change.highlightPages])] : pages);
                    events.publish(change, scope.feed);
                });
            }
            return result;
        }
        finally {
            contexts.pop();
        }
    })();
    let result: T;
    try {
        result = options.cleanup ? attachments.withFileCleanup(session.db, session.info.path, collect => {
            cleanup = () => collect(retention.orphanBlocks()); return write();
        }) : write();
    }
    catch (error) {
        effects.splice(start);
        throw error;
    }
    if (!session.database.inTransaction) for (const effect of effects.splice(0)) {
        if (workspace.isCurrent(session)) effect();
    }
    return result;
}
export function forecast(plan: EditChanges, inspect: string[] = []): ReturnType<typeof retention.project> {
    if (!plan.seeds.size) return retention.project([]);
    // Use the same indexed graph as the real commit. Roll back the proposed rows
    // before returning a confirmation and before any notifications or timers run.
    const rollback = {};
    let projection: ReturnType<typeof retention.project>;
    try {
        workspace.native().transaction(() => {
            plan.persist(true);
            projection = retention.project([...plan.seeds.values()], inspect);
            throw rollback;
        })();
    }
    catch (error) {
        if (error !== rollback) throw error;
    }
    return projection!;
}

function changePreview(plan: EditChanges, { action, deletedBlocks = [], positions }: Review, projection?: Projection): ChangePreview | null {
    const ids = projection?.changes.filter(row => !row.deleted && row.reason !== null).map(row => row.id) ?? [];
    if (!ids.length && !deletedBlocks.length) return null;
    const name = (id: string): { id: string; title: string } => ({ id, title: data.title(id, "") });
    return {
        token: fingerprint({ action, ids, ...(positions ? { positions, deletedBlocks } : {}) }), recycled: ids.map(name),
        direct: ids.filter(id => plan.direct.has(id)).map(name), causes: [...plan.causes], deletedBlocks
    };
}
export function finish(plan: EditChanges, pageId: string, batch: number, review?: Review): Extract<CommitResult, { status: "saved" }> {
    const context = current();
    const changed = context.persist(plan, pageId, undefined, review && (projected => {
        const preview = changePreview(plan, review, projected);
        if (preview && contexts.at(-1)?.options.confirmation !== preview.token) throw new ConfirmationRollback(preview);
    }));
    return { status: "saved", batch, changed, sharedUses: data.sharedUses(changed.blocks) };
}

/** A preview result has to escape the transaction before it can be returned. */
export function edit(options: Options, action: () => CommitResult): CommitResult {
    try {
        return run(options, action);
    }
    catch (error) {
        if (error instanceof ConfirmationRollback) return { status: "confirmation", preview: error.preview };
        throw error;
    }
}