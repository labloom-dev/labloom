import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { decodeValue, record, validUUID } from "../../shared/attrs/values";
import { assertAcyclic, blockText, payload, references, validateBlock } from "../../shared/content/blocks";
import { containedBlocks, pageTargets, unreachablePages } from "../../shared/content/lifecycle";
import { type AttributeDefinition, type AttributeImpact, type AttributeValue } from "../../shared/types/attributes";
import { pageKinds, type Backlink, type ChangePreview, type CommitResult, type ContentBlock, type EditPage, type Mutation, type PageKind, type PageList, type PageQuery, type PageRecord, type PageSummary } from "../../shared/types/content";
import { type WorkspaceDatabase } from "../storage/database";
import { blocks, pages, linkIndex, pageAttrs } from "../storage/tables";
import { AttributeService, fingerprint } from "./attributes";

export type PageRow = typeof pages.$inferSelect;
export type BlockRow = typeof blocks.$inferSelect;
export type StoredState = Record<string, BlockRow | { page: PageRow; attrs: (typeof pageAttrs.$inferSelect)[] } | null>;
class PreviewRollback extends Error {
    constructor(readonly preview: ChangePreview) {
        super("preview");
    }
}
class DefinitionRollback extends Error {
    constructor(readonly impact: AttributeImpact) {
        super("definition preview");
    }
}

export class KnowledgeService {
    readonly attributes: AttributeService;
    onCommitted?: (before: StoredState, after: StoredState, tabId: string, pageId: string) => void;
    onInvalidated?: (keys: string[]) => void;
    onDefinitionChanged?: (id: string, next: AttributeDefinition | null, typeChanged: boolean) => void;
    onScheduled?: (before: StoredState, after: StoredState) => void;

    constructor(readonly db: WorkspaceDatabase) {
        this.attributes = new AttributeService(db);
    }

