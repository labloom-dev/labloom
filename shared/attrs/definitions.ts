import { LabloomError } from "../failure";
import { type AttributeDefinition, type AttributeMetadata, type AttributeType } from "../types/attributes";
import { builtinAttrs, editableBuiltinMetadata, isBuiltin } from "./builtins";
import { record, validateDefinition, validateMetadata } from "./values";

export type StoredAttributeDefinition = { id: string; type: string; name: string | null; metadata: unknown };

// All database reads resolve constants and editable metadata through this function.
export function resolveAttributeDefinition(row: StoredAttributeDefinition): AttributeDefinition {
    let definition: AttributeDefinition;
    if (isBuiltin(row.id)) {
        const base = builtinAttrs[row.id];
        if (row.type !== base.type || row.name !== null) throw new LabloomError({ kind: "attribute-builtin-storage", attrId: row.id });
        const editable = editableBuiltinMetadata(row.id);
        if (editable) validateMetadata(base.type, row.metadata);
        else if (!record(row.metadata) || Object.keys(row.metadata).length) throw new LabloomError({ kind: "attribute-builtin-metadata-storage", attrId: row.id });
        definition = { id: row.id, type: base.type, name: base.name, metadata: structuredClone(editable ? row.metadata as AttributeMetadata : base.metadata),
            ...("hidden" in base ? { hidden: base.hidden } : {}), ...("readonly" in base ? { readonly: base.readonly } : {}) };
    }
    else definition = { id: row.id, type: row.type as AttributeType, name: row.name as string, metadata: structuredClone(row.metadata) as AttributeMetadata };
    validateDefinition(definition);
    return definition;
}