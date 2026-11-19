import type { HistorySource } from "../../shared/history/ipc";
import { type ChangePreview, type CommitResult, type KnowledgeChange } from "../../shared/types/content";
import { withFileCleanup } from "../storage/files";
import * as workspace from "../workspace-state";
import { fingerprint } from "./attributes";
import { EditChanges } from "./changes";
import * as events from "./events";
import * as history from "./history-state";
import * as data from "./records";
import * as retention from "./retention";
import * as timers from "./timer-state";

export type Options = {
    sourceTab: string;
    history?: HistorySource | false;
    replay?: history.Replay;
    updateModified?: boolean;
    confirmation?: string;
    feed?: boolean;
    cleanup?: boolean;
};
export type Context = {
    change(change: Partial<KnowledgeChange>): void;
    after(action: () => void): void;
    invalidate(keys: string[], permanent?: boolean): void;
    persist(plan: EditChanges, pageId?: string): void;
    cleanup(): string[];
    skip(): void;
};
let effects: (() => void)[] = [];
const contexts: { options: Options; context: Context; captures: history.Capture[]; invalid: history.Invalidation[]; feed: boolean }[] = [];
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
        const changed: KnowledgeChange = { sourceTab: options.sourceTab, pages: [], blocks: [] };
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
            persist(plan, pageId) {
                if (options.updateModified === false) plan.touches.clear();
                plan.persist();
                for (const change of plan.timerChanges()) timers.recalculate(change.pageId, change.fields);
                if (options.history && pageId) captures.push({ source: options.history, page: pageId, rows: plan.rows, replay: options.replay });
                context.change(plan.changed());
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
        const scope = { options, context, captures, invalid, feed: !!options.feed };
        contexts.push(scope);
        try {
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
                    const change = events.expand(changed);
                    history.finish(captures, invalid, change.summaryPages ?? change.pages);
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
        result = options.cleanup ? withFileCleanup(session.db, session.info.path, collect => {
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
export function preview(plan: EditChanges, action: unknown, deletedBlocks: ChangePreview["deletedBlocks"] = [], manual: string[] = [], positions?: unknown): ChangePreview | null {
    workspace.requireWorkspace();
    const ids = retention.lostPages(plan);
    if (!ids.length && !deletedBlocks.length && !manual.length) return null;
    const name = (id: string): { id: string; title: string } => ({ id, title: data.title(id) });
    return {
        token: fingerprint({ action, ids, ...(positions ? { positions, deletedBlocks } : {}) }), recycled: ids.map(name),
        direct: [...new Set([...manual, ...ids.filter(id => plan.direct.has(id))])].map(name), causes: [...plan.causes], deletedBlocks
    };
}
export function recycle(plan: EditChanges, ids: string[]): void {
    workspace.requireWorkspace();
    for (const id of ids) {
        plan.attributes(id, { deleted: true, recycle_reason: "unreachable", recycled_at: workspace.seconds() }, [], true);
        plan.touches.add(id);
    }
}
export function finish(plan: EditChanges, pageId: string, batch: number, preview: ChangePreview | null): CommitResult {
    workspace.requireWorkspace();
    const { options, context } = contexts[contexts.length - 1];
    if (preview && options.confirmation !== preview.token) return { status: "confirmation", preview };
    recycle(plan, preview?.recycled.map(page => page.id) ?? []);
    context.persist(plan, pageId);
    const changed = plan.changed();
    return { status: "saved", batch, changed, sharedUses: data.sharedUses(changed.blocks) };
}