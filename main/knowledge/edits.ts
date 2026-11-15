import { randomUUID } from "node:crypto";
import { attributeTargets, decodeValue, record, validUUID } from "../../shared/attrs/values";
import { blockText, payload, references, validateBlock } from "../../shared/content/blocks";
import { nowSeconds } from "../../shared/content/time";
import { LabloomError } from "../../shared/failure";
import { type AttributeDefinition, type AttributeImpact, type AttributeValue } from "../../shared/types/attributes";
import { pageKinds, type BlockDeletion, type ChangePreview, type CommitResult, type ContentBlock, type EditCommit, type KnowledgeChange, type PageKind, type PageRecord, type Placement, type Target } from "../../shared/types/content";
import * as workspace from "../workspace-state";
import * as attributes from "./attributes";
import { fingerprint } from "./attributes";
import { EditChanges } from "./changes";
import * as commit from "./commit";
import * as data from "./records";
import * as retention from "./retention";
import * as timerState from "./timer-state";
import { checkTab } from "./validation";


class DefinitionRollback extends Error {
    constructor(readonly impact: AttributeImpact) {
        super("definition preview");
    }
}
function transact(tabId: string, action: () => CommitResult, confirmation?: string): CommitResult {
    workspace.requireWorkspace();
    checkTab(tabId);
    return commit.run({ sourceTab: tabId, history: true, confirmation }, action);
}
function putBlock(block: ContentBlock): void {
    const plan = new EditChanges();
    plan.putBlock(block);
    plan.persist();
}
export function create(kind: PageKind = "editable", title = "", initial: Record<string, AttributeValue> = {}, parentId?: string, tabId = ""): PageRecord {
    workspace.requireWorkspace();
    if (!record(initial)) throw new LabloomError({ kind: "page-invalid-attributes" });
    for (const id of Object.keys(initial)) if (attributes.definition(id).readonly || id === "deleted") throw new LabloomError({ kind: "page-create-readonly" });
    if (kind === "annotation") throw new LabloomError({ kind: "annotation-selection-required" });
    return createPage(kind, title, initial, parentId, tabId);
}
function writable(id: string): ReturnType<typeof data["header"]> {
    const page = data.header(id);
    if (data.flags(id).deleted) throw new LabloomError({ kind: "page-recycled-readonly" });
    return page;
}

function planEdit(input: EditCommit): EditChanges {
    if (!record(input) || !Number.isSafeInteger(input.batch) || input.batch < 0 || !Array.isArray(input.blocks) || !record(input.attributes ?? {}) ||
        !Array.isArray(input.detach ?? []) || input.detach?.some(id => typeof id !== "string")) throw new LabloomError({ kind: "edit-invalid-input" });
    checkTab(input.tabId);
    if (input.sync !== undefined && (!Array.isArray(input.sync) || input.sync.some(id => !validUUID(id) || !syncBlock(id)))) throw new LabloomError({ kind: "block-sync-unavailable" });
    const page = writable(input.pageId), plan = new EditChanges(), submitted = new Set<string>();
    if (page.kind === "feed" && (input.pageChildren?.length || input.blocks.some(block => block.id !== page.titleBlockId || block.children.length))) throw new LabloomError({ kind: "feed-body-forbidden" });
    for (const block of input.blocks) {
        validateBlock(block);
        if (submitted.has(block.id)) throw new LabloomError({ kind: "edit-duplicate-block" });
        submitted.add(block.id);
        const previous = data.blockRow(block.id);
        if (previous?.type === "title" && block.type !== "title" || block.id === page.titleBlockId && block.type !== "title") throw new LabloomError({ kind: "block-title-type" });
        plan.putBlock(block);
    }
    if (input.pageChildren !== undefined) plan.pageChildren(page.id, input.pageChildren);
    for (const id of submitted) {
        if (!data.owners(id).includes(page.id) && !plan.owners(id).includes(page.id)) throw new LabloomError({ kind: "block-not-owned" });
    }
    plan.verifyContainment();
    plan.attributes(page.id, input.attributes ?? {}, input.detach);
    validateSchedule(plan, page.id, input.attributes ?? {});
    plan.pages.add(page.id);
    plan.touches.add(page.id);
    return plan;
}

