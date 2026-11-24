import { type AnnotationInput } from "../../../shared/types/papers";

export type ReaderSource = {
    kind: "data";
    data: Uint8Array;
};

export const scalePresets = ["auto", "page-actual", "page-width", "page-fit"] as const;
export type ReaderScalePreset = typeof scalePresets[number];
export type ReaderScale = number | ReaderScalePreset;

export type ReaderRotation = 0 | 90 | 180 | 270;

export type ReaderViewState = {
    /** 1-based. */
    pageNumber: number;
    scale: ReaderScale;
    rotation: ReaderRotation;
    /** Top-left corner of the visible area, in PDF units of `pageNumber`. Independent of zoom. */
    left: number;
    top: number;
};


export type ReaderFindStatus =
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "found"; current: number; total: number; wrapped: boolean }
    | { kind: "not-found" }
    | { kind: "no-text" };
export type ReaderAnchor = Pick<AnnotationInput, "pageNumber" | "rectangles">;
export type ReaderAnchorGeometry = { anchor: ReaderAnchor; target: DOMRect; viewport: DOMRect };