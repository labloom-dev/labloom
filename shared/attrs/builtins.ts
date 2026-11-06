export const builtinAttrs = {
    deleted: { type: "boolean", metadata: {} }
} as const;

export type BuiltinAttrId = keyof typeof builtinAttrs;

type ValuesByType = {
    boolean: boolean;
};

export type BuiltinAttrValues = {
    [Id in BuiltinAttrId]: ValuesByType[typeof builtinAttrs[Id]["type"]] | null;
};

export const builtinAttrsByPageKind = {
    editable: ["deleted"],
    paper: ["deleted"]
} as const satisfies Record<string, readonly BuiltinAttrId[]>;