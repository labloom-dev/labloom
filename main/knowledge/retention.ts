import { validUUID } from "../../shared/attrs/values";
import { LabloomError } from "../../shared/failure";
import * as workspace from "../workspace-state";
import { type Target } from "../../shared/types/content";
import * as data from "./records";

type Status = { id: string; deleted: number; reason: "manual_delete" | "unreachable" | null };
type Projection = { changes: Status[]; unreachable: string[] };

/** Changes can only affect vertices downstream of the changed edge or root. Look
 * upstream from those dependents for roots, then walk their paths forward. The
 * previous recycle status is used only to compare results, never to cut a path. */
export function project(seeds: Target[], inspect: string[] = [], trash: string[] = []): Projection {
    if (!seeds.length) return { changes: [], unreachable: [] };
    const rows = data.statement(`WITH RECURSIVE
        manual(id) AS MATERIALIZED (SELECT value FROM json_each(?)),
        inspect(id) AS MATERIALIZED (SELECT value FROM json_each(?)),
        affected(kind,id) AS (
            SELECT value->>'$.kind',value->>'$.id' FROM json_each(?)
            UNION SELECT 'block',r.block_id FROM affected a CROSS JOIN sync_refs r ON r.container_kind=a.kind AND r.container_id=a.id
            UNION SELECT 'page',p.id FROM affected a CROSS JOIN link_refs l ON l.source_kind=a.kind AND l.source_id=a.id
                JOIN pages p ON p.id=l.target_id WHERE l.target_kind='page'
        ),
        dependents(id) AS MATERIALIZED (
            SELECT p.id FROM affected a CROSS JOIN pages p ON p.id=a.id
            JOIN page_attrs i ON i.page_id=p.id AND i.attr_id='independent' AND i.value=0
            WHERE a.kind='page' AND p.manual_deleted=0 AND p.id NOT IN manual
        ),
        upstream(kind,id) AS (
            SELECT 'page',id FROM dependents
            UNION SELECT r.container_kind,r.container_id FROM upstream u CROSS JOIN sync_refs r ON r.block_id=u.id
                WHERE u.kind='block' AND (r.container_kind='block' OR (r.container_id NOT IN manual
                    AND EXISTS (SELECT 1 FROM pages WHERE id=r.container_id AND manual_deleted=0)))
            UNION SELECT l.source_kind,l.source_id FROM upstream u CROSS JOIN link_refs l ON l.target_kind='page' AND l.target_id=u.id
                WHERE u.kind='page' AND (l.source_kind='block' OR (l.source_id NOT IN manual
                    AND EXISTS (SELECT 1 FROM pages WHERE id=l.source_id AND manual_deleted=0)))
        ),
        retained(kind,id) AS (
            SELECT u.kind,u.id FROM upstream u CROSS JOIN page_attrs i ON i.page_id=u.id AND i.attr_id='independent' AND i.value=1
                WHERE u.kind='page'
            UNION SELECT 'block',r.block_id FROM retained p CROSS JOIN sync_refs r ON r.container_kind=p.kind AND r.container_id=p.id
                WHERE ('block',r.block_id) IN (SELECT kind,id FROM upstream)
            UNION SELECT 'page',l.target_id FROM retained p CROSS JOIN link_refs l ON l.source_kind=p.kind AND l.source_id=p.id
                WHERE l.target_kind='page' AND ('page',l.target_id) IN (SELECT kind,id FROM upstream)
        ),
        desired(id,reason) AS MATERIALIZED (
            SELECT p.id, CASE WHEN p.manual_deleted=1 THEN 'manual_delete'
                WHEN p.id IN dependents AND p.id NOT IN (SELECT id FROM retained WHERE kind='page') THEN 'unreachable' END
            FROM affected a CROSS JOIN pages p ON p.id=a.id WHERE a.kind='page' AND p.id NOT IN manual
        )
        SELECT n.id,n.reason,d.value AS deleted, (d.value IS NOT (n.reason IS NOT NULL) OR r.value IS NOT n.reason) AS changed
        FROM desired n CROSS JOIN page_attrs d ON d.page_id=n.id AND d.attr_id='deleted'
        JOIN page_attrs r ON r.page_id=n.id AND r.attr_id='recycle_reason'
        WHERE changed OR n.id IN inspect ORDER BY n.id`).all(JSON.stringify(trash), JSON.stringify(inspect), JSON.stringify(seeds)) as (Status & { changed: number })[];
    return { changes: rows.filter(row => row.changed), unreachable: rows.filter(row => row.reason === "unreachable").map(row => row.id) };
}

