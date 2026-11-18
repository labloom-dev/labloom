import type { HistoryOrigin, HistorySource } from "../history/ipc";
import type { CommitResult } from "../types/content";
import type { PaperAnnotation, AnnotationInput, Attachment, PaperImport, PaperResources, ReadingPosition } from "../types/papers";
import type { TabId, Channels } from "../ipc/contract";
import type { tags } from "typia";

type SelectedAnnotation = Omit<AnnotationInput, "rectangles"> & { rectangles: AnnotationInput["rectangles"] & tags.MinItems<1> };

export type PapersAPI = {
    importPDF(pageId?: string, origin?: HistoryOrigin): Promise<PaperImport | null>;
    importFiles(pageId: string, attributeId: string, tabId: TabId, source: HistorySource): Promise<Attachment[] | null>;
    files(ids?: string[]): Promise<Attachment[]>;
    openFile(fileId: string): Promise<void>;
    resources(pageId: string): Promise<PaperResources>;
    readFile(fileId: string): Promise<Uint8Array>;
    getAnnotation(id: string): Promise<PaperAnnotation>;
    unlockPDF(fileId: string, password: string): Promise<void>;
    changeAnnotation(id: string, color: string, tabId: TabId, source: HistorySource): Promise<CommitResult>;
    position(pageId: string, fileId: string, value: ReadingPosition, tabId?: TabId): Promise<void>;
    deleteAnnotation(id: string, tabId: TabId, source: HistorySource, confirmation?: string): Promise<CommitResult>;
    annotate(pageId: string, anchor: SelectedAnnotation | string, tabId: TabId, source: HistorySource, color?: string): Promise<string>;
};

export const papersChannels = {
    importPDF: "papers:import-pdf",
    importFiles: "papers:import-files",
    files: "papers:files",
    openFile: "papers:open-file",
    resources: "papers:resources",
    readFile: "papers:read-file",
    getAnnotation: "papers:get-annotation",
    unlockPDF: "papers:unlock-pdf",
    changeAnnotation: "papers:change-annotation",
    position: "papers:position",
    deleteAnnotation: "papers:delete-annotation",
    annotate: "papers:annotate"
} as const satisfies Channels<PapersAPI>;