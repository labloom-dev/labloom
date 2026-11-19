import { attributeTargetKind, attributeTargets, decodeValue, validUUID } from "../../shared/attrs/values";
import { changedUses, references, validateBlock } from "../../shared/content/blocks";
import { isTimeType } from "../../shared/content/time";
import { LabloomError } from "../../shared/failure";
import { type AttributeDefinition, type AttributeValue } from "../../shared/types/attributes";
import { type Changed, type ContentBlock, type LinkTarget, type Target } from "../../shared/types/content";
import * as workspace from "../workspace-state";
import * as attributes from "./attributes";
import * as data from "./records";
import { decodeBlock, type BlockRow, type LinkRow } from "./records";

export type ValueRow = { value: string | number | null };
export type PagePatch = { creation?: true; children?: string[]; values?: Record<string, ValueRow | null> };
export type StoredState = Record<string, BlockRow | PagePatch | null>;
export type RowChanges = { before: StoredState; after: StoredState };
export type TimerChange = { pageId: string; fields: string[] };
const key = (t: LinkTarget): string => t.kind + ":" + t.id;
const targetOf = (l: LinkRow): LinkTarget => ({ kind: l.targetKind, id: l.targetId });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export class EditChanges {
    readonly rows: RowChanges = { before: {}, after: {} };
    readonly pages = new Set<string>();
    readonly blocks = new Set<string>();
    private readonly backlinkPages = new Set<string>();
    private readonly highlightPages = new Set<string>();
    readonly causes = new Set<string>();
    readonly direct = new Set<string>();
    readonly seeds: Target[] = [];
    readonly touches = new Set<string>();
    readonly recycleSources = new Set<string>();
    private readonly links = new Map<string, { source: Target; field: string; targets: LinkTarget[] }>();
    private readonly containers = new Map<string, { source: Target; before: string[]; after: string[] }>();
    private readonly ownersCache = new Map<string, string[]>();
    private readonly flagCache = new Map<string, { deleted: boolean; independent: boolean }>();
    private readonly schedules = new Map<string, Set<string>>();

    constructor() {
        workspace.requireWorkspace();
    }

    changed(): Changed {
        return {
            pages: [...new Set([...this.pages, ...this.highlightPages])], blocks: [...this.blocks], ...(this.backlinkPages.size ? { backlinks: [...this.backlinkPages] } : {}),
            ...(this.highlightPages.size ? { highlightPages: [...this.highlightPages] } : {})
        };
    }

    block(id: string): ContentBlock | null {
        const row = this.rows.after["block:" + id] as BlockRow | null | undefined;
        const value = row === undefined ? data.blockRow(id) : row;
        return value ? decodeBlock(value) : null;
    }

    children(source: Target): string[] {
        return this.containers.get(key(source))?.after ?? data.children(source);
    }

    private markTargets(target: LinkTarget): void {
        if (target.kind === "page") this.direct.add(target.id);
        else if (target.kind === "block") for (const id of data.owners(target.id)) this.direct.add(id);
    }

    private setChildren(source: Target, before: string[], after: string[]): void {
        this.containers.set(key(source), { source, before, after });
        this.ownersCache.clear();
        for (const [id, delta] of changedUses(before, after)) {
            this.blocks.add(id);
            if (delta > 0) continue;
            this.seeds.push({ kind: "block", id });
            this.causes.add(id);
            if (source.kind === "block") this.causes.add(source.id);
            // The removed occurrence may itself be a reference or contain one.
            for (const edge of data.outgoing({ kind: "block", id })) this.markTargets(targetOf(edge));
        }
    }

    setLinks(source: Target, field: string, targets: LinkTarget[], previousRows = data.outgoing(source)): void {
        const unique = new Map(targets.map(t => [key(t), t]));
        this.links.set(key(source) + ":" + field, { source, field, targets: [...unique.values()] });
        const existing = new Set<string>();
        for (const row of previousRows) {
            if (row.sourceField !== field) continue;
            const previous = targetOf(row);
            existing.add(key(previous));
            if (!unique.has(key(previous))) {
                if (previous.kind === "page") this.backlinkPages.add(previous.id);
                if (previous.kind !== "file") this.seeds.push(previous as Target);
                this.markTargets(previous);
                this.causes.add(source.kind === "block" ? source.id : "attribute:" + field);
            }
        }
        for (const [id, target] of unique) if (target.kind === "page" && !existing.has(id)) this.backlinkPages.add(target.id);
    }

    putBlock(value: ContentBlock, stored?: BlockRow): void {
        validateBlock(value);
        if (value.children.length && data.owners(value.id).some(id => data.header(id).kind === "feed")) throw new LabloomError({ kind: "feed-body-forbidden" });
        const id = "block:" + value.id;
        const before = data.blockRow(value.id);
        const after: BlockRow = stored ?? { id: value.id, type: value.type, content: JSON.stringify(value.payload), children: value.children };
        if (same(before, after)) return;
        this.rows.before[id] = before;
        this.rows.after[id] = after;
        this.blocks.add(value.id);
        if (!same(before?.children ?? [], value.children)) this.setChildren({ kind: "block", id: value.id }, before?.children ?? [], value.children);
        this.setLinks({ kind: "block", id: value.id }, "payload", references(value));
    }

    private pageChanges(side: "before" | "after", id: string): PagePatch {
        const rows = this.rows[side], object = "page:" + id;
        return (rows[object] ??= {}) as PagePatch;
    }

    pageChildren(id: string, children: string[]): void {
        if (children.length && data.header(id).kind === "feed") throw new LabloomError({ kind: "feed-body-forbidden" });
        if (!Array.isArray(children) || !children.every(validUUID)) throw new LabloomError({ kind: "page-invalid-children" });
        const source: Target = { kind: "page", id }, before = data.children(source);
        if (same(before, children)) return;
        this.pageChanges("before", id).children = before;
        this.pageChanges("after", id).children = children;
        this.pages.add(id);
        this.setChildren(source, before, children);
    }

    readValue(pageId: string, id: string): ValueRow | null {
        const after = (this.rows.after["page:" + pageId] as PagePatch | undefined)?.values;
        if (after && Object.hasOwn(after, id)) return after[id];
        return data.statement("SELECT value FROM page_attrs WHERE page_id=? AND attr_id=?").get(pageId, id) as ValueRow ?? null;
    }

    setValue(pageId: string, id: string, value: ValueRow | null, def: AttributeDefinition): void {
        const before = this.readValue(pageId, id);
        if (same(before, value)) return;
        if (isTimeType(def.type) || def.type === "status" || ["deleted", "feed_url", "feed_status", "feed_refresh"].includes(id)) {
            const fields = this.schedules.get(pageId) ?? new Set<string>();
            fields.add(id); this.schedules.set(pageId, fields);
        }
        const prev = this.pageChanges("before", pageId), next = this.pageChanges("after", pageId);
        prev.values ??= {};
        if (!Object.hasOwn(prev.values, id)) prev.values[id] = before;
        (next.values ??= {})[id] = value;
        this.pages.add(pageId);
        this.flagCache.delete(pageId);
        if (attributeTargetKind(def.type)) this.setLinks({ kind: "page", id: pageId }, id, attributeTargets(def.type, value ? decodeValue(def, value.value) : null));
        if ((id === "deleted" && value?.value === 1) || (id === "independent" && value?.value === 0 && before?.value === 1)) {
            this.seeds.push({ kind: "page", id: pageId });
            this.direct.add(pageId);
            this.causes.add("attribute:" + id);
            if (id === "deleted") this.recycleSources.add(pageId);
        }
    }

    attributes(pageId: string, values: Record<string, AttributeValue>, detach: string[] = [], internal = false): void {
        if (!Object.keys(values).length && !detach.length) return;
        for (const { id, definition, row } of attributes.prepareValues(pageId, values, detach, internal)) this.setValue(pageId, id, row, definition);
    }

    timerChanges(): TimerChange[] {
        const changes = new Map([...this.schedules].map(([id, fields]) => [id, new Set(fields)]));
        for (const id of this.touches) (changes.get(id) ?? changes.set(id, new Set()).get(id)!).add("modified_at");
        return [...changes].map(([pageId, fields]) => ({ pageId, fields: [...fields] }));
    }

    flags(id: string): { deleted: boolean; independent: boolean } {
        let flags = this.flagCache.get(id);
        if (!flags) {
            flags = data.flags(id);
            const values = (this.rows.after["page:" + id] as PagePatch | undefined)?.values;
            if (values?.deleted) flags.deleted = values.deleted.value === 1;
            if (values?.independent) flags.independent = values.independent.value === 1;
            this.flagCache.set(id, flags);
        }
        return flags;
    }

    parents(id: string): Target[] {
        const result = new Map<string, Target>();
        for (const parent of data.uses(id)) result.set(key(parent), { kind: parent.kind, id: parent.id });
        for (const { source, before, after } of this.containers.values()) {
            if (after.includes(id)) result.set(key(source), source);
            else if (before.includes(id)) result.delete(key(source));
        }
        return [...result.values()];
    }

    owners(id: string): string[] {
        const cached = this.ownersCache.get(id);
        if (cached) return cached;
        if (!this.containers.size) {
            const owners = data.owners(id);
            this.ownersCache.set(id, owners);
            return owners;
        }
        const pages = new Set<string>(), seen = new Set<string>(), queue = [id];
        while (queue.length) {
            const next = queue.pop()!;
            if (seen.has(next)) continue;
            seen.add(next);
            for (const parent of this.parents(next)) {
                if (parent.kind === "page") pages.add(parent.id);
                else queue.push(parent.id);
            }
        }
        const owners = [...pages];
        this.ownersCache.set(id, owners);
        return owners;
    }

    outgoing(source: Target): LinkTarget[] {
        const rows = data.outgoing(source).filter(r => !this.links.has(key(source) + ":" + r.sourceField)).map(targetOf);
        for (const change of this.links.values()) if (key(change.source) === key(source)) rows.push(...change.targets);
        return rows;
    }

    incoming(t: Target): Target[] {
        const result: Target[] = [];
        for (const edge of data.incoming(t)) {
            const source = { kind: edge.sourceKind, id: edge.sourceId };
            if (!this.links.has(key(source) + ":" + edge.sourceField)) result.push(source);
        }
        for (const change of this.links.values()) if (change.targets.some(v => key(v) === key(t))) result.push(change.source);
        return result;
    }





    verifyContainment(): void {
        for (const { source, before, after } of this.containers.values()) {
            if (source.kind !== "block") continue;
            const existing = new Set(before), queue = after.filter(id => !existing.has(id)), seen = new Set<string>();
            while (queue.length) {
                const id = queue.pop()!;
                if (id === source.id) throw new LabloomError({ kind: "block-cycle" });
                if (seen.has(id)) continue;
                seen.add(id);
                queue.push(...this.children({ kind: "block", id }));
            }
        }
    }

    persist(): void {
        for (const id of this.pages) if (data.header(id).kind === "annotation") {
            for (const link of data.incoming({ kind: "page", id })) if (link.sourceKind === "page" && link.sourceField === "paper_annotations") this.highlightPages.add(link.sourceId);
        }
        for (const [id, value] of Object.entries(this.rows.after)) {
            if (!value) continue;
            if ("content" in value) {
                const before = this.rows.before[id];
                if (before && "content" in before && same(before.children, value.children)) {
                    data.statement("UPDATE blocks SET type=?,content=? WHERE id=?").run(value.type, value.content, value.id);
                }
                else data.statement("INSERT INTO blocks(id,type,content,children) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type, content=excluded.content, children=excluded.children")
                    .run(value.id, value.type, value.content, JSON.stringify(value.children));
            }
            else {
                const pageId = id.slice(5);
                if (value.children) data.statement("UPDATE pages SET children=? WHERE id=?").run(JSON.stringify(value.children), pageId);
                for (const [attrId, attr] of Object.entries(value.values ?? {})) {
                    if (attr) data.statement("INSERT INTO page_attrs(page_id,attr_id,value) VALUES (?,?,?) ON CONFLICT(page_id,attr_id) DO UPDATE SET value=excluded.value").run(pageId, attrId, typeof attr.value === "number" && Number.isSafeInteger(attr.value) ? BigInt(attr.value) : attr.value);
                    else data.statement("DELETE FROM page_attrs WHERE page_id=? AND attr_id=?").run(pageId, attrId);
                }
            }
        }
        for (const { source, field, targets } of this.links.values()) {
            data.statement("DELETE FROM link_refs WHERE source_kind=? AND source_id=? AND source_field=?").run(source.kind, source.id, field);
            for (const t of targets) data.statement("INSERT INTO link_refs(source_kind,source_id,source_field,target_kind,target_id) VALUES (?,?,?,?,?)").run(source.kind, source.id, field, t.kind, t.id);
        }
        const now = workspace.seconds();
        for (const id of this.touches) data.statement("UPDATE page_attrs SET value=CAST(? AS INTEGER) WHERE page_id=? AND attr_id='modified_at' AND value IS NOT CAST(? AS INTEGER)").run(now, id, now);
    }
}