function validateSchedule(plan: EditChanges, id: string, attrs: Record<string, AttributeValue>): void {
    if ("schedule_start" in attrs || "schedule_end" in attrs) {
        const start = plan.readValue(id, "schedule_start")?.value, end = plan.readValue(id, "schedule_end")?.value;
        if (typeof start === "number" && typeof end === "number" && end < start) throw new LabloomError({ kind: "schedule-reversed" });
    }
}

export function previewEdit(input: EditCommit): ChangePreview | null {
    workspace.requireWorkspace();
    return workspace.native().transaction(() => commit.preview(planEdit(input), input))();
}

export function commitEdit(input: EditCommit, confirmation?: string): CommitResult {
    workspace.requireWorkspace();
    return transact(input?.tabId, () => {
        const plan = planEdit(input);
        return commit.finish(plan, input.pageId, input.batch, commit.preview(plan, input));
    }, confirmation);
}

function writeChildren(plan: EditChanges, source: Target, children: string[]): void {
    if (source.kind === "page") plan.pageChildren(source.id, children);
    else {
        const block = plan.block(source.id);
        if (!block) throw new LabloomError({ kind: "block-container-missing" });
        plan.putBlock({ ...block, children });
    }
}

export function removeEverywhere(plan: EditChanges, id: string): ReturnType<typeof data["uses"]> {
    workspace.requireWorkspace();
    const uses = data.uses(id);
    if (uses.some(u => u.slot === "title")) throw new LabloomError({ kind: "block-title-delete" });
    const containers = new Map(uses.map(u => [u.kind + ":" + u.id, u]));
    for (const container of containers.values()) writeChildren(plan, container, plan.children(container).filter(child => child !== id));
    return uses;
}

function deletionSubject(block: ContentBlock): string {
    const names: Record<ContentBlock["type"], string> = {
        title: "标题", paragraph: "段落", heading_1: "一级标题", heading_2: "二级标题", heading_3: "三级标题",
        unordered_list: "无序列表项", ordered_list: "有序列表项", blockquote: "引文", callout: "提示块",
        code: "代码块", table: "表格", hr: "分隔线", blocked_reference: "链接引用"
    };
    const target = block.payload.target;
    if (block.type === "blocked_reference" && target) {
        let title: string;
        if (target.kind === "page") title = data.title(target.id);
        else {
            const resolved = data.resolve(target);
            title = resolved?.title || (resolved?.block ? names[resolved.block.type] : "已删除");
        }
        return `指向「${title}」的链接引用`;
    }
    const excerpt = blockText(block).trim().slice(0, 48);
    return excerpt ? `“${excerpt}”` : names[block.type];
}

export function deleteBlock(input: BlockDeletion, confirmation?: string): CommitResult {
    workspace.requireWorkspace();
    return transact(input?.tabId, () => {
        const { pageId, blockId } = input;
        writable(pageId);
        const plan = new EditChanges(), block = plan.block(blockId), pages = data.owners(blockId);
        if (!block || !pages.includes(pageId)) throw new LabloomError({ kind: "block-delete-not-owned" });
        const uses = removeEverywhere(plan, blockId);
        plan.touches.add(pageId);
        plan.blocks.add(blockId);
        for (const id of pages) plan.pages.add(id);
        const links = data.incoming({ kind: "block", id: blockId });
        const deleted = [{ id: blockId, excerpt: deletionSubject(block), pages: pages.length, positions: uses.length, links: links.length }];
        const preview = commit.preview(plan, input, deleted, [], { uses, links, pages: pages.sort() });
        return commit.finish(plan, pageId, 0, preview);
    }, confirmation);
}

