import { eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { builtinAttrs, builtinAttrsByPageKind, editableBuiltinMetadata, isBuiltin } from "../../shared/attrs/builtins";
import { convertValue } from "../../shared/attrs/convert";
import { resolveAttributeDefinition } from "../../shared/attrs/definitions";
import { attributeTargetKind, attributeTargets, convertMetadata, decodeValue, defaultValue, encodeValue, validUUID, validateDefinition } from "../../shared/attrs/values";
import { resolveTimeZone } from "../../shared/content/time";
import { recurrenceMinutes } from "../../shared/content/timers";
import { LabloomError } from "../../shared/failure";
import { type AttributeDefinition, type AttributeImpact, type AttributeValue } from "../../shared/types/attributes";
import { pageKinds, type PageKind } from "../../shared/types/content";
import { feedURL } from "../../shared/utils/feed";
import { attachments, attrsMeta, blocks, pageAttrs, pages } from "../storage/tables";
import * as workspace from "../workspace-state";
import { statement } from "./records";

export function fingerprint(value: unknown): string {
    const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered)
        : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : item;
    return createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex");
}

type PreparedValue = { id: string; definition: AttributeDefinition; row: { value: string | number | null } | null };

function byId(id: string): typeof attrsMeta.$inferSelect | undefined {
    return workspace.database().select().from(attrsMeta).where(eq(attrsMeta.id, id)).get();
}
export function definitions(): AttributeDefinition[] {
    workspace.requireWorkspace();
    return workspace.database().select().from(attrsMeta).all().map(resolveAttributeDefinition);
}

export function definition(id: string): AttributeDefinition {
    workspace.requireWorkspace();
    const row = byId(id);
    if (!row) throw new LabloomError({ kind: "attribute-missing" });
    return resolveAttributeDefinition(row);
}

export function prepareValues(pageId: string, values: Record<string, AttributeValue>, detach: string[] = [], internal = false): PreparedValue[] {
    workspace.requireWorkspace();
    const page = workspace.database().select({ kind: pages.kind }).from(pages).where(eq(pages.id, pageId)).get();
    if (!page || !pageKinds.includes(page.kind as PageKind)) throw new LabloomError({ kind: "page-unavailable" });
    const allowed: readonly string[] = builtinAttrsByPageKind[page.kind as PageKind];
    const prepared = [...new Set([...Object.keys(values), ...detach])].map(id => {
        const localDefinition = definition(id), removing = detach.includes(id);
        if (isBuiltin(id) && !allowed.includes(id)) throw new LabloomError({ kind: "attribute-unsupported-builtin" });
        if (removing) {
            if (isBuiltin(id) || Object.hasOwn(values, id)) throw new LabloomError({ kind: "attribute-invalid-detach" });
        }
        else if (!internal && (localDefinition.readonly || id === "deleted")) throw new LabloomError({ kind: "attribute-readonly" });
        let value = values[id];
        if (!removing && id === "feed_url" && value !== "") {
            value = feedURL(String(value));
            const duplicate = workspace.database().$client.prepare("SELECT p.page_id FROM page_attrs p JOIN pages ON pages.id=p.page_id WHERE p.attr_id='feed_url' AND pages.kind='feed' AND p.value=? AND p.page_id<>? LIMIT 1").get(value, pageId);
            if (duplicate) throw new LabloomError({ kind: "feed-duplicate" });
        }
        if (!removing && id === "feed_refresh" && value !== null) {
            const minutes = recurrenceMinutes(value);
            if (minutes === null || minutes < 15 || minutes > 1440) throw new LabloomError({ kind: "feed-invalid-interval" });
        }
        const row = removing ? null : { value: encodeValue(localDefinition, value) };
        for (const target of attributeTargets(localDefinition.type, removing ? null : values[id])) {
            if (target.kind === "file" && !workspace.database().select({ id: attachments.id }).from(attachments).where(eq(attachments.id, target.id)).get()) throw new LabloomError({ kind: "attachment-missing" });
        }
        return { id, definition: localDefinition, row };
    });
    validateOwnership(pageId, prepared);
    return prepared;
}

function validateOwnership(pageId: string, values: PreparedValue[]): void {
    const changed = new Set(values.map(item => item.id)), incoming = new Set<string>();
    for (const { id, definition, row } of values) {
        const file = attributeTargetKind(definition.type) === "file" && id !== "annotation_file";
        if (!row || !file && id !== "paper_annotations") continue;
        for (const target of attributeTargets(definition.type, decodeValue(definition, row.value))) {
            const key = target.kind + ":" + target.id;
            const owners = workspace.database().$client.prepare(`SELECT source_id AS pageId,source_field AS attrId FROM link_refs
                WHERE source_kind='page' AND target_kind=? AND target_id=? AND ${file ? "source_field<>'annotation_file'" : "source_field='paper_annotations'"}`).all(target.kind, target.id) as { pageId: string; attrId: string }[];
            if (incoming.has(key) || owners.some(owner => owner.pageId !== pageId || !changed.has(owner.attrId))) {
                throw new LabloomError({ kind: file ? "attachment-owned" : "annotation-owned" });
            }
            if (!file && !workspace.database().$client.prepare("SELECT 1 FROM pages WHERE id=? AND kind='annotation'").get(target.id)) throw new LabloomError({ kind: "annotation-unavailable" });
            incoming.add(key);
        }
    }
}

