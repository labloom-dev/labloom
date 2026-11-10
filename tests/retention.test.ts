import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { KnowledgeService } from "../main/knowledge/service";
import { createWorkspace } from "../main/storage/workspace";
import { builtinAttrs } from "../shared/attrs/builtins";
import { payload } from "../shared/content/blocks";
import { type GraphPage, unreachablePages } from "../shared/content/lifecycle";
import { type ContentBlock, type EditCommit, type Target } from "../shared/types/content";

type TestPage = GraphPage & { name: string };
type Graph = { pages: TestPage[]; blocks: Map<string, ContentBlock> };
const links = [{ id: "links", ...builtinAttrs.links }];

function page(name: string, independent: boolean, deleted = false): TestPage {
    return { id: randomUUID(), name, titleBlockId: randomUUID(), children: [], attributes: { independent, deleted, links: [] } };
}

function reference(target: Target, inline: boolean): ContentBlock {
    const type = inline ? "paragraph" : "blocked_reference";
    const body = payload(type);
    if (inline) body.inline.push({ type: "inlineReference", attrs: { target, label: "link" } });
    else body.target = target;
    return { id: randomUUID(), type, payload: body, children: [] };
}

function fixture(t: TestContext, graph: Graph): { service: KnowledgeService; sql: ReturnType<typeof createWorkspace>["database"] } {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "retention-")));
    const sql = workspace.database;
    t.after(() => sql.close());
    const insertBlock = sql.prepare("INSERT INTO blocks(id, type, content, children) VALUES (?, ?, ?, ?)");
    const insertPage = sql.prepare("INSERT INTO pages(id, kind, title_block_id, children) VALUES (?, 'editable', ?, ?)");
    const attr = sql.prepare("UPDATE page_attrs SET value = ? WHERE page_id = ? AND attr_id = ?");
    sql.transaction(() => {
        for (const block of graph.blocks.values()) insertBlock.run(block.id, block.type, JSON.stringify(block.payload), JSON.stringify(block.children));
        for (const item of graph.pages) {
            insertBlock.run(item.titleBlockId, "title", JSON.stringify(payload("title", item.name)), "[]");
            insertPage.run(item.id, item.titleBlockId, JSON.stringify(item.children));
            attr.run(Number(item.attributes.independent), item.id, "independent");
            attr.run(Number(item.attributes.deleted), item.id, "deleted");
            attr.run(JSON.stringify(item.attributes.links), item.id, "links");
        }
    })();
    const service = new KnowledgeService(workspace.db);
    service.rebuildLinks();
    return { service, sql };
}

type Change = { children?: string[]; block?: ContentBlock; attributes?: GraphPage["attributes"] };
function checkEdit(service: KnowledgeService, graph: Graph, item: GraphPage, change: Change, description: string): string[] {
    const edit: EditCommit = { pageId: item.id, tabId: "graph-test", batch: 1,
        pageChildren: change.children, attributes: change.attributes, blocks: change.block ? [change.block] : [] };
    if (change.children) item.children = change.children;
    if (change.attributes) Object.assign(item.attributes, change.attributes);
    if (change.block) graph.blocks.set(change.block.id, change.block);
    const expected = unreachablePages(graph.pages, graph.blocks, links).sort();
    const preview = service.previewEdit(edit);
    assert.deepEqual(preview?.recycled.map(p => p.id).sort() ?? [], expected, description);
    const deleted = service.db.$client.prepare("SELECT page_id FROM page_attrs WHERE attr_id = 'deleted' AND value = 1 ORDER BY page_id").pluck();
    assert.deepEqual(deleted.all(), graph.pages.filter(p => p.attributes.deleted).map(p => p.id).sort(), description + " preview wrote data");
    assert.equal(service.commitEdit(edit, preview?.token).status, "saved");
    for (const p of graph.pages) if (expected.includes(p.id)) p.attributes.deleted = true;
    assert.deepEqual(deleted.all(), graph.pages.filter(p => p.attributes.deleted).map(p => p.id).sort(), description + " commit");
    return expected;
}

