import { type HistorySource } from "../../shared/history/ipc";
import { decodeValue } from "../../shared/attrs/values";
import { LabloomError } from "../../shared/failure";
import { type AttributeValue } from "../../shared/types/attributes";
import { type CommitResult } from "../../shared/types/content";
import * as attributes from "./attributes";
import { EditChanges, type PagePatch } from "./changes";
import * as commit from "./commit";
import { restorePages } from "./edits";
import * as history from "./history-state";
import * as data from "./records";

export { state } from "./history-state";

export function apply(source: HistorySource, direction: "undo" | "redo", writeId?: string): Extract<CommitResult, { status: "saved" }> {
    const replay = history.select(source, direction), node = replay.node.entry;
    return commit.run({ writeId, history: source, replay }, () => {
        const desired = direction === "undo" ? node.before : node.after;
        const restoring = new Set<string>();
        if (direction === "undo") for (const [key, value] of Object.entries(desired)) {
            if (key.startsWith("page:") && (value as PagePatch | null)?.manualDeleted === false
                && (node.after[key] as PagePatch | null)?.manualDeleted === true) restoring.add(key.slice(5));
        }
        const pageId = source.kind === "page" ? source.id : node.page;
        const recycledPages = new Set<string>(), recycledBlocks: string[] = [];
        function watchPage(id: string): void {
            data.header(id);
            if (data.flags(id).deleted) recycledPages.add(id);
        }
        watchPage(pageId);
        const plan = new EditChanges();
        for (const [key, value] of Object.entries(desired)) {
            if (!key.startsWith("block:")) continue;
            const id = key.slice(6);
            const owners = data.owners(id);
            if (owners.length && owners.every(owner => data.flags(owner).deleted)) recycledBlocks.push(id);
            if (value && "content" in value) plan.putBlock(data.decodeBlock(value), value);
            plan.blocks.add(id);
        }
        for (const [key, value] of Object.entries(desired)) {
            if (!key.startsWith("page:") || !value || "content" in value) continue;
            const id = key.slice(5), patch = value as PagePatch;
            watchPage(id);
            if (patch.manualDeleted !== undefined && !restoring.has(id)) plan.markManual(id, patch.manualDeleted);
            if (patch.children) plan.pageChildren(id, patch.children);
            const values: Record<string, AttributeValue> = {}, detach: string[] = [];
            for (const [field, row] of Object.entries(patch.values ?? {})) {
                if (row) values[field] = decodeValue(attributes.definition(field), row.value);
                else detach.push(field);
            }
            plan.attributes(id, values, detach, true);
            plan.pages.add(id);
        }
        restorePages(plan, [...restoring]);
        plan.pages.add(pageId);
        if (!recycledPages.has(pageId)) plan.touches.add(pageId);
        plan.verifyContainment();
        const result = commit.finish(plan, pageId, 0);
        // A replay may put a live page in the bin. A page that was already
        // recycled must leave the bin in the same transaction to be writable.
        if ([...recycledPages].some(id => data.flags(id).deleted) || recycledBlocks.some(id => {
            const owners = data.owners(id);
            return owners.length && owners.every(owner => data.flags(owner).deleted);
        })) throw new LabloomError({ kind: "page-recycled-readonly" });
        return result;
    });
}