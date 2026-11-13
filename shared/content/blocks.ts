import { LabloomError } from "../failure";
import { jsonValue, record, validUUID } from "../attrs/values";
import { blockKinds, type BlockPayload, type ContentBlock, type InlineNode, type Target } from "../types/content";

export function validTarget(value: unknown): value is Target {
    return record(value) && (value.kind === "page" || value.kind === "block") && validUUID(value.id);
}

export function textInline(text: string): InlineNode[] {
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

export function validateBlock(value: unknown): asserts value is ContentBlock {
    if (!record(value) || !validUUID(value.id) || !blockKinds.includes(value.type as never) || !Array.isArray(value.children) || !value.children.every(validUUID)) throw new LabloomError({ kind: "block-invalid-identity" });
    const body = value.payload;
    if (!record(body) || body.schemaVersion !== 1 || body.type !== value.type || !Array.isArray(body.inline) || !jsonValue(body)) throw new LabloomError({ kind: "block-invalid-version" });
    if (body.collapsed !== undefined && typeof body.collapsed !== "boolean") throw new LabloomError({ kind: "block-invalid-collapse" });
    const marks = new Set(["bold", "italic", "underline", "strike", "code", "fgColor", "bgColor"]);
    const colors = new Set(["default", "gray", "light-gray", "red", "yellow", "orange", "green", "lime", "blue", "purple", "brown", "cyan", "pink", "magenta"]);
    for (const node of body.inline) {
        if (!record(node)) throw new LabloomError({ kind: "block-invalid-inline" });
        if (node.type === "text") {
            if (typeof node.text !== "string" || !node.text) throw new LabloomError({ kind: "block-empty-text" });
            if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.some(mark => !record(mark) || !marks.has(String(mark.type)) || (["fgColor", "bgColor"].includes(String(mark.type)) && (!record(mark.attrs) || !colors.has(String(mark.attrs[String(mark.type)]))))))) throw new LabloomError({ kind: "block-invalid-marks" });
        }
        else if (node.type === "inlineReference") {
            if (!record(node.attrs) || !validTarget(node.attrs.target) || typeof node.attrs.label !== "string") throw new LabloomError({ kind: "block-invalid-inline-target" });
        }
        else if (node.type !== "hardBreak") throw new LabloomError({ kind: "block-inline-only" });
    }
    if (value.type === "title" && (value.children.length || blockText(value as ContentBlock).length > 1000)) throw new LabloomError({ kind: "block-invalid-title" });
    if (["title", "heading_1", "heading_2", "heading_3", "code", "table", "hr", "blocked_reference"].includes(String(value.type)) && value.children.length) throw new LabloomError({ kind: "block-no-children" });
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

export function references(block: ContentBlock): Target[] {
    const targets: Target[] = [];
    if (block.payload.target) targets.push(block.payload.target);
    for (const node of block.payload.inline) if (node.type === "inlineReference") targets.push(node.attrs.target);
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

export function assertAcyclic(blocks: Map<string, ContentBlock>): void {
    const done = new Set<string>();
    const visiting = new Set<string>();
    function visit(id: string): void {
        if (visiting.has(id)) throw new LabloomError({ kind: "block-cycle" });
        if (done.has(id)) return;
        visiting.add(id);
        for (const child of blocks.get(id)?.children ?? []) visit(child);
        visiting.delete(id);
        done.add(id);
    }
    for (const id of blocks.keys()) visit(id);
}