import type { FailureInfo } from "../failure";
import { type AnnotationColor } from "../content/annotations";
export type Rectangle = { x: number; y: number; width: number; height: number };
/** Unrotated PDF user-space coordinates: x/y are the lower-left corner, in PDF units. */
export type AnnotationInput = { fileId: string; pageNumber: number; rectangles: Rectangle[]; quote: string; context: string; extractorVersion: string };
export type PaperAnnotation = AnnotationInput & { id: string; color: AnnotationColor; excerpt: string; hasText: boolean };
export type AnnotationPaper = { id: string; title: string; recycled: boolean };
export type Attachment = { id: string; originalName: string; mediaType: string; size: number };
export type PaperResources = { files: Attachment[]; annotations: PaperAnnotation[] };
export type ReadingPosition = { page: number; scale: string | number; rotation: number; left: number; top: number };
export type PaperImport = { pageId: string };
export type PaperImportBatch = { pages: string[]; failures: { name: string; error: FailureInfo }[] };