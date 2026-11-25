import { attributeTargetKind, attributeTargets, decodeValue, validUUID } from "../../shared/attrs/values";
import { changedUses, references, validateBlock } from "../../shared/content/blocks";
import { isTimeType } from "../../shared/content/time";
import { LabloomError } from "../../shared/failure";
import { type AttributeDefinition, type AttributeValue } from "../../shared/types/attributes";
import { bodylessPageKinds, type Changed, type ContentBlock, type LinkTarget, type Target } from "../../shared/types/content";
import * as workspace from "../workspace-state";
import * as attributes from "./attributes";
import * as data from "./records";
import { decodeBlock, type BlockRow, type LinkRow } from "./records";

export type ValueRow = { value: string | number | null };
export type PagePatch = { manualDeleted?: boolean; children?: string[]; values?: Record<string, ValueRow | null> };
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
    readonly seeds = new Map<string, Target>();
    readonly dependencies = new Set<string>();
    readonly touches = new Set<string>();
    removesNotice = false;
    private readonly links = new Map<string, { source: Target; field: string; targets: LinkTarget[] }>();
    private readonly containers = new Map<string, { source: Target; before: string[]; after: string[]; added: string[] }>();
    private readonly ownersCache = new Map<string, string[]>();
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

    seed(target: Target): void {
        this.seeds.set(key(target), target);
    }

    private markTargets(target: LinkTarget): void {
        if (target.kind === "page") this.direct.add(target.id);
        else if (target.kind === "block") for (const id of data.owners(target.id)) this.direct.add(id);
    }

    private setChildren(source: Target, before: string[], after: string[]): void {
        const added: string[] = [];
        this.containers.set(key(source), { source, before, after, added });
        this.ownersCache.clear();
        for (const [id, delta] of changedUses(before, after)) {
            this.blocks.add(id);
            this.seed({ kind: "block", id });
            if (delta > 0) {
                added.push(id);
                continue;
            }
            this.causes.add(id);
            if (source.kind === "block") this.causes.add(source.id);
            // The removed occurrence may itself be a reference or contain one.
            for (const edge of data.outgoing({ kind: "block", id })) this.markTargets(targetOf(edge));
        }
    }

    setLinks(source: Target, field: string, targets: LinkTarget[], previousRows = data.outgoing(source), persist = true): void {
        const unique = new Map(targets.map(t => [key(t), t]));
        const existing = new Set<string>(), linkKey = key(source) + ":" + field;
        for (const row of previousRows) {
            if (row.sourceField !== field) continue;
            const previous = targetOf(row);
            existing.add(key(previous));
            if (previous.kind === "page") this.dependencies.add(key(previous));
            if (!unique.has(key(previous))) {
                if (previous.kind === "page") {
                    this.backlinkPages.add(previous.id);
                    this.seed({ kind: "page", id: previous.id });
                }
                this.markTargets(previous);
                this.causes.add(source.kind === "block" ? source.id : "attribute:" + field);
            }
        }
        for (const [id, target] of unique) if (target.kind === "page") {
            this.dependencies.add(id);
            if (!existing.has(id)) {
                this.backlinkPages.add(target.id);
                this.seed({ kind: "page", id: target.id });
            }
        }
        if (persist && (this.links.has(linkKey) || existing.size !== unique.size || [...unique.keys()].some(id => !existing.has(id)))) {
            this.links.set(linkKey, { source, field, targets: [...unique.values()] });
        }
    }

    putBlock(value: ContentBlock, stored?: BlockRow): BlockRow | null {
        validateBlock(value);
        const fileId = value.payload.media?.fileId;
        if (fileId && !data.statement("SELECT 1 FROM attachments WHERE id=?").get(fileId)) throw new LabloomError({ kind: "attachment-missing" });
        if (value.children.length && data.owners(value.id).some(id => bodylessPageKinds.includes(data.header(id).kind))) throw new LabloomError({ kind: "page-body-forbidden" });
        const id = "block:" + value.id;
        const before = data.blockRow(value.id);
        const after: BlockRow = stored ?? { id: value.id, type: value.type, content: JSON.stringify(value.payload), children: value.children };
        if (same(before, after)) return before;
        this.rows.before[id] = before;
        this.rows.after[id] = after;
        this.blocks.add(value.id);
        if (!same(before?.children ?? [], value.children)) this.setChildren({ kind: "block", id: value.id }, before?.children ?? [], value.children);
        this.setLinks({ kind: "block", id: value.id }, "payload", references(value));
        return before;
    }

    private pageChanges(side: "before" | "after", id: string): PagePatch {
        const rows = this.rows[side], object = "page:" + id;
        return (rows[object] ??= {}) as PagePatch;
    }

    markManual(id: string, manual: boolean): void {
        const previous = data.statement("SELECT manual_deleted FROM pages WHERE id=?").pluck().get(id) === 1;
        if (manual === previous) return;
        this.pageChanges("before", id).manualDeleted = previous;
        this.pageChanges("after", id).manualDeleted = manual;
        this.pages.add(id);
        this.seed({ kind: "page", id });
    }

    pageChildren(id: string, children: string[]): void {
        if (!Array.isArray(children) || !children.every(validUUID)) throw new LabloomError({ kind: "page-invalid-children" });
        if (children.length && bodylessPageKinds.includes(data.header(id).kind)) throw new LabloomError({ kind: "page-body-forbidden" });
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
        if (id === "deleted" || id === "recycle_reason" || id === "recycled_at") throw new LabloomError({ kind: "attribute-readonly" });
        const before = this.readValue(pageId, id);
        if (same(before, value)) return;
        if (!value && !this.removesNotice && isTimeType(def.type)) {
            this.removesNotice = !!data.statement("SELECT 1 FROM timers WHERE page_id=? AND attr_id=? AND fired_at IS NOT NULL LIMIT 1").get(pageId, id);
        }
        if (id === "paper_annotations") this.highlightPages.add(pageId);
        if (isTimeType(def.type) || def.type === "status" || ["feed_url", "feed_status", "feed_refresh"].includes(id)) {
            const fields = this.schedules.get(pageId) ?? new Set<string>();
            fields.add(id); this.schedules.set(pageId, fields);
        }
        const prev = this.pageChanges("before", pageId), next = this.pageChanges("after", pageId);
        prev.values ??= {};
        if (!Object.hasOwn(prev.values, id)) prev.values[id] = before;
        (next.values ??= {})[id] = value;
        this.pages.add(pageId);
        if (attributeTargetKind(def.type)) this.setLinks({ kind: "page", id: pageId }, id, attributeTargets(def.type, value ? decodeValue(def, value.value) : null));
        if (id === "independent") {
            this.seed({ kind: "page", id: pageId });
            if (value?.value === 0) {
                this.direct.add(pageId);
                this.causes.add("attribute:" + id);
            }
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

    verifySync(): void {
        for (const { added } of this.containers.values()) for (const id of added) {
            const owners = data.owners(id);
            if (owners.length && owners.every(owner => data.flags(owner).deleted)) throw new LabloomError({ kind: "block-sync-unavailable" });
        }
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

    persist(preview = false): void {
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
                if (value.manualDeleted !== undefined) data.statement("UPDATE pages SET manual_deleted=? WHERE id=?").run(Number(value.manualDeleted), pageId);
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
        if (preview) return;
        const now = workspace.seconds();
        for (const id of this.touches) data.statement("UPDATE page_attrs SET value=CAST(? AS INTEGER) WHERE page_id=? AND attr_id='modified_at' AND value IS NOT CAST(? AS INTEGER)").run(now, id, now);
    }
}