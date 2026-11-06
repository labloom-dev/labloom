export type PageKind = "editable" | "paper" | "task" | "event" | "annotation";
export type TaskStatus = "todo" | "doing" | "done";
export type DocumentNode = {
    type: string;
    text?: string;
    attrs?: Record<string, unknown>;
    marks?: { type: string; attrs?: Record<string, unknown> }[];
    content?: DocumentNode[];
};
export type RichDocument = { type: "doc"; content: DocumentNode[] };
export type PaperMetadata = {
    authors: string;
    doi: string;
    year: string;
    venue: string;
    url: string;
    abstract: string;
};
export type Schedule = {
    status: TaskStatus;
    priority: "low" | "normal" | "high";
    start: string;
    end: string;
    allDay: boolean;
    reminder: string;
    timezone: string;
};
export type PageSummary = {
    id: string;
    kind: PageKind;
    title: string;
    excerpt: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    deleted: boolean;
    independent: boolean;
    pinned: boolean;
    tags: string[];
    schedule: Schedule | null;
};
export type PageRecord = PageSummary & {
    document: RichDocument;
    paper: PaperMetadata | null;
    properties: Record<string, string | number | boolean | null>;
};
export type PageQuery = {
    keyword?: string;
    kind?: PageKind | "";
    tags?: string[];
    properties?: Record<string, string | number | boolean | null>;
    deleted?: boolean;
    pinned?: boolean;
    sort?: "updated" | "created" | "title";
    offset?: number;
    limit?: number;
};
export type PageList = { items: PageSummary[]; total: number };
export type CreatePageInput = {
    title?: string;
    kind?: PageKind;
    document?: RichDocument;
    paper?: PaperMetadata;
    schedule?: Schedule;
};
export type SavePageInput = {
    id: string;
    revision: number;
    title: string;
    document: RichDocument;
    tags: string[];
    independent: boolean;
    pinned: boolean;
    properties: Record<string, string | number | boolean | null>;
    paper: PaperMetadata | null;
    schedule: Schedule | null;
};
export type LinkRecord = {
    id: string;
    sourceId: string;
    targetId: string;
    blockId: string | null;
    mode: "reference" | "sync";
    writable: boolean;
    title: string;
    deleted: boolean;
};
export type Attachment = {
    id: string;
    pageId: string;
    name: string;
    version: string;
    size: number;
    createdAt: string;
};
export type ReadingPosition = { pageNumber: number; scale: number | "auto" | "page-actual" | "page-width" | "page-fit"; rotation: 0 | 90 | 180 | 270; left: number; top: number };
export type Annotation = {
    id: string;
    pageId: string;
    attachmentId: string;
    pageNumber: number;
    quote: string;
    color: string;
    rects: { x: number; y: number; width: number; height: number }[];
};
export type AnnotationOrigin = { paperId: string; title: string; attachmentId: string; version: string; pageNumber: number };
export type PropertyDefinition = { id: string; name: string; type: "string" | "number" | "boolean" | "date" };
export type WorkspaceStats = { pages: number; papers: number; tasks: number; bytes: number; due: PageSummary[]; recent: PageSummary[]; notifications: Reminder[] };
export type Reminder = { id: string; pageId: string; title: string; time: string; read: boolean };
export type ImportResult = { pages: PageSummary[]; errors: string[]; cancelled: boolean };

export type PageChanges = { addTags?: string[]; removeTags?: string[]; properties?: PageRecord["properties"]; independent?: boolean; pinned?: boolean };

export interface KnowledgeAPI {
    getSetting: (key: "appearance" | "tabs" | "overview") => Promise<unknown>;
    setSetting: (key: "appearance" | "tabs" | "overview", value: unknown) => Promise<void>;
    list: (query: PageQuery) => Promise<PageList>;
    get: (id: string) => Promise<PageRecord>;
    create: (input: CreatePageInput) => Promise<PageRecord>;
    updateMany: (ids: string[], changes: PageChanges) => Promise<void>;
    save: (input: SavePageInput) => Promise<PageRecord>;
    trash: (ids: string[]) => Promise<void>;
    restore: (ids: string[]) => Promise<void>;
    tags: () => Promise<string[]>;
    renameTag: (oldName: string, newName: string) => Promise<void>;
    removeTag: (name: string) => Promise<void>;
    properties: () => Promise<PropertyDefinition[]>;
    saveProperty: (input: PropertyDefinition) => Promise<void>;
    removeProperty: (id: string) => Promise<void>;
    backlinks: (id: string) => Promise<LinkRecord[]>;
    importFeed: (id: string) => Promise<PageRecord>;
    importPDF: (pageId?: string) => Promise<ImportResult>;
    importDOI: (doi: string) => Promise<PageRecord>;
    importBibTeX: () => Promise<ImportResult>;
    attachments: (pageId: string) => Promise<Attachment[]>;
    readAttachment: (id: string) => Promise<Uint8Array>;
    getPosition: (id: string) => Promise<ReadingPosition | null>;
    setPosition: (id: string, position: ReadingPosition) => Promise<void>;
    annotationOrigin: (pageId: string) => Promise<AnnotationOrigin | null>;
    annotations: (attachmentId: string) => Promise<Annotation[]>;
    annotate: (input: Omit<Annotation, "id" | "pageId">) => Promise<Annotation>;
    changeAnnotation: (id: string, color: string) => Promise<void>;
    stats: () => Promise<WorkspaceStats>;
    dismissReminder: (id: string) => Promise<void>;
    visit: (id: string) => Promise<void>;
    clearHistory: (id?: string) => Promise<void>;
    exportMarkdown: (ids: string[]) => Promise<string | null>;
    exportBibTeX: (ids: string[]) => Promise<string | null>;
    backup: () => Promise<string | null>;
    restoreBackup: () => Promise<string | null>;
    openURL: (url: string) => Promise<void>;
    importImage: () => Promise<string | null>;
}