function replaceBody(service: KnowledgeService, pageId: string, target: Target, inline: boolean): ContentBlock {
    const page = service.get(pageId);
    const block = { ...reference(target, inline), id: page.children[0] };
    const result = service.commitEdit({ pageId, tabId: "setup", batch: 1, blocks: [block] });
    assert.equal(result.status, "saved");
    return block;
}

function changeAttributes(service: KnowledgeService, pageId: string, attributes: GraphPage["attributes"]): void {
    assert.equal(service.commitEdit({ pageId, tabId: "setup", batch: 1, attributes, blocks: [] }).status, "saved");
}

for (const otherSource of [false, true]) {
    test("trash an owning page via its public operation, with another live page reference = " + otherSource, t => {
        const { service } = fixture(t, { pages: [], blocks: new Map() });
        const a = service.create("editable", "A"), b = service.create("editable", "B"), c = service.create("editable", "C");
        const paragraph = replaceBody(service, b.id, { kind: "page", id: c.id }, true);
        replaceBody(service, a.id, { kind: "block", id: paragraph.id }, false);
        if (otherSource) changeAttributes(service, service.create("editable", "D").id, { links: [c.id] });
        changeAttributes(service, c.id, { independent: false });
        const preview = service.trash([b.id], "trash");
        assert.equal(preview.status, "confirmation");
        assert.equal(service.get(b.id).attributes.deleted, false);
        assert.equal(service.get(c.id).attributes.deleted, false);
        assert.equal(service.trash([b.id], "trash", preview.preview.token).status, "saved");
        const edit: EditCommit = { pageId: a.id, tabId: "entry", batch: 2, pageChildren: [], blocks: [] };
        const removal = service.previewEdit(edit);
        t.diagnostic("Trash B, preview = " + JSON.stringify(preview.preview.recycled.map(p => p.title)) + ", C recycled = " + service.get(c.id).attributes.deleted + "; later removing A's entry would recycle " + JSON.stringify(removal?.recycled.map(p => p.title) ?? []));
        assert.deepEqual(preview.preview.recycled.map(p => p.id), otherSource ? [] : [c.id]);
        assert.equal(service.get(c.id).attributes.deleted, !otherSource);
        assert.equal(removal, null);
        assert.equal(service.commitEdit(edit).status, "saved");
        assert.deepEqual(service.get(a.id).children, []);
        assert.equal(service.get(c.id).attributes.deleted, !otherSource);
    });
}

test("automatically recycling the only owner disables its block's outgoing links in the same preview", t => {
    const { service } = fixture(t, { pages: [], blocks: new Map() });
    const a = service.create("editable", "A"), b = service.create("editable", "B"), c = service.create("editable", "C");
    const paragraph = replaceBody(service, b.id, { kind: "page", id: c.id }, true);
    replaceBody(service, a.id, { kind: "block", id: paragraph.id }, false);
    changeAttributes(service, c.id, { independent: false });
    const edit: EditCommit = { pageId: b.id, tabId: "retention", batch: 1, blocks: [], attributes: { independent: false } };
    const result = service.commitEdit(edit);
    assert.equal(result.status, "confirmation");
    assert.deepEqual(result.preview.recycled.map(p => p.id).sort(), [b.id, c.id].sort());
    assert.equal(service.commitEdit(edit, result.preview.token).status, "saved");
    assert.equal(service.get(b.id).attributes.deleted, true);
    assert.equal(service.get(c.id).attributes.deleted, true);
});

