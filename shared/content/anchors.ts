import { type Rectangle } from "../types/papers";

// PDF coordinates use a bottom-left origin; anchors use the unrotated crop's top-left.
export function normalizeRectangle(points: [number, number, number, number], crop: readonly number[]): Rectangle {
    const width = crop[2] - crop[0], height = crop[3] - crop[1];
    const left = Math.max(crop[0], Math.min(points[0], points[2])), right = Math.min(crop[2], Math.max(points[0], points[2]));
    const bottom = Math.max(crop[1], Math.min(points[1], points[3])), top = Math.min(crop[3], Math.max(points[1], points[3]));
    return { x: (left - crop[0]) / width, y: (crop[3] - top) / height, width: (right - left) / width, height: (top - bottom) / height };
}
export function pdfRectangle(rect: Rectangle, crop: readonly number[]): [number, number, number, number] {
    const width = crop[2] - crop[0], height = crop[3] - crop[1];
    return [crop[0] + rect.x * width, crop[3] - rect.y * height, crop[0] + (rect.x + rect.width) * width, crop[3] - (rect.y + rect.height) * height];
}