export function previewTrash(selected: string[]): string[] {
    const candidates = data.statement(`SELECT 1 FROM page_attrs i JOIN page_attrs d ON d.page_id=i.page_id AND d.attr_id='deleted' AND d.value=0
        WHERE i.attr_id='independent' AND i.value=0 AND i.page_id NOT IN (SELECT value FROM json_each(?)) LIMIT 1`).get(JSON.stringify(selected));
    if (!candidates) return [];
    return project(selected.map(id => ({ kind: "page", id })), [], selected).changes
        .filter(row => !row.deleted && row.reason !== null).map(row => row.id);
}

export function apply({ changes }: Projection): { pages: string[]; backlinks: string[]; timers: string[]; restored: string[] } {
    if (!changes.length) return { pages: [], backlinks: [], timers: [], restored: [] };
    const restored = changes.filter(row => row.deleted && row.reason === null).map(row => row.id);
    const trashed = changes.filter(row => !row.deleted && row.reason !== null).map(row => row.id);
    if (restored.length) {
        const duplicate = data.statement(`WITH restoring(id) AS (SELECT value FROM json_each(?))
            SELECT 1 FROM restoring r JOIN page_attrs a ON a.page_id=r.id AND a.attr_id='feed_url' AND a.value<>''
            JOIN page_attrs b ON b.attr_id='feed_url' AND b.value=a.value AND b.page_id<>a.page_id
            JOIN page_attrs d ON d.page_id=b.page_id AND d.attr_id='deleted'
            WHERE b.page_id NOT IN (SELECT value FROM json_each(?)) AND (d.value=0 OR b.page_id IN restoring) LIMIT 1`)
            .get(JSON.stringify(restored), JSON.stringify(trashed));
        if (duplicate) throw new LabloomError({ kind: "feed-duplicate" });
    }
    const update = data.statement("UPDATE page_attrs SET value=? WHERE page_id=? AND attr_id=? AND value IS NOT ?");
    const now = workspace.seconds();
    for (const { id, deleted, reason } of changes) {
        const next = Number(reason !== null);
        update.run(reason, id, "recycle_reason", reason);
        if (deleted === next) continue;
        const timestamp = next ? BigInt(now) : null;
        update.run(BigInt(next), id, "deleted", BigInt(next));
        update.run(timestamp, id, "recycled_at", timestamp);
        update.run(BigInt(now), id, "modified_at", BigInt(now));
    }
    const switched = JSON.stringify([...restored, ...trashed]);
    const backlinks = data.statement(`WITH RECURSIVE sources(kind,id) AS (
        SELECT 'page',value FROM json_each(?)
        UNION SELECT 'block',s.block_id FROM sources p CROSS JOIN sync_refs s ON s.container_kind=p.kind AND s.container_id=p.id
    ) SELECT DISTINCT l.target_id FROM sources p CROSS JOIN link_refs l ON l.source_kind=p.kind AND l.source_id=p.id WHERE l.target_kind='page'`).pluck().all(switched) as string[];
    const timers = data.statement(`SELECT p.id FROM json_each(?) j CROSS JOIN pages p ON p.id=j.value
        WHERE p.kind='feed' OR EXISTS (SELECT 1 FROM timers t WHERE t.page_id=p.id)`).pluck().all(switched) as string[];
    return { pages: changes.map(row => row.id), backlinks, timers, restored };
}

/** During purge, every page outside the downstream candidates can retain them,
 * even if it is dependent or recycled. A downstream cycle cannot retain itself. */
