import { type AttributeValue } from "./attributes";

export const pageKinds = ["editable", "paper", "annotation", "task", "event"] as const;
export type PageKind = typeof pageKinds[number];
export const blockKinds = ["title", "paragraph", "heading_1", "heading_2", "heading_3", "unordered_list", "ordered_list", "blockquote", "callout", "code", "table", "hr", "blocked_reference", "source"] as const;
export type ContentBlockKind = typeof blockKinds[number];
export type Target = { kind: "page" | "block"; id: string };
export type InlineNode = { type: "text"; text: string; marks?: { type: string; attrs?: Record<string, AttributeValue> }[] }
    | { type: "hardBreak" }
    | { type: "inlineReference"; attrs: { target: Target; label: string } };
export type RichNode = { type: string; text?: string; attrs?: Record<string, AttributeValue>; marks?: { type: string; attrs?: Record<string, AttributeValue> }[]; content?: RichNode[] };
export type BlockPayload = {
    schemaVersion: 1;
    type: ContentBlockKind;
    inline: InlineNode[];
    collapsed?: boolean;
    target?: Target | null;
    table?: RichNode;
    source?: { fileId: string; anchorId: string; quote: string };
};
export type ContentBlock = { id: string; type: ContentBlockKind; payload: BlockPayload; children: string[] };
export type PageSummary = {
    id: string;
    kind: PageKind;
    title: string;
    excerpt: string;
    attributes: Record<string, AttributeValue>;
};
export type PageRecord = PageSummary & {
    titleBlockId: string;
    children: string[];
    blocks: Record<string, ContentBlock>;
    version: string;
    blockVersions: Record<string, string>;
};
export type PageQuery = { keyword?: string; kind?: PageKind | ""; deleted?: boolean; pinned?: boolean; tags?: string[]; attributes?: Record<string, AttributeValue>; sort?: "modified" | "created" | "title"; offset?: number; limit?: number };
export type PageList = { items: PageSummary[]; total: number };
export type EditPage = {
    pageId: string;
    tabId: string;
    version: string;
    children?: string[];
    attributes?: Record<string, AttributeValue>;
    detach?: string[];
    blocks?: { value: ContentBlock; version: string | null }[];
};
export type BlockPosition = { pageId: string; kind: "page" | "block"; containerId: string; index: number; children: string[] };
export type Mutation =
    | { type: "edit"; edit: EditPage }
    | { type: "trash" | "restore"; ids: string[]; tabId: string }
    | { type: "place"; position: BlockPosition; action: "insert" | "remove" | "clone" | "duplicate" | "move-up" | "move-down"; blockId?: string; tabId: string }
    | { type: "delete-block"; pageId: string; blockId: string; version: string; tabId: string };
export type ChangePreview = { token: string; recycled: { id: string; title: string }[]; removed: { id: string; title: string }[] };
export type CommitResult = { status: "saved"; pages: string[] } | { status: "confirmation"; preview: ChangePreview };
export type Backlink = { sourceId: string; title: string; sourceKind: "reference" | "attribute"; deleted: boolean };