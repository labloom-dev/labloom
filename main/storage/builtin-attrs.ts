import { eq, placeholder } from "drizzle-orm";
import { builtinAttrs } from "../../shared/attrs/builtins";
import { type WorkspaceDatabase } from "./database";
import { attrs } from "./tables";

export function validateBuiltinAttrs(database: WorkspaceDatabase): void {
    const select = database.select({ type: attrs.type }).from(attrs).where(eq(attrs.id, placeholder("id"))).prepare();
    for (const [id, definition] of Object.entries(builtinAttrs)) {
        if (select.get({ id })?.type !== definition.type) {
            throw new Error(`The Labloom builtin attribute '${id}' is missing or has an incompatible type.`);
        }
    }
}