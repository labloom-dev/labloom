import { type AttributeDefinition, type AttributeValue } from "../types/attributes";
import { type ContentBlock, type Target } from "../types/content";
import { references } from "./blocks";

export type GraphPage = { id: string; titleBlockId: string; children: string[]; attributes: Record<string, AttributeValue> };

export function pageTargets(page: GraphPage, definitions: AttributeDefinition[]): Target[] {
    const targets: Target[] = [];
    for (const definition of definitions) {
        const value = page.attributes[definition.id];
        if (definition.type === "page-link" && typeof value === "string") targets.push({ kind: "page", id: value });
        if (definition.type === "page-links" && Array.isArray(value)) for (const id of value) if (typeof id === "string") targets.push({ kind: "page", id });
    }
    return targets;
}

// Containment follows UUID arrays, never reverse uses of a shared block.
export function unreachablePages(pages: GraphPage[], blocks: Map<string, ContentBlock>, definitions: AttributeDefinition[]): string[] {
    const live = pages.filter(page => !page.attributes.deleted);
    const reached = reachableFromRoots(live, blocks, definitions);
    return live.filter(page => !reached.has(page.id)).map(page => page.id);
}

function reachableFromRoots(pages: GraphPage[], blocks: Map<string, ContentBlock>, definitions: AttributeDefinition[]): Set<string> {
    const byId = new Map(pages.map(page => [page.id, page]));
    const visitedPages = new Set<string>(), visitedBlocks = new Set<string>();
    const queue: Target[] = pages.filter(page => page.attributes.independent === true).map(page => ({ kind: "page", id: page.id }));
    while (queue.length) {
        const target = queue.pop()!;
        if (target.kind === "page") {
            if (visitedPages.has(target.id)) continue;
            const page = byId.get(target.id);
            if (!page) continue;
            visitedPages.add(page.id);
            queue.push(...[page.titleBlockId, ...page.children].map(id => ({ kind: "block" as const, id })), ...pageTargets(page, definitions));
        }
        else {
            if (visitedBlocks.has(target.id)) continue;
            visitedBlocks.add(target.id);
            const block = blocks.get(target.id);
            if (block) queue.push(...block.children.map(id => ({ kind: "block" as const, id })), ...references(block).filter(target => target.kind === "page"));
        }
    }
    return visitedPages;
}

export function containedBlocks(page: Pick<GraphPage, "titleBlockId" | "children">, blocks: Map<string, ContentBlock>): Set<string> {
    return walkChildren([page.titleBlockId, ...page.children], blocks);
}

function walkChildren(queue: string[], blocks: Map<string, ContentBlock>): Set<string> {
    const result = new Set<string>();
    while (queue.length) {
        const id = queue.pop()!;
        if (result.has(id)) continue;
        result.add(id);
        queue.push(...blocks.get(id)?.children ?? []);
    }
    return result;
}