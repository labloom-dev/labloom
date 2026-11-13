import { LabloomError } from "../../shared/failure";
import { nowSeconds } from "../../shared/content/time";
import { randomUUID } from "node:crypto";
import { attributeTargets, decodeValue, record, validUUID } from "../../shared/attrs/values";
import { blockText, payload, references, validateBlock, validTarget } from "../../shared/content/blocks";
import { type AttributeDefinition, type AttributeImpact, type AttributeValue } from "../../shared/types/attributes";
import { pageKinds, type Backlink, type BlockDeletion, type ChangePreview, type CommitResult, type ContentBlock, type EditCommit, type KnowledgeChange, type PageKind, type PageRecord, type Placement, type ResolvedTarget, type Target } from "../../shared/types/content";
import { fingerprint } from "./attributes";
import { EditChanges, type RowChanges } from "./changes";
import { type WorkspaceDatabase } from "../storage/database";
import { TimerService } from "./timers";
import { KnowledgeRecords } from "./records";

class DefinitionRollback extends Error {
    constructor(readonly impact: AttributeImpact) { super("definition preview"); }
}
export function checkTab(id: unknown): asserts id is string {
    if (typeof id !== "string" || !id || id.length > 100) throw new LabloomError({ kind: "edit-invalid-session" });
}
const workspaceEffects = new WeakMap<object, (() => void)[]>();
export class KnowledgeService extends KnowledgeRecords {
    onCommitted?: (tab: string, page: string, rows: RowChanges) => void;
    onInvalidated?: (keys: string[], exceptTab?: string) => void;
    readonly timers: TimerService;
    constructor(db: WorkspaceDatabase, timeZone: () => string = () => "system", clock: () => number = Date.now) {
        super(db, timeZone);
        this.timers = new TimerService(this, timeZone, clock);
        this.attributes.onWritten = (pageId, fields) => this.timers.recalculate(pageId, fields);
    }
    onChanged?: (change: KnowledgeChange) => void;
    private get commitEffects(): (() => void)[] {
        let effects = workspaceEffects.get(this.sql);
        if (!effects) {
            effects = [];
            workspaceEffects.set(this.sql, effects);
        }
        return effects;
    }

    transaction<T>(action: () => T): T {
        const start = this.commitEffects.length;
        let result: T;
        try {
            result = this.sql.transaction(action)();
        }
        catch (error) {
            this.commitEffects.splice(start);
            throw error;
        }
        if (!this.sql.inTransaction) for (const effect of this.commitEffects.splice(0)) effect();
        return result;
    }

    afterCommit(action: () => void): void {
        if (this.sql.inTransaction) this.commitEffects.push(action);
        else action();
    }

    invalidateHistory(keys: string[], exceptTab?: string): void {
        this.afterCommit(() => this.onInvalidated?.(keys, exceptTab));
    }

    private writable(id: string): ReturnType<KnowledgeRecords["header"]> {
        const page = this.header(id);
        if (this.flags(id).deleted) throw new LabloomError({ kind: "page-recycled-readonly" });
        return page;
    }

    private planEdit(input: EditCommit): EditChanges {
        if (!record(input) || !Number.isSafeInteger(input.batch) || input.batch < 0 || !Array.isArray(input.blocks) || !record(input.attributes ?? {}) ||
            !Array.isArray(input.detach ?? []) || input.detach?.some(id => typeof id !== "string")) throw new LabloomError({ kind: "edit-invalid-input" });
        checkTab(input.tabId);
        const page = this.writable(input.pageId), plan = new EditChanges(this), submitted = new Set<string>();
        if (page.kind === "feed" && (input.pageChildren?.length || input.blocks.some(block => block.id !== page.titleBlockId || block.children.length))) throw new LabloomError({ kind: "feed-body-forbidden" });
        for (const block of input.blocks) {
            validateBlock(block);
            if (submitted.has(block.id)) throw new LabloomError({ kind: "edit-duplicate-block" });
            submitted.add(block.id);
            const previous = this.blockRow(block.id);
            if (previous?.type === "title" && block.type !== "title" || block.id === page.titleBlockId && block.type !== "title") throw new LabloomError({ kind: "block-title-type" });
            plan.putBlock(block);
        }
        if (input.pageChildren !== undefined) plan.pageChildren(page.id, input.pageChildren);
        for (const id of submitted) {
            if (!this.owners(id).includes(page.id) && !plan.owners(id).includes(page.id)) throw new LabloomError({ kind: "block-not-owned" });
        }
        plan.verifyContainment();
        plan.attributes(page.id, input.attributes ?? {}, input.detach);
        this.validateSchedule(plan, page.id, input.attributes ?? {});
        plan.pages.add(page.id);
        plan.touches.add(page.id);
        return plan;
    }

