import type { AttributeDefinition, AttributeImpact } from "../types/attributes";
import type { TabId, Channels } from "../ipc/contract";

export type AttributesAPI = {
    definitions(): Promise<AttributeDefinition[]>;
    define(id: string, value: AttributeDefinition | null, tabId: TabId, token?: string): Promise<AttributeImpact | null>;
};

export const attributesChannels = {
    definitions: "attributes:definitions",
    define: "attributes:define"
} as const satisfies Channels<AttributesAPI>;