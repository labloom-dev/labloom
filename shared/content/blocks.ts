import { codeLanguages } from "./code-languages";
import { pastedURL } from "./media";
import { LabloomError } from "../failure";
import { jsonValue, record, validUUID } from "../attrs/values";
import { blockKinds, mediaKinds, type BlockPayload, type ContentBlock, type InlineNode, type LinkTarget, type MediaKind, type Target } from "../types/content";

export function isMediaKind(kind: string): kind is MediaKind {
    return mediaKinds.includes(kind as MediaKind);
}

export function validTarget(value: unknown): value is Target {
    return record(value) && (value.kind === "page" || value.kind === "block") && validUUID(value.id);
}

function textInline(text: string): InlineNode[] {
    return text ? [{ type: "text", text }] : [];
}

export function blockText(block: ContentBlock): string {
    const walk = (value: unknown): string => {
        if (!record(value)) return "";
        if (typeof value.text === "string") return value.text;
        return Array.isArray(value.content) ? value.content.map(walk).join(" ") : "";
    };
    return block.payload.inline.map(node => node.type === "text" ? node.text : node.type === "inlineReference" ? node.attrs.label : "\n").join("") + (block.payload.table ? walk(block.payload.table) : "");
}

export function payload(type: ContentBlock["type"], text = ""): BlockPayload {
    return { schemaVersion: 1, type, inline: textInline(text) };
}

const marks = new Set(["bold", "italic", "underline", "strike", "code", "fgColor", "bgColor", "webLink"]);
const colors = new Set(["default", "gray", "light-gray", "red", "yellow", "orange", "green", "lime", "blue", "purple", "brown", "cyan", "pink", "magenta"]);

function validMark(mark: unknown): boolean {
    if (!record(mark) || typeof mark.type !== "string" || !marks.has(mark.type)) return false;
    if (mark.type === "fgColor" || mark.type === "bgColor") return record(mark.attrs) && colors.has(String(mark.attrs[mark.type]));
    if (mark.type === "webLink") return record(mark.attrs) && typeof mark.attrs.href === "string" && !!pastedURL(mark.attrs.href);
    return true;
}

export function validateBlock(value: unknown): asserts value is ContentBlock {
    if (!record(value) || !validUUID(value.id) || !blockKinds.includes(value.type as never) || !Array.isArray(value.children) || !value.children.every(validUUID)) throw new LabloomError({ kind: "block-invalid-identity" });
    const body = value.payload;
    if (!record(body) || body.schemaVersion !== 1 || body.type !== value.type || !Array.isArray(body.inline) || !jsonValue(body)) throw new LabloomError({ kind: "block-invalid-version" });
    if (body.collapsed !== undefined && typeof body.collapsed !== "boolean") throw new LabloomError({ kind: "block-invalid-collapse" });
    if (body.language !== undefined && (value.type !== "code" || !codeLanguages.includes(body.language as never))) throw new LabloomError({ kind: "block-invalid-language" });
    for (const node of body.inline) {
        if (!record(node)) throw new LabloomError({ kind: "block-invalid-inline" });
        if (node.type === "text") {
            if (typeof node.text !== "string" || !node.text) throw new LabloomError({ kind: "block-empty-text" });
            if (node.marks !== undefined && (!Array.isArray(node.marks) || !node.marks.every(validMark))) throw new LabloomError({ kind: "block-invalid-marks" });
        }
        else if (node.type === "inlineReference") {
            if (!record(node.attrs) || !validTarget(node.attrs.target) || typeof node.attrs.label !== "string") throw new LabloomError({ kind: "block-invalid-inline-target" });
        }
        else if (node.type !== "hardBreak") throw new LabloomError({ kind: "block-inline-only" });
    }
    if (value.type === "title" && value.children.length) throw new LabloomError({ kind: "block-invalid-title" });
    const type = value.type as ContentBlock["type"];
    if ((isMediaKind(type) || ["title", "heading_1", "heading_2", "heading_3", "code", "table", "hr", "blocked_reference"].includes(type)) && value.children.length) throw new LabloomError({ kind: "block-no-children" });
    if (isMediaKind(type) ? !validMedia(type, body.media) : body.media !== undefined) throw new LabloomError({ kind: "block-invalid-media" });
    if (value.type === "blocked_reference" && body.target !== null && !validTarget(body.target)) throw new LabloomError({ kind: "block-reference-required" });
    if (value.type !== "blocked_reference" && body.target !== undefined) throw new LabloomError({ kind: "block-reference-only" });
    if (value.type === "table") {
        const visit = (node: unknown, parent: string): boolean => {
            if (!record(node) || typeof node.type !== "string") return false;
            const allowed: Record<string, string[]> = { root: ["table"], table: ["tableRow"], tableRow: ["tableCell", "tableHeader"], tableCell: ["paragraph"], tableHeader: ["paragraph"], paragraph: ["text", "hardBreak"] };
            if (!allowed[parent]?.includes(node.type) || (record(node.attrs) && (node.attrs.uid || node.attrs.blockId))) return false;
            if (node.type === "text") return typeof node.text === "string";
            if (node.type === "hardBreak") return true;
            return Array.isArray(node.content) && node.content.every(child => visit(child, node.type as string));
        };
        if (!visit(body.table, "root")) throw new LabloomError({ kind: "block-invalid-table" });
    }
    else if (body.table !== undefined) throw new LabloomError({ kind: "block-table-only" });
}

function validMedia(kind: MediaKind, media: unknown): boolean {
    if (!record(media) || !(validUUID(media.fileId) || media.fileId === null && typeof media.name === "string" && !!media.name)) return false;
    const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
    const { width, aspectRatio, naturalWidth } = media;
    if (width !== undefined && (!positive(width) || width > 1)) return false;
    if (kind === "image") return positive(aspectRatio) && positive(naturalWidth);
    if (naturalWidth !== undefined) return false;
    if (kind === "video" && aspectRatio !== undefined) return positive(aspectRatio);
    return width === undefined && aspectRatio === undefined;
}

export function references(block: ContentBlock): LinkTarget[] {
    const targets: LinkTarget[] = [];
    if (block.payload.target) targets.push(block.payload.target);
    for (const node of block.payload.inline) if (node.type === "inlineReference") targets.push(node.attrs.target);
    if (block.payload.media?.fileId) targets.push({ kind: "file", id: block.payload.media.fileId });
    return targets;
}

// Reordering a container preserves use counts. Repeated occurrences count separately.
export function changedUses(before: string[], after: string[]): Map<string, number> {
    const delta = new Map<string, number>();
    for (const id of before) delta.set(id, (delta.get(id) ?? 0) - 1);
    for (const id of after) delta.set(id, (delta.get(id) ?? 0) + 1);
    for (const [id, count] of delta) if (!count) delta.delete(id);
    return delta;
}