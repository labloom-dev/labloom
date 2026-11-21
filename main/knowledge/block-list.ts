import * as records from "./records";
import { blockText } from "../../shared/content/blocks";
import { blockListRows } from "../../shared/content/block-list";
import type { ContentBlock, PageBlockList, Target } from "../../shared/types/content";

function referenceTitles(targets: Target[]): Map<string, string> {
    const titles = new Map<string, string>();
    if (!targets.length) return titles;
    // Recycled targets still have a label. A block without any page owner is missing.
    // For an untitled page, read its first children only until the normal 240-character excerpt is full.
    const rows = records.statement(`WITH RECURSIVE targets(kind,id) AS (
        SELECT DISTINCT value->>'kind', value->>'id' FROM json_each(?)
    ), parents(target,kind,id) AS (
        SELECT id,'block',id FROM targets WHERE kind='block'
        UNION SELECT p.target,r.container_kind,r.container_id FROM parents p JOIN sync_refs r
            ON p.kind='block' AND r.block_id=p.id
    ), names(id,title) AS MATERIALIZED (
        SELECT p.id,knowledge_text(b.type,b.content) FROM targets t JOIN pages p ON p.id=t.id
            JOIN blocks b ON b.id=p.title_block_id WHERE t.kind='page'
    ), excerpts(id,pos,text) AS (
        SELECT id,0,'' FROM names WHERE title=''
        UNION ALL SELECT e.id,e.pos+1,substr(e.text || CASE WHEN e.text='' THEN '' ELSE ' ' END || knowledge_text(b.type,b.content),1,240)
            FROM excerpts e JOIN sync_refs r ON r.container_kind='page' AND r.container_id=e.id AND r.slot='children' AND r.position=e.pos
            JOIN blocks b ON b.id=r.block_id WHERE length(e.text)<240
    )
    SELECT 'page' AS kind,n.id,n.title AS text,0 AS excerpt FROM names n WHERE n.title<>''
    UNION ALL SELECT 'page',id,text,1 FROM (SELECT id,text,max(pos) FROM excerpts GROUP BY id)
    UNION ALL SELECT 'block',b.id,knowledge_text(b.type,b.content),0 FROM blocks b
        WHERE b.id IN (SELECT target FROM parents WHERE kind='page')`).all(JSON.stringify(targets)) as (Target & { text: string; excerpt: number })[];
    for (const row of rows) titles.set(row.kind + ":" + row.id, row.excerpt ? row.text.slice(0, 240) : row.text);
    return titles;
}

export function blockList(id: string): PageBlockList {
    const page = records.header(id), roots = records.children({ kind: "page", id });
    const blocks = new Map<string, ContentBlock>(), targets: Target[] = [];
    let pending = [...new Set([page.titleBlockId, ...roots])];
    while (pending.length) {
        const next = new Set<string>();
        for (const block of records.readBatch(pending)) {
            blocks.set(block.id, block);
            if (block.type === "blocked_reference" && block.payload.target) targets.push(block.payload.target);
            for (const child of block.children) next.add(child);
        }
        pending = [...next].filter(id => !blocks.has(id));
    }
    const titles = referenceTitles(targets), heading = blocks.get(page.titleBlockId);
    return { title: heading ? blockText(heading) : "", rows: blockListRows(roots, id => blocks.get(id), block => {
        const target = block.payload.target;
        return target ? titles.get(target.kind + ":" + target.id) ?? "" : "";
    }) };
}