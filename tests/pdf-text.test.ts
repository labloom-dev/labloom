import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { charactersFromTextContent, extractText, hitTest, lineRange, PDF_EXTRACTOR_VERSION, selectionRectangles, wordRange, type PdfCharacter } from "../shared/content/pdf-text";
import { knownCoordinatePdf } from "./fixtures/pdf-text";

const character = (text: string, x: number, y: number, width = 8, height = 12, baseline = y + 2): PdfCharacter => ({ text, rectangle: { x, y, width, height }, baseline });

test("PDF quotes use inclusive cell centers, preserve extraction order and never repeat overlaps", () => {
    const chars = [character("A", 0, 0), character("B", 8, 0), character("C", 16, 0)];
    assert.equal(extractText(chars, [{ x: 4, y: 6, width: 8, height: 0 }]), "AB");
    assert.equal(extractText(chars, [{ x: 0, y: 0, width: 20, height: 12 }, { x: 0, y: 0, width: 8, height: 12 }]), "ABC");
    assert.equal(extractText(chars, [{ x: 0, y: 0, width: 3.999, height: 12 }]), "");
});

test("PDF quotes exclude adjacent columns and dense lines, include selected superscripts", () => {
    const chars = [character("H", 10, 20), character("2", 18, 28, 4, 6), character("O", 22, 20), character("column", 200, 20), character("lower", 10, 9, 8, 12)];
    assert.equal(extractText(chars, [{ x: 10, y: 20, width: 20, height: 14 }]), "H2O");
    assert.equal(extractText(chars, [{ x: 10, y: 20, width: 20, height: 12 }]), "H2O");
});

test("PDF drag ranges merge by baseline and retain separate columns and dense lines", () => {
    const chars = [character("a", 10, 20), character("b", 18, 20), character("c", 200, 20), character("d", 10, 9)];
    const rectangles = selectionRectangles(chars, 3, 0);
    assert.equal(rectangles.length, 3);
    assert.deepEqual(rectangles[0], { x: 10, y: 20, width: 16, height: 12 });
    assert.equal(extractText(chars, rectangles), "abcd");
    assert.equal(hitTest(chars, 12, 24), 0);
    assert.equal(hitTest(chars, 100, 100), -1);
    assert.equal(hitTest(chars, 12, 100, true), 0);
    assert.deepEqual(lineRange(chars, 1), [0, 2]);
});

test("PDF double-click word selection uses Intl.Segmenter and UTF-16 boundaries", () => {
    const chars = Array.from("Hello 世界 🙂 done").map((letter, index) => character(letter, index * 8, 0));
    const [start, end] = wordRange(chars, 1);
    assert.equal(chars.slice(start, end + 1).map(item => item.text).join(""), "Hello");
    const [emojiStart, emojiEnd] = wordRange(chars, 9);
    assert.equal(chars.slice(emojiStart, emojiEnd + 1).map(item => item.text).join(""), "🙂");
});

test("patched pdf.js extracts actual glyph advances and pdf.js whitespace/EOL metadata", async () => {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: knownCoordinatePdf(), standardFontDataUrl: join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"), useSystemFonts: false });
    const document = await task.promise;
    try {
        const page = await document.getPage(1);
        const content = await page.getTextContent();
        const chars = charactersFromTextContent(content);
        assert.equal(chars.slice(0, 5).map(item => item.text).join(""), "HELLO");
        assert.ok(chars.some(item => item.synthetic && item.text === " "));
        assert.ok(chars.some(item => item.eol && item.text === "\n"));
        assert.equal(extractText(chars, selectionRectangles(chars, 6, 38)), "Across lines\nSecond selected line\n");
        const first = chars[0].rectangle;
        // Electron's pdf.js renderer uses Float16 paths when supported. Their
        // subpixel quantization is expected; assert PDF units before CSS checks.
        assert.ok(Math.abs(first.x - 51) < 0.02);
        assert.ok(Math.abs(first.y - 700) < 0.02);
        assert.ok(Math.abs(first.width - 10) < 0.02);
        assert.ok(Math.abs(first.height - 14) < 0.02);
        const expected = { x: 51, y: 700, width: 10, height: 14 };
        for (const scale of [1, 1.5, 2]) {
            for (const rotation of [0, 90]) {
                const viewport = page.getViewport({ scale: scale * 96 / 72, rotation });
                const actualPoints = [...viewport.convertToViewportPoint(first.x, first.y), ...viewport.convertToViewportPoint(first.x + first.width, first.y + first.height)];
                const knownPoints = [...viewport.convertToViewportPoint(expected.x, expected.y), ...viewport.convertToViewportPoint(expected.x + expected.width, expected.y + expected.height)];
                const error = Math.max(...actualPoints.map((coordinate, index) => Math.abs(coordinate - knownPoints[index])));
                assert.ok(error <= 2, `${scale * 100}% / ${rotation}° error ${error}px`);
                console.log(`PDF precision ${scale * 100}% ${rotation}deg: ${error.toFixed(6)} CSS px`);
            }
        }
        const rectangles = selectionRectangles(chars, 0, 4);
        assert.equal(extractText(chars, JSON.parse(JSON.stringify(rectangles))), "HELLO\n");
        assert.ok(PDF_EXTRACTOR_VERSION.includes("6.3.289"));
    }
    finally {
 await task.destroy();
}
});

