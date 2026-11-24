import { type HistorySource } from "../../shared/history/ipc";
import { randomUUID } from "node:crypto";
import { attributeTargets, decodeValue, record, validUUID } from "../../shared/attrs/values";
import { blockText, payload } from "../../shared/content/blocks";
import { nowSeconds } from "../../shared/content/time";
import { LabloomError } from "../../shared/failure";
import { type AttributeDefinition, type AttributeImpact, type AttributeValue } from "../../shared/types/attributes";
import { bodylessPageKinds, pageKinds, type BlockDeletion, type ChangePreview, type CommitResult, type ContentBlock, type EditCommit, type PageKind, type PageRecord, type Placement, type Target } from "../../shared/types/content";
import * as workspace from "../workspace-state";
import * as attributes from "./attributes";
import { fingerprint } from "./attributes";
import { EditChanges, type PagePatch, type RowChanges } from "./changes";
import * as commit from "./commit";
import * as data from "./records";
import * as retention from "./retention";
import * as timerState from "./timer-state";


class DefinitionRollback extends Error {
    constructor(readonly impact: AttributeImpact) {
        super("definition preview");
    }
}
function putBlock(block: ContentBlock): void {
    const plan = new EditChanges();
    plan.putBlock(block);
    plan.persist();
}
export function create(source: HistorySource, title = "", initial: Record<string, AttributeValue> = {}, parentId?: string, kind: "editable" | "paper" = "editable"): PageRecord {
    workspace.requireWorkspace();
    if (!record(initial)) throw new LabloomError({ kind: "page-invalid-attributes" });
    for (const id of Object.keys(initial)) if (attributes.definition(id).readonly || id === "deleted") throw new LabloomError({ kind: "page-create-readonly" });
    return createPage(kind, title, initial, parentId, source);
}
function planEdit(input: EditCommit): EditChanges {
    if (!record(input) || !Number.isSafeInteger(input.batch) || input.batch < 0 || !Array.isArray(input.blocks) || !record(input.attributes ?? {}) ||
        !Array.isArray(input.detach ?? []) || input.detach?.some(id => typeof id !== "string")) throw new LabloomError({ kind: "edit-invalid-input" });
    if (input.sync !== undefined && (!Array.isArray(input.sync) || input.sync.some(id => !validUUID(id) || !syncBlock(id)))) throw new LabloomError({ kind: "block-sync-unavailable" });
    const page = data.writable(input.pageId), plan = new EditChanges(), submitted = new Set<string>();
    const bodyless = bodylessPageKinds.includes(page.kind);
    if (bodyless && input.pageChildren?.length) throw new LabloomError({ kind: "page-body-forbidden" });
    for (const block of input.blocks) {
        let previous: ReturnType<EditChanges["putBlock"]>;
        try {
            previous = plan.putBlock(block);
        }
        catch (error) {
            if (bodyless && error instanceof LabloomError && error.failure.kind === "block-invalid-title") throw new LabloomError({ kind: "page-body-forbidden" });
            throw error;
        }
        if (bodyless && block.id !== page.titleBlockId) throw new LabloomError({ kind: "page-body-forbidden" });
        if (submitted.has(block.id)) throw new LabloomError({ kind: "edit-duplicate-block" });
        submitted.add(block.id);
        if (previous?.type === "title" && block.type !== "title" || block.id === page.titleBlockId && block.type !== "title") throw new LabloomError({ kind: "block-title-type" });
    }
    if (input.pageChildren !== undefined) plan.pageChildren(page.id, input.pageChildren);
    for (const id of submitted) {
        if (!data.owners(id).includes(page.id) && !plan.owners(id).includes(page.id)) throw new LabloomError({ kind: "block-not-owned" });
    }
    plan.verifySync();
    plan.verifyContainment();
    plan.attributes(page.id, input.attributes ?? {}, input.detach);
    plan.pages.add(page.id);
    plan.touches.add(page.id);
    return plan;
}

export function commitEdit(input: EditCommit, source: HistorySource | false, confirmation?: string, writeId?: string): CommitResult {
    workspace.requireWorkspace();
    return commit.edit({ history: source, directPage: input?.pageId, confirmation, writeId }, () => {
        const plan = planEdit(input);
        return commit.finish(plan, input.pageId, input.batch, { action: input });
    });
}

