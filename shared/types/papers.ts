export type Rectangle = { x: number; y: number; width: number; height: number };
/** Unrotated PDF user-space coordinates: x/y are the lower-left corner, in PDF units. */
export type AnchorInput = { fileId: string; pageNumber: number; rectangles: Rectangle[]; quote: string; context: string; extractorVersion: string };
export type Anchor = AnchorInput & { id: string };
export type Attachment = { id: string; originalName: string; mediaType: string; size: number; sha256: string };
export type Highlight = { id: string; anchorId: string; color: string; annotationId?: string };
export type PaperResources = { files: Attachment[]; anchors: Anchor[]; highlights: Highlight[] };
export type ReadingPosition = { page: number; scale: string | number; rotation: number; left: number; top: number };
export type PaperImport = { pageId: string; reused: boolean };