export function place(input: Placement, confirmation?: string): CommitResult {
    workspace.requireWorkspace();
    return transact(input?.tabId, () => {
        const { position, action } = input;
        if (!record(position) || !Number.isSafeInteger(position.index) || position.index < 0 || !validUUID(position.blockId)) throw new LabloomError({ kind: "block-invalid-position" });
        const { pageId, containerId, index } = position;
        if (writable(pageId).kind === "feed") throw new LabloomError({ kind: "feed-body-forbidden" });
        const container: Target = { kind: containerId === pageId ? "page" : "block", id: containerId };
        if (container.kind === "block" && !data.owners(containerId).includes(pageId)) throw new LabloomError({ kind: "block-container-not-owned" });
        const plan = new EditChanges(), children = [...plan.children(container)];
        if (children[index] !== position.blockId) throw new LabloomError({ kind: "block-position-changed" });
        if (action === "insert") {
            const block = syncBlock(input.blockId ?? "");
            if (!block) throw new LabloomError({ kind: "block-sync-unavailable" });
            children.splice(index + 1, 0, block.id);
        }
        else if (action === "remove") children.splice(index, 1);
        else if (action === "clone" || action === "duplicate") {
            const block = plan.block(position.blockId);
            if (!block) throw new LabloomError({ kind: "block-copy-missing" });
            const copy = { ...block, id: randomUUID() };
            plan.putBlock(copy);
            if (action === "duplicate") children.splice(index + 1, 0, copy.id);
            else children[index] = copy.id;
        }
        else {
            const dest = action === "move-up" ? index - 1 : action === "move-down" ? index + 1 : -1;
            if (dest < 0 || dest >= children.length) throw new LabloomError({ kind: "block-move-invalid" });
            [children[index], children[dest]] = [children[dest], children[index]];
        }
        writeChildren(plan, container, children);
        plan.verifyContainment();
        plan.pages.add(pageId);
        plan.touches.add(pageId);
        return commit.finish(plan, pageId, 0, commit.preview(plan, input));
    }, confirmation);
}

function syncBlock(id: string): ContentBlock | null {
    const block = data.blockRow(id);
    return block && block.type !== "title" && data.owners(id).some(owner => !data.flags(owner).deleted) ? data.readBatch([id])[0] : null;
}

export function syncBlocks(workspaceId: string, ids: string[]): ContentBlock[] | null {
    workspace.requireWorkspace();
    if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || !ids.every(validUUID)) throw new LabloomError({ kind: "page-invalid-objects" });
    if (data.statement("SELECT id FROM workspace_meta").pluck().get() !== workspaceId || ids.some(id => !syncBlock(id))) return null;
    const blocks = new Map<string, ContentBlock>();
    let pending = ids;
    while (pending.length) {
        const rows = data.readBatch([...new Set(pending)].filter(id => !blocks.has(id)));
        pending = [];
        for (const block of rows) {
            blocks.set(block.id, block);
            pending.push(...block.children.filter(id => !blocks.has(id)));
        }
    }
    return [...blocks.values()];
}

function selectPages(ids: string[]): string[] {
    if (!Array.isArray(ids) || !ids.length || !ids.every(validUUID)) throw new LabloomError({ kind: "page-invalid-selection" });
    for (const id of ids) data.header(id);
    return [...new Set(ids)];
}

export function trash(ids: string[], tabId: string, confirmation?: string): CommitResult {
    workspace.requireWorkspace();
    return transact(tabId, () => {
        const selected = selectPages(ids), plan = new EditChanges();
        for (const id of selected) {
            plan.attributes(id, { deleted: true, recycle_reason: "manual_delete", recycled_at: nowSeconds() }, [], true);
            plan.touches.add(id);
        }
        return commit.finish(plan, selected[0], 0, commit.preview(plan, { trash: selected, tabId }, [], selected));
    }, confirmation);
}

export function restore(ids: string[], tabId: string): CommitResult {
    workspace.requireWorkspace();
    return transact(tabId, () => {
        const selected = selectPages(ids), plan = new EditChanges();
        for (const id of selected) {
            plan.attributes(id, { deleted: false, recycle_reason: null, recycled_at: null }, [], true);
            if (!retention.reachable(plan, { kind: "page", id }, new Set())) plan.attributes(id, { independent: true }, [], true);
            plan.touches.add(id);
        }
        return commit.finish(plan, selected[0], 0, null);
    });
}

