import { decodeValue, encodeValue, validUUID } from "../../shared/attrs/values";
import { nowSeconds } from "../../shared/content/time";
import { builtinAttrsByPageKind, isBuiltin } from "../../shared/attrs/builtins";
import { changedUses, references, validateBlock } from "../../shared/content/blocks";
import { type AttributeDefinition, type AttributeValue } from "../../shared/types/attributes";
import { type Changed, type ContentBlock, type PageKind, type Target } from "../../shared/types/content";
import { type highlights } from "../storage/tables";
import { decodeBlock, KnowledgeRecords, type BlockRow, type LinkRow, type PageRow } from "./records";

export type ValueRow = { value: string | number | null };
export type PagePatch = { children?: string[]; values?: Record<string, ValueRow | null> };
export type LegacyPage = { page: PageRow; attrs: { attrId: string; value: string | number | null }[] };
type HighlightRow = typeof highlights.$inferSelect;
export type StoredState = Record<string, BlockRow | PagePatch | LegacyPage | HighlightRow | null>;
export type RowChanges = { before: StoredState; after: StoredState };
export type ReminderValues = { deleted: boolean; at: number | null; zone: string | null };
export type ReminderChange = { pageId: string; before: ReminderValues; after: ReminderValues };
const key = (t: Target): string => t.kind + ":" + t.id;
const targetOf = (l: LinkRow): Target => ({ kind: l.targetKind, id: l.targetId });
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
    private readonly links = new Map<string, { source: Target; field: string; targets: Target[] }>();
    private readonly containers = new Map<string, { source: Target; before: string[]; after: string[] }>();
    private readonly ownersCache = new Map<string, string[]>();
    private readonly flagCache = new Map<string, { deleted: boolean; independent: boolean }>();
    private readonly schedules = new Map<string, ReminderValues>();

    constructor(readonly data: KnowledgeRecords) {}

    changed(): Changed {
        return { pages: [...this.pages], blocks: [...this.blocks], ...(this.backlinkPages.size ? { backlinks: [...this.backlinkPages] } : {}),
            ...(this.highlightPages.size ? { highlightPages: [...this.highlightPages] } : {}) };
    }

    block(id: string): ContentBlock | null {
        const row = this.rows.after["block:" + id] as BlockRow | null | undefined;
        const value = row === undefined ? this.data.blockRow(id) : row;
        return value ? decodeBlock(value) : null;
    }

    children(source: Target): string[] {
        return this.containers.get(key(source))?.after ?? this.data.children(source);
    }

    private markTargets(target: Target): void {
        if (target.kind === "page") this.direct.add(target.id);
        else for (const id of this.data.owners(target.id)) this.direct.add(id);
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
            for (const edge of this.data.outgoing({ kind: "block", id })) this.markTargets(targetOf(edge));
        }
    }

    setLinks(source: Target, field: string, targets: Target[]): void {
        const unique = new Map(targets.map(t => [key(t), t]));
        this.links.set(key(source) + ":" + field, { source, field, targets: [...unique.values()] });
        const existing = new Set<string>();
        for (const row of this.data.outgoing(source)) {
            if (row.sourceField !== field) continue;
            const previous = targetOf(row);
            existing.add(key(previous));
            if (!unique.has(key(previous))) {
                if (previous.kind === "page") this.backlinkPages.add(previous.id);
                this.seeds.push(previous);
                this.markTargets(previous);
                this.causes.add(source.kind === "block" ? source.id : "attribute:" + field);
            }
        }
        for (const [id, target] of unique) if (target.kind === "page" && !existing.has(id)) this.backlinkPages.add(target.id);
    }

    putBlock(value: ContentBlock, stored?: BlockRow): void {
        validateBlock(value);
        const id = "block:" + value.id;
        const before = this.data.blockRow(value.id);
        const after: BlockRow = stored ?? { id: value.id, type: value.type, content: JSON.stringify(value.payload), children: value.children };
        if (same(before, after)) return;
        this.rows.before[id] = before;
        this.rows.after[id] = after;
        this.blocks.add(value.id);
        if (!same(before?.children ?? [], value.children)) this.setChildren({ kind: "block", id: value.id }, before?.children ?? [], value.children);
        this.setLinks({ kind: "block", id: value.id }, "payload", references(value));
    }

    setHighlight(id: string, after: HighlightRow | null, before = this.data.statement("SELECT id, anchor_id AS anchorId, color FROM highlights WHERE id=?").get(id) as HighlightRow | undefined): void {
        const mark = after ?? before;
        if (!mark) return;
        this.rows.before["highlight:" + id] = before ?? null;
        this.rows.after["highlight:" + id] = after;
        const owners = this.data.statement("SELECT DISTINCT p.page_id FROM page_attachments p JOIN anchors a ON a.file_id=p.file_id WHERE a.id=?").pluck().all(mark.anchorId) as string[];
        for (const pageId of owners) {
            this.pages.add(pageId);
            this.highlightPages.add(pageId);
        }
    }

    private pageChanges(side: "before" | "after", id: string): PagePatch {
        const rows = this.rows[side], object = "page:" + id;
        return (rows[object] ??= {}) as PagePatch;
    }

    pageChildren(id: string, children: string[]): void {
        if (!Array.isArray(children) || !children.every(validUUID)) throw new Error("页面子块必须是有序 UUID 数组。");
        const source: Target = { kind: "page", id }, before = this.data.children(source);
        if (same(before, children)) return;
        this.pageChanges("before", id).children = before;
        this.pageChanges("after", id).children = children;
        this.pages.add(id);
        this.setChildren(source, before, children);
    }

    readValue(pageId: string, id: string): ValueRow | null {
        const after = (this.rows.after["page:" + pageId] as PagePatch | undefined)?.values;
        if (after && Object.hasOwn(after, id)) return after[id];
        return this.data.statement("SELECT value FROM page_attrs WHERE page_id=? AND attr_id=?").get(pageId, id) as ValueRow ?? null;
    }

    setValue(pageId: string, id: string, value: ValueRow | null, def: AttributeDefinition): void {
        const before = this.readValue(pageId, id);
        if (same(before, value)) return;
        if (["reminder_at", "schedule_zone", "deleted"].includes(id) && !this.schedules.has(pageId) && ["task", "event"].includes(this.data.header(pageId).kind)) {
            this.schedules.set(pageId, this.reminderValues(pageId));
        }
        const prev = this.pageChanges("before", pageId), next = this.pageChanges("after", pageId);
        prev.values ??= {};
        if (!Object.hasOwn(prev.values, id)) prev.values[id] = before;
        (next.values ??= {})[id] = value;
        this.pages.add(pageId);
        this.flagCache.delete(pageId);
        if (def.type === "page-link" || def.type === "page-links") {
            const decoded = value ? decodeValue(def, value.value) : null;
            const ids = Array.isArray(decoded) ? decoded as string[] : typeof decoded === "string" ? [decoded] : [];
            this.setLinks({ kind: "page", id: pageId }, id, ids.map(id => ({ kind: "page", id })));
        }
        if ((id === "deleted" && value?.value === 1) || (id === "independent" && value?.value === 0 && before?.value !== 0)) {
            this.seeds.push({ kind: "page", id: pageId });
            this.direct.add(pageId);
            this.causes.add("attribute:" + id);
            if (id === "deleted") this.recycleSources.add(pageId);
        }
    }

    attributes(pageId: string, values: Record<string, AttributeValue>, detach: string[] = [], internal = false): void {
        if (!Object.keys(values).length && !detach.length) return;
        const allowed: readonly string[] = builtinAttrsByPageKind[this.data.header(pageId).kind as PageKind];
        for (const id of new Set([...Object.keys(values), ...detach])) {
            const def = this.data.attributes.definition(id);
            if (isBuiltin(id) && !allowed.includes(id)) throw new Error("此页面类型不支持该内置属性。");
            if (!internal && (id === "deleted" || def.metadata.readonly)) throw new Error("此属性由相应业务操作维护。");
            if (detach.includes(id)) {
                if (isBuiltin(id) || Object.hasOwn(values, id)) throw new Error("此属性不能移除。");
                this.setValue(pageId, id, null, def);
            }
            else this.setValue(pageId, id, { value: encodeValue(def, values[id]) }, def);
        }
    }

    private reminderValues(id: string): ReminderValues {
        return { deleted: this.readValue(id, "deleted")?.value === 1, at: this.readValue(id, "reminder_at")?.value as number ?? null,
            zone: this.readValue(id, "schedule_zone")?.value as string ?? null };
    }

    reminderChanges(): ReminderChange[] {
        return [...this.schedules].map(([pageId, before]) => ({ pageId, before, after: this.reminderValues(pageId) }));
    }

    flags(id: string): { deleted: boolean; independent: boolean } {
        let flags = this.flagCache.get(id);
        if (!flags) {
            flags = this.data.flags(id);
            const values = (this.rows.after["page:" + id] as PagePatch | undefined)?.values;
            if (values?.deleted) flags.deleted = values.deleted.value === 1;
            if (values?.independent) flags.independent = values.independent.value !== 0;
            this.flagCache.set(id, flags);
        }
        return flags;
    }

    parents(id: string): Target[] {
        const result = new Map<string, Target>();
        for (const parent of this.data.uses(id)) result.set(key(parent), { kind: parent.kind, id: parent.id });
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
            const owners = this.data.owners(id);
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

    private outgoing(source: Target): Target[] {
        const rows = this.data.outgoing(source).filter(r => !this.links.has(key(source) + ":" + r.sourceField)).map(targetOf);
        for (const change of this.links.values()) if (key(change.source) === key(source)) rows.push(...change.targets);
        return rows;
    }

    private incoming(t: Target): Target[] {
        const result: Target[] = [];
        for (const edge of this.data.incoming(t)) {
            const source = { kind: edge.sourceKind, id: edge.sourceId };
            if (!this.links.has(key(source) + ":" + edge.sourceField)) result.push(source);
        }
        for (const change of this.links.values()) if (change.targets.some(v => key(v) === key(t))) result.push(change.source);
        return result;
    }

    reachable(start: Target, recycled: Set<string>): boolean {
        const seen = new Set<string>(), queue = [start];
        for (let i = 0; i < queue.length; i++) {
            const t = queue[i];
            if (seen.has(key(t))) continue;
            seen.add(key(t));
            if (t.kind === "page") {
                const flags = this.flags(t.id);
                if (flags.deleted || recycled.has(t.id)) continue;
                if (flags.independent) return true;
            }
            else {
                if (!this.owners(t.id).some(id => !this.flags(id).deleted && !recycled.has(id))) continue;
                queue.push(...this.parents(t.id));
            }
            queue.push(...this.incoming(t));
        }
        return false;
    }

    lostPages(): string[] {
        if (!this.seeds.length) return [];
        const candidates = new Set<string>(), inspectedBlocks = new Set<string>(), recycled = new Set<string>();
        const expand = (seeds: Target[]): void => {
            const queue = [...seeds];
            while (queue.length) {
                const t = queue.pop()!;
                if (t.kind === "page") { candidates.add(t.id); continue; }
                if (inspectedBlocks.has(t.id)) continue;
                inspectedBlocks.add(t.id);
                for (const id of this.children(t)) queue.push({ kind: "block", id });
                queue.push(...this.outgoing(t));
            }
        };
        const expandPage = (id: string): void => {
            const t: Target = { kind: "page", id };
            const children = this.children(t);
            expand([...this.outgoing(t), ...[this.data.header(id).titleBlockId, ...children].map(id => ({ kind: "block" as const, id }))]);
        };
        expand(this.seeds);
        for (const id of this.recycleSources) expandPage(id);
        while (true) {
            const lost = [...candidates].filter(id => !recycled.has(id) && !this.flags(id).deleted && !this.reachable({ kind: "page", id }, recycled));
            if (!lost.length) return [...recycled].sort();
            for (const id of lost) { recycled.add(id); expandPage(id); }
        }
    }

    verifyContainment(): void {
        for (const { source, before, after } of this.containers.values()) {
            if (source.kind !== "block") continue;
            const existing = new Set(before), queue = after.filter(id => !existing.has(id)), seen = new Set<string>();
            while (queue.length) {
                const id = queue.pop()!;
                if (id === source.id) throw new Error("块包含关系不能形成循环。");
                if (seen.has(id)) continue;
                seen.add(id);
                queue.push(...this.children({ kind: "block", id }));
            }
        }
    }

    persist(): void {
        for (const [id, value] of Object.entries(this.rows.after)) {
            if (id.startsWith("highlight:") && !value) this.data.statement("DELETE FROM highlights WHERE id=?").run(id.slice("highlight:".length));
            if (!value) continue;
            if ("anchorId" in value) {
                this.data.statement("INSERT INTO highlights(id,anchor_id,color) VALUES (?,?,?)").run(value.id, value.anchorId, value.color);
            }
            else if ("content" in value) {
                this.data.statement("INSERT INTO blocks(id,type,content,children) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type, content=excluded.content, children=excluded.children")
                    .run(value.id, value.type, value.content, JSON.stringify(value.children));
            }
            else if (!("page" in value)) {
                const pageId = id.slice(5);
                if (value.children) this.data.statement("UPDATE pages SET children=? WHERE id=?").run(JSON.stringify(value.children), pageId);
                for (const [attrId, attr] of Object.entries(value.values ?? {})) {
                    if (attr) this.data.statement("INSERT INTO page_attrs(page_id,attr_id,value) VALUES (?,?,?) ON CONFLICT(page_id,attr_id) DO UPDATE SET value=excluded.value").run(pageId, attrId, typeof attr.value === "number" && Number.isSafeInteger(attr.value) ? BigInt(attr.value) : attr.value);
                    else this.data.statement("DELETE FROM page_attrs WHERE page_id=? AND attr_id=?").run(pageId, attrId);
                }
            }
        }
        for (const { source, field, targets } of this.links.values()) {
            this.data.statement("DELETE FROM link_index WHERE source_kind=? AND source_id=? AND source_field=?").run(source.kind, source.id, field);
            for (const t of targets) this.data.statement("INSERT INTO link_index(source_kind,source_id,source_field,target_kind,target_id,retains) VALUES (?,?,?,?,?,1)").run(source.kind, source.id, field, t.kind, t.id);
        }
        const now = nowSeconds();
        for (const id of this.touches) this.data.statement("UPDATE page_attrs SET value=CAST(? AS INTEGER) WHERE page_id=? AND attr_id='modified_at'").run(now, id);
    }
}