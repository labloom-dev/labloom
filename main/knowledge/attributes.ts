import { nowSeconds } from "../../shared/content/time";
import { createHash } from "node:crypto";
import { eq, inArray, placeholder, sql } from "drizzle-orm";
import { builtinAttrs, builtinAttrsByPageKind, isBuiltin } from "../../shared/attrs/builtins";
import { decodeValue, encodeValue, validUUID, validateDefinition, validateValue } from "../../shared/attrs/values";
import { type AttributeDefinition, type AttributeImpact, type AttributeValue } from "../../shared/types/attributes";
import { type PageKind } from "../../shared/types/content";
import { type WorkspaceDatabase } from "../storage/database";
import { attrs, pageAttrs, pages, blocks } from "../storage/tables";

export function fingerprint(value: unknown): string {
    const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered)
        : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : item;
    return createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex");
}

export class AttributeService {
    private readonly byId;
    constructor(readonly db: WorkspaceDatabase) {
        this.byId = db.select().from(attrs).where(eq(attrs.id, placeholder("id"))).prepare();
    }

    private decodeDefinition(row: typeof attrs.$inferSelect): AttributeDefinition {
        const definition = row as AttributeDefinition;
        validateDefinition(definition);
        if (!isBuiltin(row.id)) return definition;
        const base = builtinAttrs[row.id].metadata;
        return { ...definition, metadata: { ...definition.metadata, ...(Object.hasOwn(base, "readonly") ? { readonly: true } : {}), ...(Object.hasOwn(base, "hidden") ? { hidden: true } : {}) } };
    }

    definitions(): AttributeDefinition[] {
        return this.db.select().from(attrs).all().map(row => this.decodeDefinition(row));
    }

    definition(id: string): AttributeDefinition {
        const row = this.byId.get({ id });
        if (!row) throw new Error("属性定义不存在。");
        return this.decodeDefinition(row);
    }

    values(pageId: string): Record<string, AttributeValue> {
        const definitions = new Map(this.definitions().map(definition => [definition.id, definition]));
        return Object.fromEntries(this.db.select().from(pageAttrs).where(eq(pageAttrs.pageId, pageId)).all().map(row => [row.attrId, decodeValue(definitions.get(row.attrId)!, row.value)]));
    }

    write(pageId: string, values: Record<string, AttributeValue>, internal = false): void {
        this.db.$client.transaction(() => this.writeValues(pageId, values, internal))();
    }

    private writeValues(pageId: string, values: Record<string, AttributeValue>, internal: boolean): void {
        const page = this.db.select().from(pages).where(eq(pages.id, pageId)).get();
        if (!page) throw new Error("页面不存在。");
        const allowed = builtinAttrsByPageKind[page.kind as PageKind] as readonly string[];
        const definitions = new Map(this.definitions().map(definition => [definition.id, definition]));
        for (const [id, value] of Object.entries(values)) {
            const definition = definitions.get(id);
            if (!definition) throw new Error("属性定义不存在。");
            if (isBuiltin(id) && !allowed?.includes(id)) throw new Error("此页面类型不支持该内置属性。");
            if (!internal && (definition.metadata.readonly || id === "deleted")) throw new Error("此属性由相应业务操作维护。");
            const encoded = encodeValue(definition, value);
            const stored = definition.type === "datetime" ? sql`CAST(${encoded} AS INTEGER)` : encoded;
            this.db.insert(pageAttrs).values({ pageId, attrId: id, value: stored }).onConflictDoUpdate({ target: [pageAttrs.pageId, pageAttrs.attrId], set: { value: stored } }).run();
        }
    }

    detach(pageId: string, ids: string[]): void {
        if (ids.some(isBuiltin)) throw new Error("内置属性不能从页面移除。");
        for (const id of ids) {
            this.db.$client.prepare("DELETE FROM page_attrs WHERE page_id = ? AND attr_id = ?").run(pageId, id);
        }
    }

    previewDefinition(id: string, input: AttributeDefinition | null): AttributeImpact {
        if (input) {
            validateDefinition(input);
            if (id !== input.id) throw new Error("属性标识不可更改。");
        }
        if (isBuiltin(id)) {
            const base = builtinAttrs[id];
            if (!input || input.type !== base.type) throw new Error("内置属性不能删除或改型。");
            if (id !== "tags" && "options" in base.metadata && fingerprint(input.metadata.options) !== fingerprint(base.metadata.options)) throw new Error("此内置属性的选项由应用定义。");
        }
        else if (!id.startsWith("custom:") || !validUUID(id.slice(7))) throw new Error("自定义属性必须使用 custom:UUID 标识。");
        const before = this.db.select().from(attrs).where(eq(attrs.id, id)).get();
        const rows = this.db.select().from(pageAttrs).where(eq(pageAttrs.attrId, id)).all();
        const affected = rows.filter(row => {
            if (!input || before?.type !== input.type) return true;
            try {
                decodeValue(input, row.value);
                return false;
            }
            catch {
                return true;
            }
        });
        const titles = new Map((affected.length ? this.db.select({ id: pages.id, title: blocks.content }).from(pages).innerJoin(blocks, eq(pages.titleBlockId, blocks.id)).where(inArray(pages.id, affected.map(row => row.pageId))).all() : []).map(row => {
            let title = row.title ?? "";
            try {
                const body = JSON.parse(title);
                title = body.inline?.map((node: { text?: string }) => node.text ?? "").join("") ?? title;
            }
            catch { /* Legacy title text remains readable. */ }
            return [row.id, title || "未命名"];
        }));
        return { token: fingerprint({ id, input, before: before ?? null, rows }), pages: affected.map(row => ({ id: row.pageId, title: titles.get(row.pageId) ?? "未命名" })) };
    }

    applyDefinition(id: string, input: AttributeDefinition | null, token?: string): AttributeImpact | null {
        return this.db.$client.transaction(() => {
            const impact = this.previewDefinition(id, input);
            if (impact.pages.length && token !== impact.token) return impact;
            const before = this.db.select().from(attrs).where(eq(attrs.id, id)).get() as AttributeDefinition | undefined;
            const rows = this.db.select().from(pageAttrs).where(eq(pageAttrs.attrId, id)).all();
            if (!input) {
                this.db.delete(pageAttrs).where(eq(pageAttrs.attrId, id)).run();
                this.db.delete(attrs).where(eq(attrs.id, id)).run();
            }
            else {
                this.db.insert(attrs).values(input).onConflictDoUpdate({ target: attrs.id, set: { type: input.type, metadata: input.metadata } }).run();
                for (const row of rows) {
                    if (row.value === null) continue;
                    let value: AttributeValue = null;
                    try {
                        value = before ? decodeValue(before, row.value) : null;
                        if (input.type === "multiselect" && Array.isArray(value)) value = value.filter(id => input.metadata.options?.some(option => option.id === id));
                        validateValue(input, value);
                    }
                    catch {
                        value = null;
                    }
                    this.write(row.pageId, { [id]: value }, true);
                }
            }
            for (const page of impact.pages) this.write(page.id, { modified_at: nowSeconds() }, true);
            return null;
        })();
    }
}