export function createPage(kind: PageKind = "editable", title = "", initial: Record<string, AttributeValue> = {}, parentId?: string, tabId = ""): PageRecord {
    workspace.requireWorkspace();
    if (!pageKinds.includes(kind) || typeof title !== "string" || title.length > 1000 || !record(initial)) throw new LabloomError({ kind: "page-invalid-create" });
    const changed = { pages: [] as string[], blocks: [] as string[] };
    const page = commit.run({ sourceTab: tabId, history: !!parentId && kind === "annotation" && !!tabId }, context => {
        if (parentId) writable(parentId);
        if (kind === "annotation" && initial.annotation_file != null) {
            if (!parentId || data.header(parentId).kind !== "paper") throw new LabloomError({ kind: "annotation-paper-required" });
            const files = data.get(parentId).attributes.paper_files as string[];
            if (!files.includes(String(initial.annotation_file))) throw new LabloomError({ kind: "paper-file-removed" });
        }
        const id = randomUUID(), titleId = randomUUID(), bodyId = randomUUID(), plan = new EditChanges();
        for (const block of [{ id: titleId, type: "title" as const, payload: payload("title", title), children: [] },
        ...kind === "feed" ? [] : [{ id: bodyId, type: "paragraph" as const, payload: payload("paragraph"), children: [] }]]) putBlock(block);
        data.statement("INSERT INTO pages(id,kind,title_block_id,children) VALUES (?,?,?,?)").run(id, kind, titleId, JSON.stringify(kind === "feed" ? [] : [bodyId]));
        attributes.initializePage(id);
        const now = nowSeconds();
        plan.attributes(id, { independent: kind !== "annotation", ...(kind === "task" ? { task_status: "todo", priority: "normal" } : {}), ...(kind === "feed" ? { feed_status: "enabled", feed_refresh: { every: 60, unit: "minute" } } : {}), ...initial, created_at: now, modified_at: now, deleted: false }, [], true);
        validateSchedule(plan, id, initial);
        if (parentId && kind === "annotation") {
            if (data.header(parentId).kind !== "paper") throw new LabloomError({ kind: "annotation-paper-required" });
            const current = data.get(parentId).attributes.paper_annotations as string[];
            plan.attributes(parentId, { paper_annotations: [...current, id] }, [], true);
            const before = plan.rows.before["page:" + id] as import("./changes").PagePatch;
            const after = plan.rows.after["page:" + id] as import("./changes").PagePatch;
            after.values ??= {}; after.values.deleted = { value: 0 };
            for (const blockId of [titleId, bodyId]) {
                const row = data.blockRow(blockId)!;
                plan.rows.before["block:" + blockId] = structuredClone(row);
                plan.rows.after["block:" + blockId] = structuredClone(row);
            }
            before.creation = true;
            before.values = { ...structuredClone(after.values), deleted: { value: 1 } };
            plan.touches.add(parentId);
        }
        else if (parentId) {
            const reference = randomUUID();
            plan.putBlock({ id: reference, type: "blocked_reference", payload: { ...payload("blocked_reference"), target: { kind: "page", id } }, children: [] });
            plan.pageChildren(parentId, [...data.children({ kind: "page", id: parentId }), reference]);
            plan.touches.add(parentId);
        }
        if (!retention.reachable(plan, { kind: "page", id }, new Set())) throw new LabloomError({ kind: "page-retaining-reference-required" });
        context.persist(plan, parentId);
        if (parentId && kind !== "annotation") context.invalidate(["page:" + parentId]);
        changed.pages = [...plan.pages];
        changed.blocks = [titleId, ...kind === "feed" ? [] : [bodyId], ...plan.blocks];
        context.change(changed);
        return data.get(id);
    });
    return page;
}

export function rebuildLinks(): void {
    workspace.requireWorkspace();
    commit.run({ sourceTab: "" }, () => {
        data.statement("DELETE FROM link_refs").run();
        const insert = data.statement("INSERT OR IGNORE INTO link_refs(source_kind,source_id,source_field,target_kind,target_id) VALUES (?,?,?,?,?)");
        const ids = data.statement("SELECT id FROM blocks").pluck().all() as string[];
        for (const block of data.readBatch(ids)) for (const t of references(block)) insert.run("block", block.id, "payload", t.kind, t.id);
        const rows = data.statement("SELECT page_id AS pageId, attr_id AS field, value, type FROM page_attrs JOIN attrs_meta ON attrs_meta.id=attr_id WHERE type IN ('page-link','page-links','file','files') AND value IS NOT NULL").all() as { pageId: string; field: string; value: string; type: AttributeDefinition["type"] }[];
        for (const row of rows) {
            const definition = attributes.definition(row.field);
            for (const target of attributeTargets(row.type, decodeValue(definition, row.value))) insert.run("page", row.pageId, row.field, target.kind, target.id);
        }
    });
}

