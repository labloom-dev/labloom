import type { Rectangle } from "../types/papers";

/** Bump whenever pdf.js or the worker character-cell patch changes. */
export const PDF_EXTRACTOR_VERSION = "pdfjs-6.3.289-labloom-2";

/** Original unrotated PDF user space; coordinates are never normalized. */
export type PdfCharacter = {
    text: string;
    rectangle: Rectangle;
    baseline: number;
    vertical?: boolean;
    synthetic?: boolean;
    eol?: boolean;
};
export type CharacterRange = [start: number, end: number];

export function charactersFromTextContent(content: { items: readonly unknown[] }): PdfCharacter[] {
    return content.items.flatMap(item => {
        if (!item || typeof item !== "object" || !("str" in item)) return [];
        const patched = item as { str: string; characters?: PdfCharacter[] };
        // Internal assertion: the bundled PDF extractor must include the maintained character-cell patch.
        if (!patched.characters && patched.str.trim()) throw new Error("The PDF character extractor patch is inactive.");
        return patched.characters ?? [];
    });
}

/** Inclusive edges make the result stable at exact PDF coordinate boundaries. */
export function containsPoint(rectangle: Rectangle, x: number, y: number): boolean {
    return x >= rectangle.x && x <= rectangle.x + rectangle.width && y >= rectangle.y && y <= rectangle.y + rectangle.height;
}

/** This is the sole quote rule: cell centers inside any rectangle, extraction order. */
export function extractText(characters: readonly PdfCharacter[], rectangles: readonly Rectangle[]): string {
    let text = "";
    for (const character of characters) {
        const { x, y, width, height } = character.rectangle;
        if (rectangles.some(rectangle => containsPoint(rectangle, x + width / 2, y + height / 2))) text += character.text;
    }
    return text;
}

/** A hit must be inside a real cell unless dragging explicitly requests nearest. */
export function hitTest(characters: readonly PdfCharacter[], x: number, y: number, nearest = false): number {
    let closest = -1, distance = Infinity;
    for (let index = 0; index < characters.length; index++) {
        const character = characters[index];
        if (character.eol || !character.text || character.rectangle.width === 0 || character.rectangle.height === 0) continue;
        const rectangle = character.rectangle;
        const dx = Math.max(rectangle.x - x, 0, x - rectangle.x - rectangle.width);
        const dy = Math.max(rectangle.y - y, 0, y - rectangle.y - rectangle.height);
        const current = dx * dx + dy * dy;
        if (!current && !character.synthetic) return index;
        if (current < distance) {
 closest = index; distance = current;
}
    }
    return nearest || distance === 0 ? closest : -1;
}

function sameBaseline(a: PdfCharacter, b: PdfCharacter): boolean {
    if (!!a.vertical !== !!b.vertical) return false;
    const extent = a.vertical ? Math.min(a.rectangle.width, b.rectangle.width) : Math.min(a.rectangle.height, b.rectangle.height);
    return Math.abs(a.baseline - b.baseline) <= Math.max(0.25, extent * 0.15);
}

export function lineRange(characters: readonly PdfCharacter[], index: number): CharacterRange {
    const seed = characters[index];
    if (!seed) return [index, index];
    let start = index, end = index;
    while (start > 0 && !characters[start - 1].eol && sameBaseline(seed, characters[start - 1])) start--;
    while (end + 1 < characters.length && sameBaseline(seed, characters[end + 1])) {
        end++;
        if (characters[end].eol) break;
    }
    return [start, end];
}

export function wordRange(characters: readonly PdfCharacter[], index: number): CharacterRange {
    if (!characters[index]) return [index, index];
    const text = characters.map(character => character.text).join("");
    let offset = 0;
    for (let i = 0; i < index; i++) offset += characters[i].text.length;
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    const word = segmenter.segment(text).containing(offset);
    if (!word) return [index, index];
    let position = 0, start = index, end = index;
    for (let i = 0; i < characters.length; i++) {
        const next = position + characters[i].text.length;
        if (position <= word.index && next > word.index) start = i;
        if (position < word.index + word.segment.length && next >= word.index + word.segment.length) {
 end = i; break;
}
        position = next;
    }
    return [start, end];
}

function union(a: Rectangle, b: Rectangle): Rectangle {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** Group by baseline only. Large gaps remain separate; no column/layout analysis. */
export function selectionRectangles(characters: readonly PdfCharacter[], start: number, end: number): Rectangle[] {
    const first = Math.max(0, Math.min(start, end)), last = Math.min(characters.length - 1, Math.max(start, end));
    const lines: { seed: PdfCharacter; cells: PdfCharacter[] }[] = [];
    for (let index = first; index <= last; index++) {
        const character = characters[index];
        if (character.eol || character.rectangle.width <= 0 || character.rectangle.height <= 0) continue;
        let line = lines.find(candidate => sameBaseline(candidate.seed, character));
        if (!line) {
 line = { seed: character, cells: [] }; lines.push(line);
}
        line.cells.push(character);
    }
    return lines.flatMap(({ seed, cells }) => {
        const vertical = !!seed.vertical;
        cells.sort((a, b) => vertical ? a.rectangle.y - b.rectangle.y : a.rectangle.x - b.rectangle.x);
        const rectangles: Rectangle[] = [];
        for (const { rectangle } of cells) {
            const previous = rectangles.at(-1);
            const gap = previous ? vertical ? rectangle.y - previous.y - previous.height : rectangle.x - previous.x - previous.width : Infinity;
            const extent = vertical ? rectangle.width : rectangle.height;
            if (previous && gap <= extent * 1.5) rectangles[rectangles.length - 1] = union(previous, rectangle);
            else rectangles.push({ ...rectangle });
        }
        return rectangles;
    });
}