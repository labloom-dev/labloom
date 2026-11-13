import { LabloomError } from "../../shared/failure";
import { feedURL } from "../../shared/utils/feed";
import { recurrenceMinutes } from "../../shared/content/timers";
import { nowSeconds, resolveTimeZone } from "../../shared/content/time";
import { convertValue } from "../../shared/attrs/convert";
import { createHash } from "node:crypto";
import { eq, inArray, placeholder } from "drizzle-orm";
import { builtinAttrs, builtinAttrsByPageKind, editableBuiltinMetadata, isBuiltin } from "../../shared/attrs/builtins";
import { resolveAttributeDefinition } from "../../shared/attrs/definitions";
import { attributeTargetKind, attributeTargets, convertMetadata, decodeValue, defaultValue, encodeValue, validUUID, validateDefinition } from "../../shared/attrs/values";
import { type AttributeDefinition, type AttributeImpact, type AttributeValue } from "../../shared/types/attributes";
import { pageKinds, type PageKind } from "../../shared/types/content";
import { type WorkspaceDatabase } from "../storage/database";
import { attrsMeta, pageAttrs, pages, blocks, attachments } from "../storage/tables";

export function fingerprint(value: unknown): string {
    const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered)
        : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : item;
    return createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex");
}

type PreparedValue = { id: string; definition: AttributeDefinition; row: { value: string | number | null } | null };

export class AttributeService {
    onWritten?: (pageId: string, fields: string[]) => void;
    private readonly byId;
    private readonly putValue;
    private readonly removeValue;
    constructor(readonly db: WorkspaceDatabase, private readonly timeZone: () => string = () => "system") {
        this.byId = db.select().from(attrsMeta).where(eq(attrsMeta.id, placeholder("id"))).prepare();
        this.putValue = db.$client.prepare("INSERT INTO page_attrs(page_id,attr_id,value) VALUES (?,?,?) ON CONFLICT(page_id,attr_id) DO UPDATE SET value=excluded.value");
        this.removeValue = db.$client.prepare("DELETE FROM page_attrs WHERE page_id=? AND attr_id=?");
    }

    definitions(): AttributeDefinition[] {
        return this.db.select().from(attrsMeta).all().map(resolveAttributeDefinition);
    }

    definition(id: string): AttributeDefinition {
        const row = this.byId.get({ id });
        if (!row) throw new LabloomError({ kind: "attribute-missing" });
        return resolveAttributeDefinition(row);
    }

    values(pageId: string): Record<string, AttributeValue> {
        const definitions = new Map(this.definitions().map(definition => [definition.id, definition]));
        return Object.fromEntries(this.db.select().from(pageAttrs).where(eq(pageAttrs.pageId, pageId)).all().map(row => [row.attrId, decodeValue(definitions.get(row.attrId)!, row.value)]));
    }

    // Page edits, direct service writes and history all use this validation path.
    prepareValues(pageId: string, values: Record<string, AttributeValue>, detach: string[] = [], internal = false): PreparedValue[] {
        const page = this.db.select({ kind: pages.kind }).from(pages).where(eq(pages.id, pageId)).get();
        if (!page || !pageKinds.includes(page.kind as PageKind)) throw new LabloomError({ kind: "page-unavailable" });
        const allowed: readonly string[] = builtinAttrsByPageKind[page.kind as PageKind];
        const prepared = [...new Set([...Object.keys(values), ...detach])].map(id => {
            const definition = this.definition(id), removing = detach.includes(id);
            if (isBuiltin(id) && !allowed.includes(id)) throw new LabloomError({ kind: "attribute-unsupported-builtin" });
            if (removing) {
                if (isBuiltin(id) || Object.hasOwn(values, id)) throw new LabloomError({ kind: "attribute-invalid-detach" });
            }
            else if (!internal && (definition.readonly || id === "deleted")) throw new LabloomError({ kind: "attribute-readonly" });
            let value = values[id];
            if (!removing && id === "feed_url" && value !== "") {
                value = feedURL(String(value));
                const duplicate = this.db.$client.prepare("SELECT p.page_id FROM page_attrs p JOIN pages ON pages.id=p.page_id WHERE p.attr_id='feed_url' AND pages.kind='feed' AND p.value=? AND p.page_id<>? LIMIT 1").get(value, pageId);
                if (duplicate) throw new LabloomError({ kind: "feed-duplicate" });
            }
            if (!removing && id === "feed_refresh" && value !== null) {
                const minutes = recurrenceMinutes(value);
                if (minutes === null || minutes < 15 || minutes > 1440) throw new LabloomError({ kind: "feed-invalid-interval" });
            }
            const row = removing ? null : { value: encodeValue(definition, value) };
            for (const target of attributeTargets(definition.type, removing ? null : values[id])) {
                if (target.kind === "file" && !this.db.select({ id: attachments.id }).from(attachments).where(eq(attachments.id, target.id)).get()) throw new LabloomError({ kind: "attachment-missing" });
            }
            return { id, definition, row };
        });
        this.validateOwnership(pageId, prepared);
        return prepared;
    }