    private validateSchedule(plan: EditChanges, id: string, attrs: Record<string, AttributeValue>): void {
        if ("schedule_start" in attrs || "schedule_end" in attrs) {
            const start = plan.readValue(id, "schedule_start")?.value, end = plan.readValue(id, "schedule_end")?.value;
            if (typeof start === "number" && typeof end === "number" && end < start) throw new LabloomError({ kind: "schedule-reversed" });
        }
    }

    private preview(plan: EditChanges, action: unknown, deletedBlocks: ChangePreview["deletedBlocks"] = [], manual: string[] = [], positions?: unknown): ChangePreview | null {
        const ids = plan.lostPages();
        if (!ids.length && !deletedBlocks.length && !manual.length) return null;
        const name = (id: string): { id: string; title: string } => ({ id, title: this.title(id) });
        return { token: fingerprint({ action, ids, ...(positions ? { positions, deletedBlocks } : {}) }), recycled: ids.map(name),
            direct: [...new Set([...manual, ...ids.filter(id => plan.direct.has(id))])].map(name), causes: [...plan.causes], deletedBlocks };
    }

    previewEdit(input: EditCommit): ChangePreview | null {
        return this.sql.transaction(() => this.preview(this.planEdit(input), input))();
    }

    finish(plan: EditChanges, pageId: string, tabId: string, batch: number, preview: ChangePreview | null, confirmation?: string, capture?: (rows: RowChanges) => void): CommitResult {
        if (preview && confirmation !== preview.token) return { status: "confirmation", preview };
        this.recycle(plan, preview?.recycled.map(p => p.id) ?? []);
        plan.persist();
        for (const change of plan.timerChanges()) this.timers.recalculate(change.pageId, change.fields);
        this.afterCommit(() => {
            if (capture) capture(plan.rows);
            else this.onCommitted?.(tabId, pageId, plan.rows);
        });
        const changed = plan.changed();
        return { status: "saved", batch, changed, sharedUses: this.sharedUses(changed.blocks) };
    }

    private recycle(plan: EditChanges, ids: string[]): void {
        const now = nowSeconds();
        for (const id of ids) {
            plan.attributes(id, { deleted: true, recycle_reason: "unreachable", recycled_at: now }, [], true);
            plan.touches.add(id);
        }
    }

    transact(tabId: string, action: () => CommitResult): CommitResult {
        checkTab(tabId);
        const result = this.transaction(action);
        if (result.status === "saved" && !this.sql.inTransaction) this.onChanged?.({ sourceTab: tabId, ...result.changed });
        return result;
    }

    commitEdit(input: EditCommit, confirmation?: string): CommitResult {
        return this.transact(input?.tabId, () => {
            const plan = this.planEdit(input);
            return this.finish(plan, input.pageId, input.tabId, input.batch, this.preview(plan, input), confirmation);
        });
    }

    historyCommit(plan: EditChanges, pageId: string, tabId: string, action: unknown, confirmation: string | undefined, moveCursor: (rows: RowChanges) => void): CommitResult {
        plan.pages.add(pageId);
        plan.touches.add(pageId);
        plan.verifyContainment();
        return this.finish(plan, pageId, tabId, 0, this.preview(plan, action), confirmation, moveCursor);
    }

    private writeChildren(plan: EditChanges, source: Target, children: string[]): void {
        if (source.kind === "page") plan.pageChildren(source.id, children);
        else {
            const block = plan.block(source.id);
            if (!block) throw new LabloomError({ kind: "block-container-missing" });
            plan.putBlock({ ...block, children });
        }
    }

    removeEverywhere(plan: EditChanges, id: string): ReturnType<KnowledgeRecords["uses"]> {
        const uses = this.uses(id);
        if (uses.some(u => u.slot === "title")) throw new LabloomError({ kind: "block-title-delete" });
        const containers = new Map(uses.map(u => [u.kind + ":" + u.id, u]));
        for (const container of containers.values()) this.writeChildren(plan, container, plan.children(container).filter(child => child !== id));
        return uses;
    }

