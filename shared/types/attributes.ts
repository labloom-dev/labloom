export const attributeTypes = ["string", "number", "boolean", "minute", "hour", "day", "month", "year", "select", "multiselect", "url", "page-link", "page-links", "file", "files", "recurrence", "json"] as const;
export type AttributeType = typeof attributeTypes[number];
export type AttributeValue = string | number | boolean | null | AttributeValue[] | { [key: string]: AttributeValue };
export type AttributeOption = { id: string; name: string };
export type AttributeMetadata = {
    options?: AttributeOption[];
};
export type AttributeDefinition = { id: string; type: AttributeType; name: string; metadata: AttributeMetadata; hidden?: boolean; readonly?: boolean };
export type AttributeImpact = { token: string; pages: { id: string; title: string }[]; recycled?: { id: string; title: string }[] };

export type AttributeFormat = (definition: AttributeDefinition, value: AttributeValue, context: { zone?: string; fileName?: (id: string) => string | undefined }) => string;