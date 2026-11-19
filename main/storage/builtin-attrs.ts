import type { AttributeDefinition } from "../../shared/types/attributes";
import { LabloomError } from "../../shared/failure";
import { eq, placeholder } from "drizzle-orm";
import { builtinAttrs, editableBuiltinMetadata, type BuiltinAttrId } from "../../shared/attrs/builtins";
import { resolveAttributeDefinition } from "../../shared/attrs/definitions";
import { type WorkspaceDatabase } from "./database";
import { attrsMeta } from "./tables";

const starterAttrs = {
    task_status: { type: "status", name: "状态", metadata: { options: [{ id: "todo", name: "未开始", group: "incomplete" }, { id: "doing", name: "进行中", group: "incomplete" }, { id: "done", name: "已完成", group: "complete" }] } },
    priority: { type: "select", name: "优先级", metadata: { options: [{ id: "low", name: "低" }, { id: "normal", name: "普通" }, { id: "high", name: "高" }] } },
    schedule_date: { type: "day", name: "日期", metadata: {} },
    schedule_start: { type: "minute", name: "开始时间", metadata: {} },
    schedule_end: { type: "minute", name: "结束时间", metadata: {} }
} satisfies Record<string, Omit<AttributeDefinition, "id">>;

export function initializeWorkspaceAttrs(database: WorkspaceDatabase): void {
    database.insert(attrsMeta).values(Object.entries(builtinAttrs).map(([id, definition]) => ({
        id, type: definition.type, name: null, metadata: editableBuiltinMetadata(id as BuiltinAttrId) ? definition.metadata : {}
    }))).run();
    database.insert(attrsMeta).values(Object.entries(starterAttrs).map(([id, definition]) => ({ id, ...definition }))).run();
}

export function validateBuiltinAttrs(database: WorkspaceDatabase): void {
    const select = database.select().from(attrsMeta).where(eq(attrsMeta.id, placeholder("id"))).prepare();
    for (const [id, definition] of Object.entries(builtinAttrs)) {
        const row = select.get({ id });
        if (row?.type !== definition.type) {
            throw new LabloomError({ kind: "attribute-builtin-missing", attrId: id });
        }
        resolveAttributeDefinition(row);
    }
}