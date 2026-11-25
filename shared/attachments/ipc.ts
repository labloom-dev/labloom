import type { Channels } from "../ipc/contract";
import type { MediaFile } from "../content/media";
import type { MediaKind } from "../types/content";
import type { FailureInfo } from "../failure";
import type { Attachment } from "../types/papers";

type TransferProgress = { id: string; bytes: number; total?: number };
export type AttachmentBatch = { files: Attachment[]; failures: { name: string; error: FailureInfo }[] };

export type AttachmentsAPI = {
    available(id: string): Promise<boolean>;
    saveAs(id: string): Promise<void>;
    choose(kind: MediaKind | "pdf", multiple?: boolean): Promise<string[]>;
    stagePaths(paths: string[], pdfOnly: boolean, atomic?: boolean): Promise<AttachmentBatch>;
    importPath(id: string, path: string, source?: Pick<MediaFile, "id" | "originalName" | "mediaType">): Promise<MediaFile>;
    downloadImage(id: string, url: string): Promise<MediaFile>;
    uploadStart(id: string, name: string, type: string): Promise<void>;
    uploadChunk(id: string, bytes: Uint8Array): Promise<void>;
    uploadFinish(id: string): Promise<MediaFile>;
    cancelTransfer(id: string): Promise<void>;
    releaseHandoffs(ids: string[]): Promise<void>;
    onTransferProgress(listener: (progress: TransferProgress) => void): () => void;
};

export const attachmentProgress = "attachments:progress";
export const attachmentsChannels = {
    available: "attachments:available",
    saveAs: "attachments:saveAs",
    choose: "attachments:choose",
    stagePaths: "attachments:stagePaths",
    importPath: "attachments:importPath",
    downloadImage: "attachments:downloadImage",
    uploadStart: "attachments:uploadStart",
    uploadChunk: "attachments:uploadChunk",
    uploadFinish: "attachments:uploadFinish",
    cancelTransfer: "attachments:cancelTransfer",
    releaseHandoffs: "attachments:releaseHandoffs"
} satisfies Channels<AttachmentsAPI>;