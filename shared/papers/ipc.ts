import { type HistorySource } from "../history/ipc";
import type { CommitResult } from "../types/content";
import type { AnnotationInput, Attachment, PaperImport, PaperResources, ReadingPosition } from "../types/papers";
import { type Channels } from "../ipc/contract";
import type { tags } from "typia";

type SelectedAnnotation = Omit<AnnotationInput, "rectangles"> & { rectangles: AnnotationInput["rectangles"] & tags.MinItems<1> };

export type PapersAPI = {
    importPDF(source: HistorySource, pageId?: string): Promise<PaperImport | null>;
    importFiles(pageId: string, attributeId: string, source: HistorySource): Promise<Attachment[] | null>;
    attachFile(pageId: string, attributeId: string, fileId: string, source: HistorySource): Promise<void>;
    files(ids?: string[]): Promise<Attachment[]>;
    openFile(fileId: string): Promise<void>;
    resources(pageId: string): Promise<PaperResources>;
    readFile(fileId: string): Promise<Uint8Array>;
    unlockPDF(fileId: string, password: string): Promise<void>;
    changeAnnotation(id: string, color: string, source: HistorySource): Promise<CommitResult>;
    position(pageId: string, fileId: string, value: ReadingPosition): Promise<void>;
    deleteAnnotation(id: string, source: HistorySource, confirmation?: string): Promise<CommitResult>;
    prepareAnnotation(pageId: string, anchor: SelectedAnnotation | string): Promise<boolean>;
    annotate(pageId: string, anchor: SelectedAnnotation, source: HistorySource, color?: string): Promise<string>;
};

export const papersChannels = {
    importPDF: "papers:import-pdf",
    importFiles: "papers:import-files",
    attachFile: "papers:attach-file",
    files: "papers:files",
    openFile: "papers:open-file",
    resources: "papers:resources",
    readFile: "papers:read-file",
    unlockPDF: "papers:unlock-pdf",
    changeAnnotation: "papers:change-annotation",
    position: "papers:position",
    deleteAnnotation: "papers:delete-annotation",
    prepareAnnotation: "papers:prepare-annotation",
    annotate: "papers:annotate"
} as const satisfies Channels<PapersAPI>;