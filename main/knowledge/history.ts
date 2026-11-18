import * as workspace from "../workspace-state";
import { decodeValue } from "../../shared/attrs/values";
import { LabloomError } from "../../shared/failure";
import { type AttributeValue } from "../../shared/types/attributes";
import { type CommitResult } from "../../shared/types/content";
import * as attributes from "./attributes";
import { EditChanges, type PagePatch } from "./changes";
import * as commit from "./commit";
import * as history from "./history-state";
import { decodeBlock } from "./records";
import * as retention from "./retention";
export { clear, close, state } from "./history-state";
export function apply(tabId: string, direction: "undo" | "redo", branchId?: string, confirmation?: string): CommitResult {
    workspace.requireWorkspace();
    return commit.run({ sourceTab: tabId, history: false, confirmation }, context => {
        const tab = history.tab(tabId);
        if (!tab || !["undo", "redo"].includes(direction)) throw new LabloomError({ kind: "history-empty" });
        const id = direction === "undo" ? tab.cursor : history.state(tabId).redo.find(node => !branchId || node.id === branchId)?.id;
        const node = id ? history.node(id) : undefined;
        if (!node) throw new LabloomError({ kind: "history-branch-invalid" });
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
        const result = commit.finish(plan, node.page, 0, commit.preview(plan, { direction, tabId, node: node.id }));
        if (result.status === "saved") context.after(() => {
            history.invalidate([...new Set([...Object.keys(desired), ...Object.keys(plan.rows.after)])], tabId);
            tab.cursor = direction === "undo" ? node.parent : node.id;
        });
        return result;
    });
}