    private validateOwnership(pageId: string, values: PreparedValue[]): void {
        const changed = new Set(values.map(item => item.id)), incoming = new Set<string>();
        for (const { id, definition, row } of values) {
            const file = attributeTargetKind(definition.type) === "file" && id !== "annotation_file";
            if (!row || !file && id !== "paper_annotations") continue;
            for (const target of attributeTargets(definition.type, decodeValue(definition, row.value))) {
                const key = target.kind + ":" + target.id;
                const owners = this.db.$client.prepare(`SELECT source_id AS pageId,source_field AS attrId FROM link_refs
                    WHERE source_kind='page' AND target_kind=? AND target_id=? AND ${file ? "source_field<>'annotation_file'" : "source_field='paper_annotations'"}`).all(target.kind, target.id) as { pageId: string; attrId: string }[];
                if (incoming.has(key) || owners.some(owner => owner.pageId !== pageId || !changed.has(owner.attrId))) {
                    throw new LabloomError({ kind: file ? "attachment-owned" : "annotation-owned" });
                }
                if (!file && !this.db.$client.prepare("SELECT 1 FROM pages WHERE id=? AND kind='annotation'").get(target.id)) throw new LabloomError({ kind: "annotation-unavailable" });
                incoming.add(key);
            }
        }
    }

    private persistValues(pageId: string, values: PreparedValue[]): void {
        for (const { id, definition, row } of values) {
            if (!row) this.removeValue.run(pageId, id);
            else this.putValue.run(pageId, id, typeof row.value === "number" && Number.isSafeInteger(row.value) ? BigInt(row.value) : row.value);
            if (attributeTargetKind(definition.type)) {
                this.db.$client.prepare("DELETE FROM link_refs WHERE source_kind='page' AND source_id=? AND source_field=?").run(pageId, id);
                const insert = this.db.$client.prepare("INSERT INTO link_refs(source_kind,source_id,source_field,target_kind,target_id) VALUES ('page',?,?,?,?)");
                for (const target of attributeTargets(definition.type, row ? decodeValue(definition, row.value) : null)) insert.run(pageId, id, target.kind, target.id);
            }
        }
    }

    write(pageId: string, values: Record<string, AttributeValue>, internal = false): void {
        this.db.$client.transaction(() => {
            const prepared = this.prepareValues(pageId, values, [], internal);
            const get = this.db.$client.prepare("SELECT value FROM page_attrs WHERE page_id=? AND attr_id=?");
            const changed = prepared.filter(item => {
                const before = get.get(pageId, item.id) as { value: unknown } | undefined;
                return !before || before.value !== item.row?.value;
            });
            this.persistValues(pageId, prepared);
            if (changed.length) this.onWritten?.(pageId, changed.map(item => item.id));
        })();
    }

    cache(pageId: string, values: Record<string, AttributeValue>): void {
        this.db.$client.transaction(() => {
            const previous = this.db.$client.prepare("SELECT last_modified_at FROM workspace_meta").pluck().get();
            this.write(pageId, values, true);
            this.db.$client.prepare("UPDATE workspace_meta SET last_modified_at=?").run(previous);
        })();
    }

    detach(pageId: string, ids: string[]): void {
        this.db.$client.transaction(() => this.persistValues(pageId, this.prepareValues(pageId, {}, ids)))();
    }

    initializePage(pageId: string): void {
        this.db.$client.transaction(() => {
            const page = this.db.select({ kind: pages.kind }).from(pages).where(eq(pages.id, pageId)).get();
            if (!page || !pageKinds.includes(page.kind as PageKind)) throw new LabloomError({ kind: "page-unavailable" });
            const insert = this.db.$client.prepare("INSERT OR IGNORE INTO page_attrs(page_id,attr_id,value) VALUES (?,?,?)");
            for (const id of builtinAttrsByPageKind[page.kind as PageKind]) {
                const definition = this.definition(id);
                const value = encodeValue(definition, defaultValue(definition.type));
                insert.run(pageId, id, typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : value);
            }
        })();
    }

    changePageKind(pageId: string, kind: PageKind): void {
        if (!pageKinds.includes(kind)) throw new LabloomError({ kind: "page-invalid-kind" });
        if (kind === "feed") {
            const children = this.db.$client.prepare("SELECT children FROM pages WHERE id=?").pluck().get(pageId) as string | undefined;
            if (children && JSON.parse(children).length) throw new LabloomError({ kind: "feed-body-forbidden" });
        }
        this.db.$client.transaction(() => {
            if (!this.db.update(pages).set({ kind }).where(eq(pages.id, pageId)).run().changes) throw new LabloomError({ kind: "page-missing" });
            this.initializePage(pageId);
        })();
    }