test("removing the only entry into a cycle of live pages through a block target", t => {
    const { service, sql } = fixture(t, { pages: [], blocks: new Map() });
    const a = service.create("editable", "A"), b = service.create("editable", "B"), c = service.create("editable", "C");
    const paragraph = replaceBody(service, b.id, { kind: "page", id: c.id }, true);
    const entry = replaceBody(service, a.id, { kind: "block", id: paragraph.id }, false);
    changeAttributes(service, c.id, { links: [b.id], independent: false });
    changeAttributes(service, b.id, { independent: false });
    for (const p of [a, b, c]) assert.equal(service.get(p.id).attributes.deleted, false);
    const edit: EditCommit = { pageId: a.id, batch: 1, tabId: "entry", blocks: [], pageChildren: [] };
    const preview = service.commitEdit(edit);
    assert.equal(preview.status, "confirmation");
    assert.deepEqual(preview.preview.recycled.map(p => p.id).sort(), [b.id, c.id].sort());
    assert.equal(entry.children.length, 0);
    assert.deepEqual(sql.prepare("SELECT target_kind, target_id FROM link_index WHERE source_id = ?").all(entry.id), [{ target_kind: "block", target_id: paragraph.id }]);
    assert.equal(service.commitEdit(edit, preview.preview.token).status, "saved");
    assert.equal(service.get(b.id).attributes.deleted, true);
    assert.equal(service.get(c.id).attributes.deleted, true);
    t.diagnostic("All pages started live via public edits. Removed subtree: 0 direct page targets. Recycle preview and confirmed result: B, C.");
});

test("a link to a block with no remaining position cannot retain that block's page target", t => {
    const root = page("Root", true), dependent = page("Dependent", false);
    const outside = reference({ kind: "page", id: dependent.id }, true);
    const entry = reference({ kind: "block", id: outside.id }, false);
    root.children = [entry.id, outside.id];
    const graph = { pages: [root, dependent], blocks: new Map([entry, outside].map(b => [b.id, b])) };
    const { service, sql } = fixture(t, graph);
    assert.deepEqual(checkEdit(service, graph, root, { children: [entry.id] }, "remove last position"), [dependent.id]);
    assert.equal(sql.prepare("SELECT count(*) FROM block_uses WHERE block_id = ?").pluck().get(outside.id), 0);
});

function random(seed: number): (size: number) => number {
    let state = seed >>> 0;
    return size => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return Math.floor((state / 0x100000000) * size);
    };
}

test("seeded edit sequences preserve the same pages as full root traversal", t => {
    for (const seed of [419, 7187, 41041, 65537, 102013]) {
        const pick = random(seed);
        const pages = Array.from({ length: 8 }, (_, i) => page("Page " + i, i < 2, i === 7));
        const blocks = new Map<string, ContentBlock>();
        const leaves = pages.map((_, i) => reference({ kind: "page", id: pages[(i + 1) % pages.length].id }, i % 2 === 0));
        for (let i = 0; i < pages.length; i++) {
            const nested = reference({ kind: "block", id: leaves[pick(leaves.length)].id }, true);
            nested.children = [leaves[i].id, leaves[pick(leaves.length)].id];
            blocks.set(leaves[i].id, leaves[i]);
            blocks.set(nested.id, nested);
            pages[i].children = [nested.id, leaves[(i + 1) % leaves.length].id, leaves[i].id];
        }
        pages[0].attributes.links = pages.slice(1, -1).map(p => p.id);
        const graph = { pages, blocks };
        assert.deepEqual(unreachablePages(pages, blocks, links), []);
        const { service } = fixture(t, graph);
        for (let step = 0; step < 36; step++) {
            const active = pages.filter(p => !p.attributes.deleted);
            const item = active[pick(active.length)];
            let change: Change;
            switch (pick(5)) {
                case 0: {
                    const next = [...item.children];
                    if (next.length && pick(2)) next.splice(pick(next.length), 1);
                    else next.push(leaves[pick(leaves.length)].id);
                    change = { children: next };
                    break;
                }
                case 1:
                    change = { attributes: { links: pick(2) ? [pages[pick(pages.length)].id] : [] } };
                    break;
                case 2:
                    change = { attributes: { independent: item === pages[0] || !item.attributes.independent } };
                    break;
                default: {
                    const leaf = leaves[pick(leaves.length)];
                    const target: Target = pick(2) ? { kind: "page", id: pages[pick(pages.length)].id } : { kind: "block", id: leaf.id };
                    const block = reference(target, !!pick(2));
                    if (item.children.length && pick(2)) {
                        block.id = item.children[pick(item.children.length)];
                        change = { block };
                    }
                    else change = { block, children: [...item.children, block.id] };
                }
            }
            checkEdit(service, graph, item, change, "seed " + seed + ", edit " + step);
        }
    }
});