    private deletionSubject(block: ContentBlock): string {
        const names: Record<ContentBlock["type"], string> = {
            title: "标题", paragraph: "段落", heading_1: "一级标题", heading_2: "二级标题", heading_3: "三级标题",
            unordered_list: "无序列表项", ordered_list: "有序列表项", blockquote: "引文", callout: "提示块",
            code: "代码块", table: "表格", hr: "分隔线", blocked_reference: "链接引用"
        };
        const target = block.payload.target;
        if (block.type === "blocked_reference" && target) {
            let title: string;
            if (target.kind === "page") title = this.title(target.id);
            else {
                const resolved = this.resolve(target);
                title = resolved?.title || (resolved?.block ? names[resolved.block.type] : "已删除");
            }
            return `指向「${title}」的链接引用`;
        }
        const excerpt = blockText(block).trim().slice(0, 48);
        return excerpt ? `“${excerpt}”` : names[block.type];
    }

    deleteBlock(input: BlockDeletion, confirmation?: string): CommitResult {
        return this.transact(input?.tabId, () => {
            const { pageId, blockId, tabId } = input;
            this.writable(pageId);
            const plan = new EditChanges(this), block = plan.block(blockId), pages = this.owners(blockId);
            if (!block || !pages.includes(pageId)) throw new LabloomError({ kind: "block-delete-not-owned" });
            const uses = this.removeEverywhere(plan, blockId);
            plan.touches.add(pageId);
            plan.blocks.add(blockId);
            for (const id of pages) plan.pages.add(id);
            const links = this.incoming({ kind: "block", id: blockId });
            const deleted = [{ id: blockId, excerpt: this.deletionSubject(block), pages: pages.length, positions: uses.length, links: links.length }];
            const preview = this.preview(plan, input, deleted, [], { uses, links, pages: pages.sort() });
            return this.finish(plan, pageId, tabId, 0, preview, confirmation);
        });
    }

