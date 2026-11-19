import type { HistorySource } from "../../shared/history/ipc";
import { decodeValue } from "../../shared/attrs/values";
import { type AttributeValue } from "../../shared/types/attributes";
import { type CommitResult } from "../../shared/types/content";
import * as attributes from "./attributes";
import { EditChanges, type PagePatch } from "./changes";
import * as commit from "./commit";
import * as history from "./history-state";
import { decodeBlock } from "./records";
import * as retention from "./retention";
export { state } from "./history-state";
export function apply(source: HistorySource, direction: "undo" | "redo", confirmation?: string, writeId?: string): CommitResult {
    const replay = history.select(source, direction), node = replay.node.entry;
    return commit.run({ writeId, history: source, replay, confirmation }, () => {
        const desired = direction === "undo" ? node.before : node.after;
        const plan = new EditChanges();
        for (const [key, value] of Object.entries(desired)) {
            if (!key.startsWith("block:")) continue;
            const id = key.slice(6);
            if (value && "content" in value) plan.putBlock(decodeBlock(value), value);
            plan.blocks.add(id);
        }
        const created: string[] = [];
        for (const [key, value] of Object.entries(desired)) {
            if (!key.startsWith("page:") || !value || "content" in value) continue;
            const id = key.slice(5), patch = value as PagePatch;
            if (patch.creation) created.push(id);
            if (patch.children) plan.pageChildren(id, patch.children);
            const values: Record<string, AttributeValue> = {}, detach: string[] = [];
            for (const [field, row] of Object.entries(patch.values ?? {})) {
                if (patch.creation && field === "deleted") continue;
                if (row) values[field] = decodeValue(attributes.definition(field), row.value);
                else detach.push(field);
            }
            plan.attributes(id, values, detach, true);
            plan.pages.add(id);
        }
        for (const id of created) if (!retention.reachable(plan, { kind: "page", id }, new Set())) plan.attributes(id, { deleted: true, recycle_reason: "unreachable", recycled_at: Math.floor(Date.now() / 1000) }, [], true);
        plan.pages.add(node.page);
        plan.touches.add(node.page);
        plan.verifyContainment();
        return commit.finish(plan, node.page, 0, commit.preview(plan, { direction, source, node: node.id }));
    });
}