    readBlocks(): Map<string, ContentBlock> {
        return new Map(this.db.select().from(blocks).all().map(row => {
            let body = payload(row.type as ContentBlock["type"], row.content ?? "");
            // The original reference block had no target field.
            if (row.type === "blocked_reference") body.target = null;
            if (row.content) {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(row.content);
                }
                catch { /* Legacy plain text is upgraded only when that block is edited. */ }
                if (record(parsed) && parsed.type === row.type && "schemaVersion" in parsed) {
                    if (parsed.schemaVersion !== 1) throw new Error("块内容来自不支持的格式版本，原内容未被修改。");
                    body = parsed as ContentBlock["payload"];
                }
            }
            const block: ContentBlock = { id: row.id, type: row.type as ContentBlock["type"], payload: body, children: row.children };
            validateBlock(block);
            return [row.id, block];
        }));
    }

    graphPages(): (PageRow & { attributes: Record<string, AttributeValue> })[] {
        const definitions = new Map(this.attributes.definitions().map(definition => [definition.id, definition]));
        const values = new Map<string, Record<string, AttributeValue>>();
        for (const row of this.db.select().from(pageAttrs).all()) {
            let page = values.get(row.pageId);
            if (!page) {
                page = {};
                values.set(row.pageId, page);
            }
            page[row.attrId] = decodeValue(definitions.get(row.attrId)!, row.value);
        }
        return this.db.select().from(pages).all().map(page => ({ ...page, attributes: values.get(page.id) ?? {} }));
    }

    snapshot(): StoredState {
        const state: StoredState = {};
        for (const block of this.db.select().from(blocks).all()) state[`block:${block.id}`] = block;
        const byPage = new Map<string, (typeof pageAttrs.$inferSelect)[]>();
        for (const row of this.db.select().from(pageAttrs).orderBy(pageAttrs.attrId).all()) {
            if (row.attrId === "reading_position" || row.attrId === "modified_at") continue;
            const owned = byPage.get(row.pageId) ?? [];
            owned.push(row);
            byPage.set(row.pageId, owned);
        }
        for (const page of this.db.select().from(pages).all()) state[`page:${page.id}`] = { page, attrs: byPage.get(page.id) ?? [] };
        return state;
    }

    private pageRow(id: string): PageRow {
        if (!validUUID(id)) throw new Error("页面 UUID 无效。");
        const page = this.db.select().from(pages).where(eq(pages.id, id)).get();
        if (!page || !pageKinds.includes(page.kind as PageKind)) throw new Error("页面不存在或类型不受支持。");
        return page;
    }

    private summary(row: PageRow, values: Record<string, AttributeValue>, all: Map<string, ContentBlock>): PageSummary {
        const title = all.get(row.titleBlockId);
        return { id: row.id, kind: row.kind as PageKind, title: title ? blockText(title) : "", excerpt: row.children.map(id => all.get(id)).filter((block): block is ContentBlock => !!block).map(blockText).join(" ").slice(0, 240), attributes: values };
    }

    get(id: string): PageRecord {
        const row = this.pageRow(id), all = this.readBlocks();
        const attributes = this.attributes.values(id);
        const visible = [...containedBlocks(row, all)].map(id => all.get(id)).filter((block): block is ContentBlock => !!block);
        const stableAttributes = Object.fromEntries(Object.entries(attributes).filter(([id]) => !["reading_position", "modified_at"].includes(id)));
        return { ...this.summary(row, attributes, all), titleBlockId: row.titleBlockId, children: row.children, blocks: Object.fromEntries(visible.map(block => [block.id, block])), version: fingerprint({ row, attributes: stableAttributes }), blockVersions: Object.fromEntries(visible.map(block => [block.id, fingerprint(block)])) };
    }

    list(query: PageQuery = {}): PageList {
        if (!record(query) || (query.kind && !pageKinds.includes(query.kind)) || (query.keyword !== undefined && typeof query.keyword !== "string")) throw new Error("页面查询无效。");
        const offset = query.offset ?? 0, limit = query.limit ?? 50;
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("分页范围无效。");
        const all = this.readBlocks();
        const keyword = query.keyword?.trim().toLocaleLowerCase();
        const graph = this.graphPages();
        const rows = new Map(graph.map(page => [page.id, page]));
        const definitions = keyword ? this.attributes.definitions() : [];
        const items = graph.map(row => this.summary(row, row.attributes, all)).filter(page => {
            if (!!page.attributes.deleted !== !!query.deleted || (query.kind && page.kind !== query.kind) || (query.pinned !== undefined && !!page.attributes.pinned !== query.pinned)) return false;
            if (query.tags?.some(id => !Array.isArray(page.attributes.tags) || !page.attributes.tags.includes(id))) return false;
            if (query.attributes && Object.entries(query.attributes).some(([id, value]) => !Object.hasOwn(page.attributes, id) || fingerprint(page.attributes[id]) !== fingerprint(value))) return false;
            if (keyword) {
                const row = rows.get(page.id)!;
                const text = [...containedBlocks(row, all)].map(id => all.get(id)).filter((block): block is ContentBlock => !!block).map(blockText).join(" ");
                const labels = definitions.flatMap(definition => {
                    const value = page.attributes[definition.id];
                    return definition.metadata.options?.filter(option => value === option.id || Array.isArray(value) && value.includes(option.id)).map(option => option.name) ?? [];
                }).join(" ");
                if (!`${page.title} ${text} ${JSON.stringify(page.attributes)} ${labels}`.toLocaleLowerCase().includes(keyword)) return false;
            }
            return true;
        });
        items.sort((a, b) => query.sort === "title" ? a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
            : String(b.attributes[query.sort === "created" ? "created_at" : "modified_at"] ?? "").localeCompare(String(a.attributes[query.sort === "created" ? "created_at" : "modified_at"] ?? "")) || a.id.localeCompare(b.id));
        return { items: items.slice(offset, offset + limit), total: items.length };
    }

    putBlock(block: ContentBlock): void {
        validateBlock(block);
        const row = { id: block.id, type: block.type, content: JSON.stringify(block.payload), children: block.children };
        this.db.insert(blocks).values(row).onConflictDoUpdate({ target: blocks.id, set: row }).run();
    }

    create(kind: PageKind = "editable", title = "", initial: Record<string, AttributeValue> = {}, parentId?: string): PageRecord {
        if (!pageKinds.includes(kind) || typeof title !== "string" || title.length > 1000 || !record(initial)) throw new Error("新页面参数无效。");
        return this.db.$client.transaction(() => {
            const id = randomUUID(), titleId = randomUUID(), bodyId = randomUUID();
            this.putBlock({ id: titleId, type: "title", payload: payload("title", title), children: [] });
            this.putBlock({ id: bodyId, type: "paragraph", payload: payload("paragraph"), children: [] });
            this.db.insert(pages).values({ id, kind, titleBlockId: titleId, children: [bodyId] }).run();
            const now = new Date().toISOString();
            const schedule: Record<string, AttributeValue> = kind === "task" || kind === "event" ? { task_status: "todo", priority: "normal", schedule_zone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {};
            this.attributes.write(id, { pinned: false, tags: [], independent: kind !== "annotation", ...schedule, ...initial, deleted: false, created_at: now, modified_at: now }, true);
            this.validateSchedule(id);
            if (parentId) {
                const parent = this.get(parentId);
                if (parent.attributes.deleted) throw new Error("不能在回收站页面内创建入口。");
                const reference = randomUUID();
                this.putBlock({ id: reference, type: "blocked_reference", payload: { ...payload("blocked_reference"), target: { kind: "page", id } }, children: [] });
                this.db.update(pages).set({ children: [...parent.children, reference] }).where(eq(pages.id, parentId)).run();
                this.touch(parentId);
            }
            if (unreachablePages(this.graphPages(), this.readBlocks(), this.attributes.definitions()).includes(id)) throw new Error("非独立页面需要从存活页面建立引用入口。");
            this.rebuildLinks();
            return this.get(id);
        })();
    }

    touch(pageId: string): void {
        this.attributes.write(pageId, { modified_at: new Date().toISOString() }, true);
    }

    private edit(input: EditPage): void {
        if (!record(input) || !Array.isArray(input.blocks ?? []) || !record(input.attributes ?? {}) || !Array.isArray(input.detach ?? [])) throw new Error("页面编辑参数无效。");
        const current = this.get(input.pageId);
        if (current.attributes.deleted) throw new Error("回收站中的页面不能编辑。");
        if (input.version !== current.version) throw new Error("页面已被其他视图修改。当前输入仍保留，请先重新读取或保留副本。");
        const all = this.readBlocks(), previousIds = containedBlocks(current, all);
        const changedIds = new Set<string>();
        for (const change of input.blocks ?? []) {
            validateBlock(change.value);
            if (changedIds.has(change.value.id)) throw new Error("一次编辑只能为同一块提交一份内容。");
            changedIds.add(change.value.id);
            const existing = all.get(change.value.id);
            if (existing ? fingerprint(existing) !== change.version : change.version !== null) throw new Error("同步块已被其他视图修改，不能覆盖较新的内容。");
            if (change.value.type === "source" && existing?.type !== "source") throw new Error("来源片段必须由原文批注创建。");
            if (existing?.type === "source" && fingerprint(existing) !== fingerprint(change.value)) throw new Error("来源片段为只读内容。");
            all.set(change.value.id, change.value);
        }
        const children = input.children ?? current.children;
        if (!Array.isArray(children) || !children.every(validUUID)) throw new Error("页面子块必须是有序 UUID 数组。");
        const nextIds = containedBlocks({ titleBlockId: current.titleBlockId, children }, all);
        for (const id of changedIds) if (!previousIds.has(id) && !nextIds.has(id)) throw new Error("编辑包含不属于当前页面的块。");
        if (all.get(current.titleBlockId)?.type !== "title") throw new Error("页面标题必须保持标题块类型。");
        assertAcyclic(all);
        for (const change of input.blocks ?? []) this.putBlock(change.value);
        if (input.children) this.db.update(pages).set({ children }).where(eq(pages.id, input.pageId)).run();
        this.attributes.write(input.pageId, input.attributes ?? {});
        this.attributes.detach(input.pageId, input.detach ?? []);
        this.validateSchedule(input.pageId);
        this.touch(input.pageId);
    }

    private validateSchedule(id: string): void {
        const attributes = this.attributes.values(id);
        if (attributes.schedule_start && attributes.schedule_end && String(attributes.schedule_end) < String(attributes.schedule_start)) throw new Error("结束时间不能早于开始时间。");
        if (attributes.schedule_zone) {
            try {
                new Intl.DateTimeFormat("zh-CN", { timeZone: String(attributes.schedule_zone) });
            }
            catch {
                throw new Error("时区无效。");
            }
        }
    }

    private apply(mutation: Mutation): { pageId: string; tabId: string; removed: string[] } {
        if (mutation.type === "edit") {
            this.edit(mutation.edit);
            return { pageId: mutation.edit.pageId, tabId: mutation.edit.tabId, removed: [] };
        }
        if (mutation.type === "trash" || mutation.type === "restore") {
            if (!Array.isArray(mutation.ids) || !mutation.ids.length || !mutation.ids.every(validUUID)) throw new Error("页面选择无效。");
            for (const id of mutation.ids) {
                this.pageRow(id);
                this.attributes.write(id, mutation.type === "trash" ? { deleted: true, recycle_reason: "manual_delete", recycled_at: new Date().toISOString() }
                    : { deleted: false, independent: true, recycle_reason: null, recycled_at: null, ...(Object.hasOwn(this.attributes.values(id), "reminder_at") ? { reminder_at: null } : {}) }, true);
                this.touch(id);
            }
            return { pageId: mutation.ids[0], tabId: mutation.tabId, removed: mutation.type === "trash" ? mutation.ids : [] };
        }
        if (mutation.type === "delete-block") {
            const current = this.get(mutation.pageId);
            if (current.attributes.deleted || !current.blocks[mutation.blockId] || current.blockVersions[mutation.blockId] !== mutation.version) throw new Error("待删除的块已变化。");
            if (this.db.select().from(pages).where(eq(pages.titleBlockId, mutation.blockId)).get()) throw new Error("页面标题块不能单独删除。");
            this.db.delete(blocks).where(eq(blocks.id, mutation.blockId)).run();
            this.touch(mutation.pageId);
            return { pageId: mutation.pageId, tabId: mutation.tabId, removed: [mutation.blockId] };
        }
        if (mutation.type !== "place") throw new Error("不支持的编辑操作。");
        const position = mutation.position, current = this.get(position.pageId);
        if (current.attributes.deleted || !Number.isInteger(position.index)) throw new Error("不能修改此位置。");
        if (position.kind === "page" && position.containerId !== current.id) throw new Error("页面位置不匹配。");
        const container = position.kind === "block" ? current.blocks[position.containerId] : null;
        if (position.kind !== "page" && !container) throw new Error("块容器不存在。");
        const children = [...(container?.children ?? current.children)];
        if (fingerprint(children) !== fingerprint(position.children) || position.index < 0 || position.index > children.length) throw new Error("块位置已发生变化，请重新操作。");
        if (mutation.action === "insert") {
            const block = this.readBlocks().get(mutation.blockId ?? "");
            if (!block || block.type === "title") throw new Error("同步块目标不可用。");
            children.splice(position.index, 0, block.id);
        }
        else {
            if (position.index === children.length) throw new Error("此位置没有块。");
            if (mutation.action === "remove") children.splice(position.index, 1);
            else if (mutation.action === "clone" || mutation.action === "duplicate") {
                const block = this.readBlocks().get(children[position.index]);
                if (!block) throw new Error("缺失块不能解除同步。");
                const id = randomUUID();
                this.putBlock({ ...block, id, children: [...block.children] });
                if (mutation.action === "duplicate") children.splice(position.index + 1, 0, id);
                else children[position.index] = id;
            }
            else {
                const target = position.index + (mutation.action === "move-up" ? -1 : mutation.action === "move-down" ? 1 : NaN);
                if (!Number.isInteger(target) || target < 0 || target >= children.length) throw new Error("无法移动到此位置。");
                [children[position.index], children[target]] = [children[target], children[position.index]];
            }
        }
        if (container) this.putBlock({ ...container, children });
        else this.db.update(pages).set({ children }).where(eq(pages.id, current.id)).run();
        assertAcyclic(this.readBlocks());
        this.touch(current.id);
        return { pageId: current.id, tabId: mutation.tabId, removed: [] };
    }

    mutate(mutation: Mutation, confirmation?: string, previewOnly = false): CommitResult {
        if (!record(mutation)) throw new Error("操作参数无效。");
        try {
            return this.db.$client.transaction((): CommitResult => {
                const before = this.snapshot();
                const token = fingerprint({ before, definitions: this.attributes.definitions(), mutation });
                const context = this.apply(mutation);
                if (typeof context.tabId !== "string" || !context.tabId || context.tabId.length > 100) throw new Error("编辑会话无效。");
                const all = this.readBlocks(), graph = this.graphPages();
                const recycled = unreachablePages(graph, all, this.attributes.definitions());
                const describe = (id: string): { id: string; title: string } => ({ id, title: graph.find(page => page.id === id) ? blockText(all.get(graph.find(page => page.id === id)!.titleBlockId)!) || "未命名" : "块" });
                const preview: ChangePreview = { token, recycled: recycled.map(describe), removed: context.removed.map(describe) };
                if (previewOnly || ((recycled.length || context.removed.length) && confirmation !== token)) throw new PreviewRollback(preview);
                for (const id of recycled) this.attributes.write(id, { deleted: true, recycle_reason: "unreachable", recycled_at: new Date().toISOString(), modified_at: new Date().toISOString() }, true);
                this.rebuildLinks();
                const after = this.snapshot();
                this.onScheduled?.(before, after);
                this.onCommitted?.(before, after, context.tabId, context.pageId);
                return { status: "saved", pages: [...new Set([context.pageId, ...recycled, ...context.removed])] };
            })();
        }
        catch (error) {
            if (error instanceof PreviewRollback) return { status: "confirmation", preview: error.preview };
            throw error;
        }
    }

    rebuildLinks(): void {
        this.db.delete(linkIndex).run();
        const all = this.readBlocks();
        for (const block of all.values()) for (const target of references(block)) this.db.insert(linkIndex).values({ sourceKind: "block", sourceId: block.id, sourceField: "payload", targetKind: target.kind, targetId: target.id }).onConflictDoNothing().run();
        const definitions = this.attributes.definitions();
        for (const page of this.graphPages()) for (const definition of definitions) for (const target of pageTargets(page, [definition])) this.db.insert(linkIndex).values({ sourceKind: "page", sourceId: page.id, sourceField: definition.id, targetKind: "page", targetId: target.id }).onConflictDoNothing().run();
    }

    backlinks(id: string): Backlink[] {
        this.pageRow(id);
        const all = this.readBlocks(), graph = this.graphPages();
        const result: Backlink[] = [];
        for (const page of graph) {
            const direct = pageTargets(page, this.attributes.definitions()).some(target => target.id === id);
            const linked = [...containedBlocks(page, all)].some(blockId => {
                const block = all.get(blockId);
                return block && references(block).some(target => target.kind === "page" && target.id === id);
            });
            if (direct || linked) result.push({ sourceId: page.id, title: blockText(all.get(page.titleBlockId)!) || "未命名", sourceKind: linked ? "reference" : "attribute", deleted: !!page.attributes.deleted });
        }
        return result;
    }

    setDefinition(id: string, definition: AttributeDefinition | null, token?: string): AttributeImpact | null {
        try {
            return this.db.$client.transaction(() => {
                const previous = this.attributes.definitions().find(item => item.id === id);
                const impact = this.attributes.previewDefinition(id, definition);
                const before = this.snapshot();
                const combinedToken = fingerprint({ before, impact });
                this.attributes.applyDefinition(id, definition, impact.token);
                const recycled = unreachablePages(this.graphPages(), this.readBlocks(), this.attributes.definitions());
                const combined: AttributeImpact = { ...impact, token: combinedToken, recycled: recycled.map(id => ({ id, title: this.get(id).title || "未命名" })) };
                if ((impact.pages.length || recycled.length) && token !== combinedToken) throw new DefinitionRollback(combined);
                for (const pageId of recycled) this.attributes.write(pageId, { deleted: true, recycle_reason: "unreachable", recycled_at: new Date().toISOString(), modified_at: new Date().toISOString() }, true);
                this.rebuildLinks();
                if (previous) this.onDefinitionChanged?.(id, definition, previous.type !== definition?.type);
                this.onScheduled?.(before, this.snapshot());
                this.onCommitted?.(before, this.snapshot(), "attribute-definition", impact.pages[0]?.id ?? "");
                return null;
            })();
        }
        catch (error) {
            if (error instanceof DefinitionRollback) return error.impact;
            throw error;
        }
    }
}