export function setDefinition(id: string, definition: AttributeDefinition | null, sourceTab: string, token?: string): AttributeImpact | null {
    workspace.requireWorkspace();
    checkTab(sourceTab);
    let saved: KnowledgeChange | undefined;
    try {
        commit.run({ sourceTab, history: false, confirmation: token }, context => {
            const impact = attributes.previewDefinition(id, definition);
            const owners = data.statement("SELECT page_id AS pageId FROM page_attrs WHERE attr_id=?").all(id) as { pageId: string }[];
            const plan = new EditChanges();
            const old = data.statement("SELECT type FROM attrs_meta WHERE id=?").get(id) as { type: string } | undefined;
            const previous = old ? attributes.definition(id) : undefined;
            const previousValues = new Map(owners.map(({ pageId }) => [pageId, data.valuesFor([pageId]).get(pageId)?.[id]]));
            const previousLinks = new Map(owners.map(({ pageId }) => [pageId, data.outgoing({ kind: "page", id: pageId })]));
            attributes.persistDefinition(id, definition, impact.token);
            const next = definition ? attributes.definition(id) : undefined;
            if ([old?.type, definition?.type].some(type => ["page-link", "page-links", "file", "files"].includes(type ?? ""))) {
                for (const { pageId } of owners) {
                    const value = plan.readValue(pageId, id)?.value;
                    const targets = next && value !== undefined ? attributeTargets(next.type, decodeValue(next, value)) : [];
                    plan.setLinks({ kind: "page", id: pageId }, id, targets, previousLinks.get(pageId));
                }
            }
            const ids = retention.lostPages(plan);
            const combined: AttributeImpact = { ...impact, token: fingerprint({ impact: impact.token, ids }), recycled: ids.map(id => ({ id, title: data.title(id) })) };
            if ((impact.pages.length || ids.length) && token !== combined.token) throw new DefinitionRollback(combined);
            commit.recycle(plan, ids);
            context.persist(plan);
            for (const { pageId } of owners) if (previous?.type !== next?.type || JSON.stringify(previousValues.get(pageId)) !== JSON.stringify(data.valuesFor([pageId]).get(pageId)?.[id])) timerState.recalculate(pageId, [id, "modified_at"]);
            const removedOptions = previous?.metadata.options?.some(option => !next?.metadata.options?.some(value => value.id === option.id));
            commit.invalidate([...new Set([...impact.pages.map(p => p.id), ...ids])].map(id => "page:" + id)
                .concat(!next || previous?.type !== next.type || removedOptions ? ["attribute:" + id] : []));
            saved = { ...plan.changed(), sourceTab, definition: id, pages: [...new Set([...owners.map(p => p.pageId), ...ids])] };
            context.change(saved);
        });
    }
    catch (error) {
        if (error instanceof DefinitionRollback) return error.impact;
        throw error;
    }
    return null;
}
export function writeAttributes(pageId: string, values: Record<string, AttributeValue>, internal = false): void {
    workspace.requireWorkspace();
    commit.run({ sourceTab: "", history: false, updateModified: false }, context => {
        const plan = new EditChanges();
        plan.attributes(pageId, values, [], internal);
        context.persist(plan);
    });
}
export function cacheAttributes(pageId: string, values: Record<string, AttributeValue>): void {
    workspace.requireWorkspace();
    commit.run({ sourceTab: "", history: false, updateModified: false }, context => {
        const previous = data.statement("SELECT last_modified_at FROM workspace_meta").pluck().get();
        const plan = new EditChanges();
        plan.attributes(pageId, values, [], true);
        context.persist(plan);
        data.statement("UPDATE workspace_meta SET last_modified_at=?").run(previous);
    });
}
export function detachAttributes(pageId: string, ids: string[]): void {
    workspace.requireWorkspace();
    commit.run({ sourceTab: "", history: false, updateModified: false }, context => {
        const plan = new EditChanges();
        plan.attributes(pageId, {}, ids);
        context.persist(plan);
    });
}
export function changePageKind(pageId: string, kind: PageKind): void {
    workspace.requireWorkspace();
    commit.run({ sourceTab: "", history: false, updateModified: false }, context => {
        attributes.persistPageKind(pageId, kind);
        context.change({ pages: [pageId] });
    });
}