    place(input: Placement, confirmation?: string): CommitResult {
        return this.transact(input?.tabId, () => {
            const { position, action, tabId } = input;
            if (!record(position) || !Number.isSafeInteger(position.index) || position.index < 0 || !validUUID(position.blockId)) throw new LabloomError({ kind: "block-invalid-position" });
            const { pageId, containerId, index } = position;
            if (this.writable(pageId).kind === "feed") throw new LabloomError({ kind: "feed-body-forbidden" });
            const container: Target = { kind: containerId === pageId ? "page" : "block", id: containerId };
            if (container.kind === "block" && !this.owners(containerId).includes(pageId)) throw new LabloomError({ kind: "block-container-not-owned" });
            const plan = new EditChanges(this), children = [...plan.children(container)];
            if (children[index] !== position.blockId) throw new LabloomError({ kind: "block-position-changed" });
            if (action === "insert") {
                const block = plan.block(input.blockId ?? "");
                if (!block || block.type === "title" || !plan.owners(block.id).some(id => !plan.flags(id).deleted)) throw new LabloomError({ kind: "block-sync-unavailable" });
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
            this.writeChildren(plan, container, children);
            plan.verifyContainment();
            plan.pages.add(pageId);
            plan.touches.add(pageId);
            return this.finish(plan, pageId, tabId, 0, this.preview(plan, input), confirmation);
        });
    }

    private selectPages(ids: string[]): string[] {
        if (!Array.isArray(ids) || !ids.length || !ids.every(validUUID)) throw new LabloomError({ kind: "page-invalid-selection" });
        for (const id of ids) this.header(id);
        return [...new Set(ids)];
    }

    trash(ids: string[], tabId: string, confirmation?: string): CommitResult {
        return this.transact(tabId, () => {
            const selected = this.selectPages(ids), plan = new EditChanges(this);
            for (const id of selected) {
                plan.attributes(id, { deleted: true, recycle_reason: "manual_delete", recycled_at: nowSeconds() }, [], true);
                plan.touches.add(id);
            }
            return this.finish(plan, selected[0], tabId, 0, this.preview(plan, { trash: selected, tabId }, [], selected), confirmation);
        });
    }

    restore(ids: string[], tabId: string): CommitResult {
        return this.transact(tabId, () => {
            const selected = this.selectPages(ids), plan = new EditChanges(this);
            for (const id of selected) {
                plan.attributes(id, { deleted: false, recycle_reason: null, recycled_at: null }, [], true);
                if (!plan.reachable({ kind: "page", id }, new Set())) plan.attributes(id, { independent: true }, [], true);
                plan.touches.add(id);
            }
            return this.finish(plan, selected[0], tabId, 0, null);
        });
    }

    touch(id: string): void {
        this.statement("UPDATE page_attrs SET value=CAST(? AS INTEGER) WHERE page_id=? AND attr_id='modified_at'").run(nowSeconds(), id);
    }

    putBlock(block: ContentBlock): void {
        const plan = new EditChanges(this);
        plan.putBlock(block);
        plan.persist();
    }

    create(kind: PageKind = "editable", title = "", initial: Record<string, AttributeValue> = {}, parentId?: string, tabId = ""): PageRecord {
        if (!pageKinds.includes(kind) || typeof title !== "string" || title.length > 1000 || !record(initial)) throw new LabloomError({ kind: "page-invalid-create" });
        const changed = { pages: [] as string[], blocks: [] as string[] };
        const page = this.transaction(() => {
            if (parentId) this.writable(parentId);
            if (kind === "annotation" && initial.annotation_file != null) {
                if (!parentId || this.header(parentId).kind !== "paper") throw new LabloomError({ kind: "annotation-paper-required" });
                const files = this.get(parentId).attributes.paper_files as string[];
                if (!files.includes(String(initial.annotation_file))) throw new LabloomError({ kind: "paper-file-removed" });
            }
            const id = randomUUID(), titleId = randomUUID(), bodyId = randomUUID(), plan = new EditChanges(this);
            for (const block of [{ id: titleId, type: "title" as const, payload: payload("title", title), children: [] },
                ...kind === "feed" ? [] : [{ id: bodyId, type: "paragraph" as const, payload: payload("paragraph"), children: [] }]]) this.putBlock(block);
            this.statement("INSERT INTO pages(id,kind,title_block_id,children) VALUES (?,?,?,?)").run(id, kind, titleId, JSON.stringify(kind === "feed" ? [] : [bodyId]));
            this.attributes.initializePage(id);
            const now = nowSeconds();
            plan.attributes(id, { independent: kind !== "annotation", ...(kind === "task" ? { task_status: "todo", priority: "normal" } : {}), ...(kind === "feed" ? { feed_status: "enabled", feed_refresh: { every: 60, unit: "minute" } } : {}), ...initial, created_at: now, modified_at: now, deleted: false }, [], true);
            this.validateSchedule(plan, id, initial);
            if (parentId && kind === "annotation") {
                if (this.header(parentId).kind !== "paper") throw new LabloomError({ kind: "annotation-paper-required" });
                const current = this.get(parentId).attributes.paper_annotations as string[];
                plan.attributes(parentId, { paper_annotations: [...current, id] }, [], true);
                const before = plan.rows.before["page:" + id] as import("./changes").PagePatch;
                const after = plan.rows.after["page:" + id] as import("./changes").PagePatch;
                after.values ??= {}; after.values.deleted = { value: 0 };
                for (const blockId of [titleId, bodyId]) {
                    const row = this.blockRow(blockId)!;
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
                plan.pageChildren(parentId, [...this.children({ kind: "page", id: parentId }), reference]);
                plan.touches.add(parentId);
            }
            if (!plan.reachable({ kind: "page", id }, new Set())) throw new LabloomError({ kind: "page-retaining-reference-required" });
            plan.persist();
            for (const change of plan.timerChanges()) this.timers.recalculate(change.pageId, change.fields);
            if (parentId && kind === "annotation" && tabId) this.afterCommit(() => this.onCommitted?.(tabId, parentId, plan.rows));
            else if (parentId) this.invalidateHistory(["page:" + parentId]);
            changed.pages = [...plan.pages];
            changed.blocks = [titleId, ...kind === "feed" ? [] : [bodyId], ...plan.blocks];
            return this.get(id);
        });
        if (!this.sql.inTransaction) this.onChanged?.({ sourceTab: tabId, ...changed });
        return page;
    }

    resolve(target: Target): ResolvedTarget | null {
        if (!validTarget(target)) throw new LabloomError({ kind: "reference-invalid" });
        if (target.kind === "block") {
            const plan = new EditChanges(this), block = plan.block(target.id), owners = plan.owners(target.id);
            if (!block || !owners.length) return { status: "deleted", title: "已删除", text: "" };
            const text = blockText(block);
            return { status: owners.every(id => plan.flags(id).deleted) ? "recycled" : "ok", title: text, text, block };
        }
        if (!this.statement("SELECT 1 FROM pages WHERE id=?").get(target.id)) return null;
        const page = this.get(target.id);
        return { title: page.title || "未命名", text: page.excerpt, status: page.attributes.deleted ? "recycled" : "ok" };
    }

    backlinks(id: string): Backlink[] {
        this.header(id);
        const result = new Map<string, Backlink>();
        for (const edge of this.incoming({ kind: "page", id })) {
            const block = edge.sourceKind === "block";
            for (const owner of block ? this.owners(edge.sourceId) : [edge.sourceId]) {
                const before = result.get(owner), fields = [...new Set([...(before?.sourceFields ?? []), ...block ? [] : [edge.sourceField]])];
                result.set(owner, { sourceId: owner, title: this.title(owner), sourceKind: block || before?.sourceKind === "reference" ? "reference" : "attribute", ...(fields.length ? { sourceFields: fields } : {}), deleted: this.flags(owner).deleted });
            }
        }
        return [...result.values()];
    }

    rebuildLinks(): void {
        this.sql.transaction(() => {
            this.statement("DELETE FROM link_refs").run();
            const insert = this.statement("INSERT OR IGNORE INTO link_refs(source_kind,source_id,source_field,target_kind,target_id) VALUES (?,?,?,?,?)");
            const ids = this.statement("SELECT id FROM blocks").pluck().all() as string[];
            for (const block of this.readBatch(ids)) for (const t of references(block)) insert.run("block", block.id, "payload", t.kind, t.id);
            const rows = this.statement("SELECT page_id AS pageId, attr_id AS field, value, type FROM page_attrs JOIN attrs_meta ON attrs_meta.id=attr_id WHERE type IN ('page-link','page-links','file','files') AND value IS NOT NULL").all() as { pageId: string; field: string; value: string; type: AttributeDefinition["type"] }[];
            for (const row of rows) {
                const definition = this.attributes.definition(row.field);
                for (const target of attributeTargets(row.type, decodeValue(definition, row.value))) insert.run("page", row.pageId, row.field, target.kind, target.id);
            }
        })();
    }

    setDefinition(id: string, definition: AttributeDefinition | null, sourceTab: string, token?: string): AttributeImpact | null {
        checkTab(sourceTab);
        let saved: KnowledgeChange | undefined;
        try {
            this.transaction(() => {
                const impact = this.attributes.previewDefinition(id, definition);
                const owners = this.statement("SELECT page_id AS pageId FROM page_attrs WHERE attr_id=?").all(id) as { pageId: string }[];
                const plan = new EditChanges(this);
                const old = this.statement("SELECT type FROM attrs_meta WHERE id=?").get(id) as { type: string } | undefined;
                const previous = old ? this.attributes.definition(id) : undefined;
                const previousLinks = new Map(owners.map(({ pageId }) => [pageId, this.outgoing({ kind: "page", id: pageId })]));
                this.attributes.applyDefinition(id, definition, impact.token);
                const next = definition ? this.attributes.definition(id) : undefined;
                if ([old?.type, definition?.type].some(type => ["page-link", "page-links", "file", "files"].includes(type ?? ""))) {
                    for (const { pageId } of owners) {
                        const value = plan.readValue(pageId, id)?.value;
                        const targets = next && value !== undefined ? attributeTargets(next.type, decodeValue(next, value)) : [];
                        plan.setLinks({ kind: "page", id: pageId }, id, targets, previousLinks.get(pageId));
                    }
                }
                const ids = plan.lostPages();
                const combined: AttributeImpact = { ...impact, token: fingerprint({ impact: impact.token, ids }), recycled: ids.map(id => ({ id, title: this.title(id) })) };
                if ((impact.pages.length || ids.length) && token !== combined.token) throw new DefinitionRollback(combined);
                this.recycle(plan, ids);
                plan.persist();
                for (const change of plan.timerChanges()) this.timers.recalculate(change.pageId, change.fields);
                if (previous?.type !== next?.type) for (const { pageId } of owners) this.timers.recalculate(pageId, [id]);
                const removedOptions = previous?.metadata.options?.some(option => !next?.metadata.options?.some(value => value.id === option.id));
                this.invalidateHistory([...new Set([...impact.pages.map(p => p.id), ...ids])].map(id => "page:" + id)
                    .concat(!next || previous?.type !== next.type || removedOptions ? ["attribute:" + id] : []));
                saved = { ...plan.changed(), sourceTab, definition: id, pages: [...new Set([...owners.map(p => p.pageId), ...ids])] };
            });
        }
        catch (error) {
            if (error instanceof DefinitionRollback) return error.impact;
            throw error;
        }
        if (saved) this.onChanged?.(saved);
        return null;
    }
}