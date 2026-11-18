import { LabloomError } from "../../shared/failure";
import { eq, placeholder } from "drizzle-orm";
import { builtinAttrs, editableBuiltinMetadata, type BuiltinAttrId } from "../../shared/attrs/builtins";
import { resolveAttributeDefinition } from "../../shared/attrs/definitions";
import { type WorkspaceDatabase } from "./database";
import { attrsMeta } from "./tables";

export function initializeBuiltinAttrs(database: WorkspaceDatabase): void {
    database.insert(attrsMeta).values(Object.entries(builtinAttrs).map(([id, definition]) => ({
        id, type: definition.type, name: null, metadata: editableBuiltinMetadata(id as BuiltinAttrId) ? definition.metadata : {}
    }))).run();
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