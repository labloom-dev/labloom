import { type Rectangle } from "../types/papers";

/** A rectangle is stored directly in the PDF page's own, unrotated coordinate system. */
export function rectanglePoints(rect: Rectangle): [number, number, number, number] {
    return [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
}

export function rectangleWithinPage(rect: Rectangle, bounds: readonly number[]): boolean {
    const tolerance = 0.000001;
    return bounds.length === 4 && bounds.every(Number.isFinite)
        && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
        && rect.width > 0 && rect.height > 0
        && rect.x >= bounds[0] - tolerance && rect.y >= bounds[1] - tolerance
        && rect.x + rect.width <= bounds[2] + tolerance && rect.y + rect.height <= bounds[3] + tolerance;
}