function writeChildren(plan: EditChanges, source: Target, children: string[]): void {
    if (source.kind === "page") plan.pageChildren(source.id, children);
    else {
        const block = plan.block(source.id);
        if (!block) throw new LabloomError({ kind: "block-container-missing" });
        plan.putBlock({ ...block, children });
    }
}

function removeEverywhere(plan: EditChanges, id: string): ReturnType<typeof data["uses"]> {
    workspace.requireWorkspace();
    const uses = data.uses(id);
    if (uses.some(u => u.slot === "title")) throw new LabloomError({ kind: "block-title-delete" });
    const containers = new Map(uses.map(u => [u.kind + ":" + u.id, u]));
    for (const container of containers.values()) {
        if (container.kind === "page") data.writable(container.id);
        else if (data.owners(container.id).every(owner => data.flags(owner).deleted)) throw new LabloomError({ kind: "page-recycled-readonly" });
        writeChildren(plan, container, plan.children(container).filter(child => child !== id));
    }
    return uses;
}

function deletionSubject(block: ContentBlock): string {
    const names: Record<ContentBlock["type"], string> = {
        title: "标题", paragraph: "段落", heading_1: "一级标题", heading_2: "二级标题", heading_3: "三级标题",
        unordered_list: "无序列表项", ordered_list: "有序列表项", blockquote: "引言", callout: "提示块",
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

export function deleteBlock(input: BlockDeletion, source: HistorySource, confirmation?: string, writeId?: string): CommitResult {
    workspace.requireWorkspace();
    return commit.edit({ history: source, confirmation, writeId }, () => {
        const { pageId } = input;
        data.writable(pageId);
        const ids = [...new Set("blockId" in input ? [input.blockId] : input.blockIds)];
        if (!ids.length) throw new LabloomError({ kind: "block-delete-not-owned" });
        const plan = new EditChanges(), deleted: ChangePreview["deletedBlocks"] = [];
        const positions: { uses: data.Use[]; links: data.LinkRow[]; pages: string[] }[] = [];
        for (const id of ids) {
            const block = plan.block(id), pages = data.owners(id);
            if (!block || !pages.includes(pageId)) throw new LabloomError({ kind: "block-delete-not-owned" });
            const uses = removeEverywhere(plan, id), links = data.incoming({ kind: "block", id });
            plan.blocks.add(id);
            for (const owner of pages) plan.pages.add(owner);
            deleted.push({ id, excerpt: deletionSubject(block), pages: pages.length, positions: uses.length, links: links.length });
            positions.push({ uses, links, pages: pages.sort() });
        }
        plan.touches.add(pageId);
        return commit.finish(plan, pageId, 0, { action: input, deletedBlocks: deleted, positions });
    });
}

export function place(input: Placement, source: HistorySource, confirmation?: string, writeId?: string): CommitResult {
    workspace.requireWorkspace();
    return commit.edit({ history: source, confirmation, writeId }, () => {
        const { position, action } = input;
        if (!record(position) || !Number.isSafeInteger(position.index) || position.index < 0 || !validUUID(position.blockId)) throw new LabloomError({ kind: "block-invalid-position" });
        const { pageId, containerId, index } = position;
        if (bodylessPageKinds.includes(data.writable(pageId).kind)) throw new LabloomError({ kind: "page-body-forbidden" });
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
        return commit.finish(plan, pageId, 0, { action: input });
    });
}

function syncBlock(id: string): ContentBlock | null {
    const block = data.blockRow(id);
    return block && block.type !== "title" && data.owners(id).some(owner => !data.flags(owner).deleted) ? data.readBatch([id])[0] : null;
}

export function syncBlocks(workspaceId: string, ids: string[]): ContentBlock[] | null {
    workspace.requireWorkspace();
    if (!Array.isArray(ids) || !ids.length || !ids.every(validUUID)) throw new LabloomError({ kind: "page-invalid-objects" });
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

export function trash(ids: string[], source: HistorySource, confirmation?: string, writeId?: string): CommitResult {
    workspace.requireWorkspace();
    return commit.run({ history: source, confirmation, writeId }, () => {
        if (!Array.isArray(ids) || !ids.length || !ids.every(validUUID)) throw new LabloomError({ kind: "page-invalid-selection" });
        const selected = [...new Set(ids)], serialized = JSON.stringify(selected);
        const recycledSelection = data.statement(`SELECT 1 FROM page_attrs WHERE attr_id='deleted' AND value=1
            AND page_id IN (SELECT value FROM json_each(?)) LIMIT 1`).get(serialized);
        if (recycledSelection) throw new LabloomError({ kind: "page-recycled-readonly" });
        const summaries = data.statement(`SELECT p.id,knowledge_text(b.type,b.content) AS title FROM json_each(?) j
            CROSS JOIN pages p ON p.id=j.value CROSS JOIN blocks b ON b.id=p.title_block_id
            ORDER BY j.key`);
        const direct = summaries.all(serialized) as ChangePreview["direct"];
        if (direct.length !== selected.length) throw new LabloomError({ kind: "page-unavailable" });
        const lost = retention.previewTrash(selected);
        const token = fingerprint({ action: { trash: selected }, ids: lost });
        const recycled = lost.length ? summaries.all(JSON.stringify(lost)) as ChangePreview["recycled"] : [];
        const preview: ChangePreview = { direct, recycled, token, deletedBlocks: [], causes: ["attribute:deleted"] };
        if (confirmation !== token) return { status: "confirmation", preview };
        const plan = new EditChanges();
        for (const id of selected) {
            plan.markManual(id, true);
            plan.touches.add(id);
        }
        return commit.finish(plan, selected[0], 0);
    });
}

export function restorePages(plan: EditChanges, selected: string[]): void {
    const dependents: string[] = [];
    for (const id of selected) {
        const { independent, deleted } = data.flags(id);
        if (!deleted) continue;
        plan.markManual(id, false);
        plan.seed({ kind: "page", id });
        if (!independent) dependents.push(id);
        plan.touches.add(id);
    }
    if (dependents.length) {
        const unreachable = new Set(commit.forecast(plan, dependents).unreachable);
        for (const id of dependents) if (unreachable.has(id)) plan.attributes(id, { independent: true }, [], true);
    }
}

export function restore(ids: string[], source: HistorySource, writeId?: string): CommitResult {
    workspace.requireWorkspace();
    return commit.run({ history: source, writeId, restoring: true }, () => {
        const selected = selectPages(ids), plan = new EditChanges();
        restorePages(plan, selected);
        return commit.finish(plan, selected[0], 0);
    });
}

export function createPage(kind: PageKind = "editable", title = "", initial: Record<string, AttributeValue> = {}, parentId?: string, history?: HistorySource): PageRecord {
    workspace.requireWorkspace();
    if (!pageKinds.includes(kind) || typeof title !== "string" || !record(initial)) throw new LabloomError({ kind: "page-invalid-create" });
    const changed = { pages: [] as string[], blocks: [] as string[] };
    const page = commit.run({ history }, context => {
        if (parentId) data.writable(parentId);
        if (kind === "annotation" && initial.annotation_file != null) {
            if (!parentId || data.header(parentId).kind !== "paper") throw new LabloomError({ kind: "annotation-paper-required" });
            const files = data.get(parentId).attributes.paper_files as string[];
            if (!files.includes(String(initial.annotation_file))) throw new LabloomError({ kind: "paper-file-removed" });
        }
        const id = randomUUID(), titleId = randomUUID(), children: string[] = [], plan = new EditChanges();
        putBlock({ id: titleId, type: "title", payload: payload("title", title), children: [] });
        if (!bodylessPageKinds.includes(kind)) {
            const bodyId = randomUUID();
            putBlock({ id: bodyId, type: "paragraph", payload: payload("paragraph"), children: [] });
            children.push(bodyId);
        }
        data.statement("INSERT INTO pages(id,kind,title_block_id,children) VALUES (?,?,?,?)").run(id, kind, titleId, JSON.stringify(children));
        attributes.initializePage(id);
        const now = nowSeconds();
        plan.attributes(id, {
            ...(kind === "feed" ? { feed_status: "enabled", feed_refresh: { every: 60, unit: "minute" } } : {}), ...initial,
            independent: parentId ? false : initial.independent ?? kind !== "annotation",
            created_at: now, modified_at: now
        }, [], true);
        plan.seed({ kind: "page", id });
        if (parentId && kind === "annotation") {
            if (data.header(parentId).kind !== "paper") throw new LabloomError({ kind: "annotation-paper-required" });
            const current = (data.get(parentId).attributes.paper_annotations as string[]).filter(id =>
                data.statement("SELECT 1 FROM pages WHERE id=?").get(id));
            plan.attributes(parentId, { paper_annotations: [...current, id] }, [], true);
            plan.touches.add(parentId);
        }
        else if (parentId) {
            const reference = randomUUID();
            plan.putBlock({ id: reference, type: "blocked_reference", payload: { ...payload("blocked_reference"), target: { kind: "page", id } }, children: [] });
            plan.pageChildren(parentId, [...data.children({ kind: "page", id: parentId }), reference]);
            plan.touches.add(parentId);
        }
        // A dependent creation is reversible by removing or restoring its retaining
        // edge. The created content may already have other owners when it is undone.
        const pageKey = "page:" + id;
        let rows: RowChanges | undefined;
        if (history) {
            const { [pageKey]: _before, ...before } = plan.rows.before;
            const { [pageKey]: _after, ...after } = plan.rows.after;
            if (!parentId) {
                const independence = (plan.rows.after[pageKey] as PagePatch | undefined)?.values?.independent;
                before[pageKey] = { values: { independent: { value: 0 } } };
                after[pageKey] = { values: { independent: independence ?? { value: 1 } } };
            }
            rows = { before, after };
            plan.dependencies.add(pageKey);
        }
        context.persist(plan, parentId ?? id, rows);
        if (data.flags(id).deleted) throw new LabloomError({ kind: "page-retaining-reference-required" });
        if (!history && parentId && kind !== "annotation") context.invalidate(["page:" + parentId]);
        changed.pages = [...plan.pages];
        changed.blocks = [titleId, ...children, ...plan.blocks];
        context.change(changed);
        return data.get(id);
    });
    return page;
}

function completedOption(definition: AttributeDefinition | undefined, value: AttributeValue | undefined): boolean {
    return definition?.type === "status" && !!definition.metadata.options?.some(option => option.id === value && option.group === "complete");
}

export function setDefinition(id: string, definition: AttributeDefinition | null, token?: string): AttributeImpact | null {
    workspace.requireWorkspace();
    try {
        commit.run({ history: false, confirmation: token }, context => {
            const impact = attributes.previewDefinition(id, definition);
            for (const page of impact.pages) data.writable(page.id);
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
                    plan.setLinks({ kind: "page", id: pageId }, id, targets, previousLinks.get(pageId), false);
                }
            }
            let ids: string[] = [];
            context.persist(plan, undefined, undefined, projected => {
                ids = projected?.changes.filter(row => !row.deleted && row.reason !== null).map(row => row.id) ?? [];
                const combined: AttributeImpact = { ...impact, token: fingerprint({ impact: impact.token, ids }), recycled: ids.map(id => ({ id, title: data.title(id) })) };
                if ((impact.pages.length || ids.length) && token !== combined.token) throw new DefinitionRollback(combined);
            });
            for (const { pageId } of owners) {
                const before = previousValues.get(pageId), after = data.valuesFor([pageId]).get(pageId)?.[id];
                if (completedOption(previous, before) !== completedOption(next, after)) timerState.recalculate(pageId);
                else if (previous?.type !== next?.type || JSON.stringify(before) !== JSON.stringify(after)) timerState.recalculate(pageId, [id, "modified_at"]);
            }
            const removedOptions = previous?.metadata.options?.some(option => !next?.metadata.options?.some(value => value.id === option.id));
            commit.invalidate([...new Set([...impact.pages.map(p => p.id), ...ids])].map(id => "page:" + id)
                .concat(!next || previous?.type !== next.type || removedOptions ? ["attribute:" + id] : []));
            context.change({ definition: id, pages: [...new Set([...owners.map(p => p.pageId), ...ids])] });
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
    commit.run({ history: false, updateModified: false }, context => {
        data.writable(pageId);
        const plan = new EditChanges();
        plan.attributes(pageId, values, [], internal);
        context.persist(plan);
    });
}
export function cacheAttributes(pageId: string, values: Record<string, AttributeValue>): void {
    workspace.requireWorkspace();
    commit.run({ history: false, updateModified: false }, context => {
        data.writable(pageId);
        const previous = data.statement("SELECT last_modified_at FROM workspace_meta").pluck().get();
        const plan = new EditChanges();
        plan.attributes(pageId, values, [], true);
        context.persist(plan);
        data.statement("UPDATE workspace_meta SET last_modified_at=?").run(previous);
    });
}