export function purgePlan(ids: string[] | null): { pages: { id: string; title: string }[]; blocks: string[]; links: number } {
    workspace.requireWorkspace();
    if (ids !== null && (!Array.isArray(ids) || !ids.every(validUUID))) throw new LabloomError({ kind: "page-invalid-selection" });
    const selected = JSON.stringify(ids === null
        ? data.statement("SELECT page_id FROM page_attrs WHERE attr_id='deleted' AND value=1").pluck().all()
        : [...new Set(ids)]);
    const invalid = data.statement(`SELECT p.id FROM json_each(?) s LEFT JOIN pages p ON p.id=s.value
        LEFT JOIN page_attrs d ON d.page_id=p.id AND d.attr_id='deleted'
        WHERE p.id IS NULL OR d.value IS NOT 1 ORDER BY s.key LIMIT 1`).get(selected) as { id: string | null } | undefined;
    if (invalid) {
        throw new LabloomError({ kind: invalid.id === null ? "page-unavailable" : "purge-recycled-only" });
    }

    // Only unretained recycled pages downstream of the selection are removed.
    // For physical block storage, all surviving pages retain their placements.
    const plan = data.statement(`WITH RECURSIVE selection(id) AS MATERIALIZED (SELECT value FROM json_each(?)),
        affected(kind,id) AS (
            SELECT 'page',id FROM selection
            UNION SELECT 'block',r.block_id FROM affected p CROSS JOIN sync_refs r ON r.container_kind=p.kind AND r.container_id=p.id
            UNION SELECT 'page',l.target_id FROM affected p CROSS JOIN link_refs l ON l.source_kind=p.kind AND l.source_id=p.id
                WHERE l.target_kind='page' AND EXISTS (SELECT 1 FROM page_attrs d WHERE d.page_id=l.target_id AND d.attr_id='deleted' AND d.value=1)
        ),
        candidates(id) AS MATERIALIZED (SELECT id FROM affected WHERE kind='page' AND id NOT IN selection),
        retained(kind,id) AS (
            SELECT 'page',p.id FROM pages p WHERE EXISTS (SELECT 1 FROM candidates) AND p.id NOT IN selection AND p.id NOT IN candidates
            UNION SELECT 'block',r.block_id FROM retained p CROSS JOIN sync_refs r ON r.container_kind=p.kind AND r.container_id=p.id
            UNION SELECT 'page',l.target_id FROM retained p CROSS JOIN link_refs l ON l.source_kind=p.kind AND l.source_id=p.id
                WHERE l.target_kind='page' AND l.target_id IN candidates
        ),
        removed(id) AS MATERIALIZED (
            SELECT id FROM selection UNION ALL
            SELECT id FROM candidates WHERE id NOT IN (SELECT id FROM retained WHERE kind='page')
        ),
        surviving_blocks(id) AS MATERIALIZED (
            SELECT block_id FROM sync_refs WHERE container_kind='page' AND container_id NOT IN removed
            UNION SELECT r.block_id FROM surviving_blocks b CROSS JOIN sync_refs r ON r.container_kind='block' AND r.container_id=b.id
        ),
        removed_blocks(id) AS MATERIALIZED (
            SELECT id FROM affected WHERE kind='block' EXCEPT SELECT id FROM surviving_blocks
        ),
        removed_targets(kind,id) AS (
            SELECT 'page',id FROM removed UNION ALL SELECT 'block',id FROM removed_blocks
        )
        SELECT (
            SELECT json_group_array(json_object('id',p.id,'title',COALESCE(knowledge_text(b.type,b.content),'')) ORDER BY p.id)
            FROM removed r CROSS JOIN pages p ON p.id=r.id JOIN blocks b ON b.id=p.title_block_id
        ) AS pages,
        (SELECT json_group_array(id ORDER BY id) FROM removed_blocks) AS blocks,
        (
            SELECT count(*) FROM removed_targets t CROSS JOIN link_refs l ON l.target_kind=t.kind AND l.target_id=t.id
            WHERE (l.source_kind='page' AND l.source_id NOT IN removed) OR (l.source_kind='block' AND l.source_id IN surviving_blocks)
        ) AS links`).get(selected) as { pages: string; blocks: string; links: number };
    return { pages: JSON.parse(plan.pages) as { id: string; title: string }[], blocks: JSON.parse(plan.blocks) as string[], links: plan.links };
}

/** Physical block existence: every extant page, including recycle-bin pages, retains its sync tree. */
export function orphanBlocks(): string[] {
    workspace.requireWorkspace();
    return (data.statement(`WITH RECURSIVE retained(id) AS MATERIALIZED (
        SELECT block_id FROM sync_refs WHERE container_kind='page'
        UNION
        SELECT r.block_id FROM sync_refs r JOIN retained p ON r.container_kind='block' AND r.container_id=p.id
    ) SELECT id FROM blocks WHERE id NOT IN (SELECT id FROM retained)`).all() as { id: string }[]).map(row => row.id);
}