export const attributeTypes = ["string", "number", "boolean", "date", "datetime", "select", "multiselect", "url", "page-link", "page-links", "json"] as const;
export type AttributeType = typeof attributeTypes[number];
export type AttributeValue = string | number | boolean | null | AttributeValue[] | { [key: string]: AttributeValue };
export type AttributeOption = { id: string; name: string };
export type AttributeMetadata = {
    name?: string;
    options?: AttributeOption[];
    hidden?: boolean;
    readonly?: boolean;
    [key: string]: unknown;
};
export type AttributeDefinition = { id: string; type: AttributeType; metadata: AttributeMetadata };
export type AttributeImpact = { token: string; pages: { id: string; title: string }[]; recycled?: { id: string; title: string }[] };