export function persistValues(pageId: string, values: PreparedValue[]): void {
    workspace.requireWorkspace();
    for (const { id, definition, row } of values) {
        if (!row) statement("DELETE FROM page_attrs WHERE page_id=? AND attr_id=?").run(pageId, id);
        else statement("INSERT INTO page_attrs(page_id,attr_id,value) VALUES (?,?,?) ON CONFLICT(page_id,attr_id) DO UPDATE SET value=excluded.value").run(pageId, id, typeof row.value === "number" && Number.isSafeInteger(row.value) ? BigInt(row.value) : row.value);
        if (attributeTargetKind(definition.type)) {
            workspace.database().$client.prepare("DELETE FROM link_refs WHERE source_kind='page' AND source_id=? AND source_field=?").run(pageId, id);
            const insert = workspace.database().$client.prepare("INSERT INTO link_refs(source_kind,source_id,source_field,target_kind,target_id) VALUES ('page',?,?,?,?)");
            for (const target of attributeTargets(definition.type, row ? decodeValue(definition, row.value) : null)) insert.run(pageId, id, target.kind, target.id);
        }
    }
}

export function initializePage(pageId: string): void {
    workspace.requireWorkspace();
    workspace.database().$client.transaction(() => {
        const page = workspace.database().select({ kind: pages.kind }).from(pages).where(eq(pages.id, pageId)).get();
        if (!page || !pageKinds.includes(page.kind as PageKind)) throw new LabloomError({ kind: "page-unavailable" });
        const insert = workspace.database().$client.prepare("INSERT OR IGNORE INTO page_attrs(page_id,attr_id,value) VALUES (?,?,?)");
        for (const id of builtinAttrsByPageKind[page.kind as PageKind]) {
            const localDefinition = definition(id);
            const value = encodeValue(localDefinition, defaultValue(localDefinition.type));
            insert.run(pageId, id, typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : value);
        }
    })();
}

function prepareDefinition(id: string, input: AttributeDefinition | null, before: AttributeDefinition | undefined): AttributeDefinition | null {
    if (input) {
        if (before && before.type !== input.type) {
            let metadata = convertMetadata(before.type, input.type, before.metadata);
            if (input.type === "status" && input.metadata.options) {
                metadata = { options: input.metadata.options.map(option => ({ ...option, group: option.group ?? "incomplete" })) };
            }
            else if (before.type === "status" && input.type === "select" && input.metadata.options) {
                metadata = { options: input.metadata.options.map(({ id, name }) => ({ id, name })) };
            }
            input = { ...input, metadata };
        }
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
        if (!before && (!id.startsWith("custom:") || !validUUID(id.slice(7)))) throw new LabloomError({ kind: "attribute-invalid-id" });
        if (input && (input.hidden !== undefined || input.readonly !== undefined)) throw new LabloomError({ kind: "attribute-custom-permissions" });
    }
    return input;
}

export function previewDefinition(id: string, input: AttributeDefinition | null): AttributeImpact {
    workspace.requireWorkspace();
    const row = byId(id), before = row ? resolveAttributeDefinition(row) : undefined;
    input = prepareDefinition(id, input, before);
    const rows = workspace.database().select().from(pageAttrs).where(eq(pageAttrs.attrId, id)).all();
    const zone = resolveTimeZone(workspace.timeZone());
    const affected = rows.filter(row => !input || before?.type !== input.type || encodeValue(input, convertStored(before!, input, row.value, zone)) !== row.value);
    const titles = new Map((affected.length ? workspace.database().select({ id: pages.id, title: blocks.content }).from(pages).innerJoin(blocks, eq(pages.titleBlockId, blocks.id)).where(inArray(pages.id, affected.map(row => row.pageId))).all() : []).map(row => {
        const title = row.title ? JSON.parse(row.title).inline?.map((node: { text?: string }) => node.text ?? "").join("") : "";
        return [row.id, title || "未命名"];
    }));
    return { token: fingerprint({ id, input, before: row ?? null, rows, zone }), pages: affected.map(row => ({ id: row.pageId, title: titles.get(row.pageId) ?? "未命名" })) };
}

function convertStored(before: AttributeDefinition, target: AttributeDefinition, stored: unknown, zone: string): AttributeValue {
    try {
        return convertValue(before, target, decodeValue(before, stored), zone);
    }
    catch {
        return defaultValue(target.type);
    }
}

export function persistDefinition(id: string, input: AttributeDefinition | null, token?: string): AttributeImpact | null {
    workspace.requireWorkspace();
    return workspace.database().$client.transaction(() => {
        const impact = previewDefinition(id, input);
        if (impact.pages.length && token !== impact.token) return impact;
        const row = byId(id), before = row ? resolveAttributeDefinition(row) : undefined;
        const next = prepareDefinition(id, input, before);
        const rows = workspace.database().select().from(pageAttrs).where(eq(pageAttrs.attrId, id)).all();
        if (!next) {
            workspace.database().delete(pageAttrs).where(eq(pageAttrs.attrId, id)).run();
            workspace.database().delete(attrsMeta).where(eq(attrsMeta.id, id)).run();
        }
        else {
            if (before && attributeTargetKind(before.type) && !attributeTargetKind(next.type)) workspace.database().$client.prepare("DELETE FROM link_refs WHERE source_kind='page' AND source_field=?").run(id);
            const name = isBuiltin(id) ? null : next.name;
            const metadata = isBuiltin(id) && !editableBuiltinMetadata(id) ? {} : next.metadata;
            workspace.database().insert(attrsMeta).values({ id, type: next.type, name, metadata }).onConflictDoUpdate({ target: attrsMeta.id, set: { type: next.type, name, metadata } }).run();
            const zone = resolveTimeZone(workspace.timeZone());
            for (const row of rows) persistValues(row.pageId, prepareValues(row.pageId, { [id]: convertStored(before!, next, row.value, zone) }, [], true));
        }
        for (const page of impact.pages) persistValues(page.id, prepareValues(page.id, { modified_at: workspace.seconds() }, [], true));
        return null;
    })();
}