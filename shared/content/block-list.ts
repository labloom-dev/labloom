import { blockText } from "./blocks";
import type { BlockListItem, ContentBlock } from "../types/content";

// Track only the current ancestry so each occurrence of a shared block keeps its own depth.
export function blockListRows(roots: string[], get: (id: string) => ContentBlock | undefined, reference: (block: ContentBlock) => string): BlockListItem[] {
    const rows: BlockListItem[] = [];
    const path = new Set<string>();
    const stack = [{ ids: roots, next: 0, parent: "" }];
    while (stack.length) {
        const level = stack[stack.length - 1];
        if (level.next === level.ids.length) {
            path.delete(level.parent);
            stack.pop();
            continue;
        }
        const id = level.ids[level.next++], block = get(id);
        if (!block || path.has(id)) continue;
        const text = block.type === "blocked_reference" ? reference(block) : blockText(block).trim().split("\n", 1)[0];
        rows.push({ id, type: block.type, text, depth: stack.length - 1 });
        if (block.children.length) {
            path.add(id);
            stack.push({ ids: block.children, next: 0, parent: id });
        }
    }
    return rows;
}