test("PDF 3000-character extraction and selection updates stay below 100ms P95", () => {
    const chars = Array.from({ length: 3000 }, (_, index) => character(String.fromCharCode(65 + index % 26), 40 + index % 75 * 7, 760 - Math.floor(index / 75) * 16, 7, 12));
    const rectangles = selectionRectangles(chars, 0, chars.length - 1);
    const extraction: number[] = [], drag: number[] = [];
    for (let iteration = 0; iteration < 200; iteration++) {
        let started = performance.now();
        extractText(chars, rectangles);
        extraction.push(performance.now() - started);
        started = performance.now();
        const end = hitTest(chars, 40 + iteration % 75 * 7, 760 - iteration % 40 * 16, true);
        const selected = selectionRectangles(chars, 0, end);
        extractText(chars, selected);
        drag.push(performance.now() - started);
    }
    const percentile = (values: number[]): number => values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
    const extractionP95 = percentile(extraction), dragP95 = percentile(drag);
    console.log(`PDF 3000 characters: extraction P95 ${extractionP95.toFixed(3)} ms; drag update P95 ${dragP95.toFixed(3)} ms`);
    assert.ok(extractionP95 < 100);
    assert.ok(dragP95 < 100);
});
test("readable Helvetica highlight edges match actual canvas ink within two CSS pixels", async () => {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");
    const task = getDocument({ data: knownCoordinatePdf(false), useSystemFonts: false, standardFontDataUrl: join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/") });
    const document = await task.promise;
    try {
        const page = await document.getPage(1);
        const chars = charactersFromTextContent(await page.getTextContent());
        const rectangle = selectionRectangles(chars, 6, 17)[0];
        for (const scale of [1, 1.5, 2]) for (const rotation of [0, 90]) {
            const viewport = page.getViewport({ scale: scale * 96 / 72, rotation });
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            await page.render({ canvas, viewport } as never).promise;
            const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
            const a = viewport.convertToViewportPoint(rectangle.x, rectangle.y), b = viewport.convertToViewportPoint(rectangle.x + rectangle.width, rectangle.y + rectangle.height);
            const left = Math.min(a[0], b[0]), top = Math.min(a[1], b[1]), right = Math.max(a[0], b[0]), bottom = Math.max(a[1], b[1]);
            let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
            for (let y = Math.max(0, Math.floor(top - 4)); y < Math.min(canvas.height, Math.ceil(bottom + 4)); y++) {
                for (let x = Math.max(0, Math.floor(left - 4)); x < Math.min(canvas.width, Math.ceil(right + 4)); x++) {
                    const index = (y * canvas.width + x) * 4;
                    if (pixels[index] < 180 && pixels[index + 1] < 180 && pixels[index + 2] < 180) {
                        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1);
                    }
                }
            }
            const error = Math.max(Math.abs(left - minX), Math.abs(top - minY), Math.abs(right - maxX), Math.abs(bottom - maxY));
            console.log(`Helvetica raster ${scale * 100}% ${rotation}deg: ${error.toFixed(6)} CSS px`);
            assert.ok(error <= 2, `raster ink discrepancy ${error} CSS px`);
        }
    }
    finally {
        await task.destroy();
    }
});