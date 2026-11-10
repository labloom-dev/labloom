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
    source?: { anchorId: string };
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
    sharedUses?: Record<string, number>;
    children: string[];
    blocks: Record<string, ContentBlock>;
};
export type PageObjects = {
    page?: Pick<PageRecord, "attributes" | "children">;
    blocks: ContentBlock[];
    uses: Record<string, number>;
};
export type PageQuery = { ids?: string[]; keyword?: string; kind?: PageKind | ""; deleted?: boolean; pinned?: boolean; tags?: string[]; attributes?: Record<string, AttributeValue>; sort?: "modified" | "created" | "title"; offset?: number; limit?: number };
export type PageList = { items: PageSummary[]; total: number };
export type EditCommit = {
    pageId: string; tabId: string; batch: number;
    blocks: ContentBlock[]; pageChildren?: string[]; attributes?: Record<string, AttributeValue>; detach?: string[];
};
export type Position = { pageId: string; containerId: string; index: number; blockId: string };
export type Placement = { position: Position; action: "insert" | "remove" | "clone" | "duplicate" | "move-up" | "move-down"; blockId?: string; tabId: string };
export type BlockDeletion = { pageId: string; tabId: string; blockId: string };
export type Changed = { pages: string[]; blocks: string[]; backlinks?: string[]; highlightPages?: string[] };
export type KnowledgeChange = Changed & { sourceTab: string; kinds?: Record<string, PageKind>; summaryPages?: string[]; definition?: string; notices?: boolean };
export type NamedPage = { id: string; title: string };
export type ChangePreview = {
    token: string; recycled: NamedPage[]; direct: NamedPage[];
    deletedBlocks: { id: string; excerpt: string; pages: number; positions: number; links: number }[];
    causes: string[];
};
export type CommitResult = { status: "saved"; batch: number; changed: Changed; sharedUses?: Record<string, number> } | { status: "confirmation"; preview: ChangePreview };
export type ResolvedTarget = { title: string; text: string; status: "ok" | "recycled" | "deleted"; block?: ContentBlock };
export type Backlink = { sourceId: string; title: string; sourceKind: "reference" | "attribute"; deleted: boolean };