    private prepareDefinition(id: string, input: AttributeDefinition | null, before: AttributeDefinition | undefined): AttributeDefinition | null {
        if (input) {
            if (before && before.type !== input.type) input = { ...input, metadata: convertMetadata(before.type, input.type, before.metadata) };
            validateDefinition(input);
            if (id !== input.id) throw new LabloomError({ kind: "attribute-id-immutable" });
        }
        if (isBuiltin(id)) {
            const base = builtinAttrs[id];
            if (!input || input.type !== base.type) throw new LabloomError({ kind: "attribute-builtin-immutable" });
            if (input.name !== base.name || !!input.hidden !== ("hidden" in base && base.hidden) || !!input.readonly !== ("readonly" in base && base.readonly)) throw new LabloomError({ kind: "attribute-builtin-permissions" });
            if (!editableBuiltinMetadata(id) && fingerprint(input.metadata) !== fingerprint(base.metadata)) throw new LabloomError({ kind: "attribute-fixed-metadata" });
        }
        else {
            if (input?.type === "recurrence") throw new LabloomError({ kind: "attribute-recurrence-reserved" });
            if (!id.startsWith("custom:") || !validUUID(id.slice(7))) throw new LabloomError({ kind: "attribute-invalid-id" });
            if (input && (input.hidden !== undefined || input.readonly !== undefined)) throw new LabloomError({ kind: "attribute-custom-permissions" });
        }
        return input;
    }

    previewDefinition(id: string, input: AttributeDefinition | null): AttributeImpact {
        const row = this.byId.get({ id }), before = row ? resolveAttributeDefinition(row) : undefined;
        input = this.prepareDefinition(id, input, before);
        const rows = this.db.select().from(pageAttrs).where(eq(pageAttrs.attrId, id)).all();
        const zone = resolveTimeZone(this.timeZone());
        const affected = rows.filter(row => !input || before?.type !== input.type || encodeValue(input, this.convertStored(before!, input, row.value, zone)) !== row.value);
        const titles = new Map((affected.length ? this.db.select({ id: pages.id, title: blocks.content }).from(pages).innerJoin(blocks, eq(pages.titleBlockId, blocks.id)).where(inArray(pages.id, affected.map(row => row.pageId))).all() : []).map(row => {
            const title = row.title ? JSON.parse(row.title).inline?.map((node: { text?: string }) => node.text ?? "").join("") : "";
            return [row.id, title || "未命名"];
        }));
        return { token: fingerprint({ id, input, before: row ?? null, rows, zone }), pages: affected.map(row => ({ id: row.pageId, title: titles.get(row.pageId) ?? "未命名" })) };
    }

    private convertStored(before: AttributeDefinition, target: AttributeDefinition, stored: unknown, zone: string): AttributeValue {
        try {
            return convertValue(before, target, decodeValue(before, stored), zone);
        }
        catch {
            return defaultValue(target.type);
        }
    }

    applyDefinition(id: string, input: AttributeDefinition | null, token?: string): AttributeImpact | null {
        return this.db.$client.transaction(() => {
            const impact = this.previewDefinition(id, input);
            if (impact.pages.length && token !== impact.token) return impact;
            const row = this.byId.get({ id }), before = row ? resolveAttributeDefinition(row) : undefined;
            const next = this.prepareDefinition(id, input, before);
            const rows = this.db.select().from(pageAttrs).where(eq(pageAttrs.attrId, id)).all();
            if (!next) {
                this.db.$client.prepare("DELETE FROM link_refs WHERE source_kind='page' AND source_field=?").run(id);
                this.db.delete(pageAttrs).where(eq(pageAttrs.attrId, id)).run();
                this.db.delete(attrsMeta).where(eq(attrsMeta.id, id)).run();
            }
            else {
                if (before && attributeTargetKind(before.type) && !attributeTargetKind(next.type)) this.db.$client.prepare("DELETE FROM link_refs WHERE source_kind='page' AND source_field=?").run(id);
                const name = isBuiltin(id) ? null : next.name;
                const metadata = isBuiltin(id) && !editableBuiltinMetadata(id) ? {} : next.metadata;
                this.db.insert(attrsMeta).values({ id, type: next.type, name, metadata }).onConflictDoUpdate({ target: attrsMeta.id, set: { type: next.type, name, metadata } }).run();
                const zone = resolveTimeZone(this.timeZone());
                for (const row of rows) this.write(row.pageId, { [id]: this.convertStored(before!, next, row.value, zone) }, true);
            }
            for (const page of impact.pages) this.write(page.id, { modified_at: nowSeconds() }, true);
            return null;
        })();
    }
}