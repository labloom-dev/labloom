import { pageHistory, workspaceHistory } from "./support/history";
import { knowledgeServices, session, type Knowledge } from "./support/session";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { rebuildSyncRefs } from "./support/sync-refs";
import { createWorkspace } from "./support/session";
import { hasFailure } from "./failures";
import { builtinAttrs } from "../shared/attrs/builtins";
import { payload } from "../shared/content/blocks";
import { apply, previewTrash, project } from "../main/knowledge/retention";
import { type GraphPage, unreachablePages } from "./support/reachability";
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

function fixture(t: TestContext, graph: Graph, clock?: () => number): { service: Knowledge; sql: ReturnType<typeof createWorkspace>["database"] } {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "retention-")), clock ? { clock } : undefined);
    const sql = workspace.database;
    const service = knowledgeServices();
    t.after(() => session.close());
    const insertBlock = sql.prepare("INSERT INTO blocks(id, type, content, children) VALUES (?, ?, ?, ?)");
    const insertPage = sql.prepare("INSERT INTO pages(id, kind, title_block_id, children, manual_deleted) VALUES (?, 'editable', ?, ?, ?)");
    const attr = sql.prepare("UPDATE page_attrs SET value = ? WHERE page_id = ? AND attr_id = ?");
    sql.transaction(() => {
        for (const block of graph.blocks.values()) insertBlock.run(block.id, block.type, JSON.stringify(block.payload), JSON.stringify(block.children));
        for (const item of graph.pages) {
            insertBlock.run(item.titleBlockId, "title", JSON.stringify(payload("title", item.name)), "[]");
            insertPage.run(item.id, item.titleBlockId, JSON.stringify(item.children), Number(item.attributes.deleted));
            service.attributes.initializePage(item.id);
            attr.run(Number(item.attributes.independent), item.id, "independent");
            attr.run(JSON.stringify(item.attributes.links), item.id, "links");
        }
    })();
    service.rebuildLinks();
    apply(project(graph.pages.map(item => ({ kind: "page", id: item.id }))));
    return { service, sql };
}

type Change = { children?: string[]; block?: ContentBlock; attributes?: GraphPage["attributes"] };
function checkEdit(service: Knowledge, graph: Graph, item: GraphPage, change: Change, description: string): string[] {
    const edit: EditCommit = {
        pageId: item.id, batch: 1,
        pageChildren: change.children, attributes: change.attributes, blocks: change.block ? [change.block] : []
    };
    const deleted = service.db.$client.prepare("SELECT page_id FROM page_attrs WHERE attr_id = 'deleted' AND value = 1 ORDER BY page_id").pluck();
    const before = deleted.all() as string[];
    if (change.children) item.children = change.children;
    if (change.attributes) Object.assign(item.attributes, change.attributes);
    if (change.block) graph.blocks.set(change.block.id, change.block);
    const after = [...graph.pages.filter(p => p.attributes.deleted).map(p => p.id), ...unreachablePages(graph.pages, graph.blocks, links)].sort();
    const expected = after.filter(id => !before.includes(id));
    const sync = service.sql.prepare("SELECT * FROM sync_refs ORDER BY container_kind,container_id,slot,position");
    const refs = service.sql.prepare("SELECT * FROM link_refs ORDER BY source_kind,source_id,source_field,target_kind,target_id");
    const pageBefore = service.get(edit.pageId), syncBefore = sync.all(), refsBefore = refs.all();
    const source = pageHistory(edit.pageId), result = service.commitEdit(edit, source);
    if (expected.length) {
        assert.equal(result.status, "confirmation", description);
        assert.deepEqual(result.preview.recycled.map(p => p.id).sort(), expected, description);
        assert.deepEqual(deleted.all(), before, description + " recycled state changed before confirmation");
        assert.deepEqual(service.get(edit.pageId), pageBefore, description + " page changed before confirmation");
        assert.deepEqual(sync.all(), syncBefore, description + " sync index changed before confirmation");
        assert.deepEqual(refs.all(), refsBefore, description + " link index changed before confirmation");
        assert.equal(service.commitEdit(edit, source, result.preview.token).status, "saved");
    }
    else assert.equal(result.status, "saved", description);
    assert.deepEqual(deleted.all(), after, description + " commit");
    const beforeSync = sync.all(), beforeRefs = refs.all();
    rebuildSyncRefs(service.sql);
    service.rebuildLinks();
    assert.deepEqual(sync.all(), beforeSync, description + " sync index drift");
    assert.deepEqual(refs.all(), beforeRefs, description + " link index drift");
    return expected;
}

function replaceBody(service: Knowledge, pageId: string, target: Target, inline: boolean): ContentBlock {
    const page = service.get(pageId);
    const block = { ...reference(target, inline), id: page.children[0] };
    const result = service.commitEdit({ pageId, batch: 1, blocks: [block] }, pageHistory(pageId));
    assert.equal(result.status, "saved");
    return block;
}

function changeAttributes(service: Knowledge, pageId: string, attributes: GraphPage["attributes"]): void {
    assert.equal(service.commitEdit({ pageId, batch: 1, attributes, blocks: [] }, pageHistory(pageId)).status, "saved");
}

for (const otherSource of [false, true]) {
    test("trash an owning page via its public operation, with another live page reference = " + otherSource, t => {
        const { service } = fixture(t, { pages: [], blocks: new Map() });
        const a = service.create("editable", "A"), b = service.create("editable", "B"), c = service.create("editable", "C");
        const paragraph = replaceBody(service, b.id, { kind: "page", id: c.id }, true);
        replaceBody(service, a.id, { kind: "block", id: paragraph.id }, false);
        if (otherSource) changeAttributes(service, service.create("editable", "D").id, { links: [c.id] });
        changeAttributes(service, c.id, { independent: false });
        const preview = service.trash([b.id], workspaceHistory);
        assert.equal(preview.status, "confirmation");
        assert.equal(service.get(b.id).attributes.deleted, false);
        assert.equal(service.get(c.id).attributes.deleted, false);
        assert.equal(service.trash([b.id], workspaceHistory, preview.preview.token).status, "saved");
        const edit: EditCommit = { pageId: a.id, batch: 2, pageChildren: [], blocks: [] };
        assert.deepEqual(preview.preview.recycled.map(p => p.id), otherSource ? [] : [c.id]);
        assert.equal(service.get(c.id).attributes.deleted, !otherSource);
        assert.equal(service.commitEdit(edit, pageHistory(edit.pageId)).status, "saved");
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
    const edit: EditCommit = { pageId: b.id, batch: 1, blocks: [], attributes: { independent: false } };
    const result = service.commitEdit(edit, pageHistory(edit.pageId));
    assert.equal(result.status, "confirmation");
    assert.deepEqual(result.preview.recycled.map(p => p.id).sort(), [b.id, c.id].sort());
    assert.equal(service.commitEdit(edit, pageHistory(edit.pageId), result.preview.token).status, "saved");
    assert.equal(service.get(b.id).attributes.deleted, true);
    assert.equal(service.get(c.id).attributes.deleted, true);
});

test("a batch can remove the remaining roots; restores and new references reattach dependents without confirmation", t => {
    let now = Date.UTC(2026, 10, 22);
    const { service, sql } = fixture(t, { pages: [], blocks: new Map() }, () => now);
    const first = service.create("editable", "First parent"), second = service.create("editable", "Second parent");
    const child = service.create("editable", "Dependent", {}, first.id), leaf = service.create("editable", "Leaf", {}, child.id);
    const root = service.create("editable", "Another root");
    assert.equal(first.attributes.independent, true);
    assert.equal(child.attributes.independent, false);
    assert.equal(leaf.attributes.independent, false);
    assert.equal(service.get(first.id).blocks[service.get(first.id).children.at(-1)!].type, "blocked_reference");
    changeAttributes(service, second.id, { links: [child.id] });

    const manual = (id: string): unknown => sql.prepare("SELECT manual_deleted FROM pages WHERE id=?").pluck().get(id);
    function trash(ids: string[], followed: string[]): void {
        const preview = service.trash(ids, workspaceHistory);
        assert.equal(preview.status, "confirmation");
        assert.deepEqual(preview.preview.recycled.map(row => row.id).sort(), [...followed].sort());
        assert.equal(service.trash(ids, workspaceHistory, preview.preview.token).status, "saved");
    }
    trash([first.id, second.id], [child.id, leaf.id]);
    assert.equal(manual(first.id), 1);
    assert.equal(manual(child.id), 0);
    assert.equal(service.get(child.id).attributes.recycled_at, now / 1000);
    now += 60000;
    service.restore([first.id], workspaceHistory);
    assert.equal(manual(first.id), 0);
    for (const page of [child, leaf]) assert.equal(service.get(page.id).attributes.deleted, false);

    trash([child.id], [leaf.id]);
    const time = now / 1000;
    now += 60000;
    trash([first.id], []);
    assert.equal(service.get(child.id).attributes.recycle_reason, "manual_delete");
    assert.equal(service.get(child.id).attributes.recycled_at, time);
    changeAttributes(service, root.id, { links: [child.id] });
    assert.equal(service.get(leaf.id).attributes.deleted, true);
    service.restore([child.id], workspaceHistory);
    assert.equal(manual(child.id), 0);
    assert.equal(service.get(child.id).attributes.independent, false);
    assert.equal(service.get(leaf.id).attributes.deleted, false);
    changeAttributes(service, root.id, { links: [leaf.id, child.id] });
    const removal = { pageId: root.id, batch: 1, blocks: [], attributes: { links: [] } };
    const pending = service.commitEdit(removal, pageHistory(root.id));
    assert.equal(pending.status, "confirmation");
    assert.equal(service.commitEdit(removal, pageHistory(root.id), pending.preview.token).status, "saved");
    assert.equal(service.get(child.id).attributes.recycled_at, now / 1000);
    changeAttributes(service, root.id, { links: [child.id] });
    assert.equal(service.get(child.id).attributes.deleted, false);
    assert.equal(service.get(leaf.id).attributes.deleted, false);
});

test("recycled pages reject title, body, attributes and other edits through their history source", t => {
    const { service } = fixture(t, { pages: [], blocks: new Map() });
    const a = service.create("editable", "A"), b = service.create("editable", "B");
    const shared = b.blocks[b.children[0]];
    assert.equal(service.commitEdit({ pageId: a.id, batch: 1, blocks: [], pageChildren: [a.children[0], shared.id] }, pageHistory(a.id)).status, "saved");
    const trash = service.trash([a.id], workspaceHistory);
    assert.equal(trash.status, "confirmation");
    service.trash([a.id], workspaceHistory, trash.preview.token);
    const readOnly = hasFailure("page-recycled-readonly");
    const title = a.blocks[a.titleBlockId], own = a.blocks[a.children[0]];
    for (const change of [
        { blocks: [{ ...title, payload: payload("title", "Other") }] },
        { blocks: [{ ...own, payload: payload("paragraph", "Other") }] },
        { blocks: [], attributes: { pinned: true } }
    ]) assert.throws(() => service.commitEdit({ pageId: a.id, batch: 0, ...change }, workspaceHistory), readOnly);
    const edited = { ...shared, payload: payload("paragraph", "Shared from a live page") };
    assert.throws(() => service.commitEdit({ pageId: b.id, batch: 0, blocks: [edited] }, pageHistory(a.id)), readOnly);
    assert.throws(() => service.create("editable", "Child", {}, a.id), readOnly);
    assert.equal(service.commitEdit({ pageId: b.id, batch: 0, blocks: [edited] }, pageHistory(b.id)).status, "saved");
    assert.deepEqual(service.get(a.id).blocks[shared.id], edited);
    const workspaceId = service.statement("SELECT id FROM workspace_meta").pluck().get() as string;
    assert.equal(service.syncBlocks(workspaceId, [own.id]), null);
    assert.deepEqual(service.syncBlocks(workspaceId, [shared.id]), [edited]);
    assert.throws(() => service.commitEdit({ pageId: b.id, batch: 0, blocks: [], pageChildren: [own.id] }, pageHistory(b.id)), hasFailure("block-sync-unavailable"));
    const copy = { ...own, id: randomUUID() };
    assert.equal(service.commitEdit({ pageId: b.id, batch: 0, blocks: [copy], pageChildren: [shared.id, copy.id] }, pageHistory(b.id)).status, "saved");
});

test("a block link cannot rescue a rootless page cycle or its outgoing page references", t => {
    const { service, sql } = fixture(t, { pages: [], blocks: new Map() });
    const a = service.create("editable", "A"), b = service.create("editable", "B"), c = service.create("editable", "C");
    const paragraph = replaceBody(service, b.id, { kind: "page", id: c.id }, true);
    const entry = replaceBody(service, a.id, { kind: "block", id: paragraph.id }, false);
    changeAttributes(service, c.id, { links: [b.id], independent: false });
    const edit: EditCommit = { pageId: b.id, batch: 1, blocks: [], attributes: { independent: false } };
    const preview = service.commitEdit(edit, pageHistory(edit.pageId));
    assert.equal(preview.status, "confirmation");
    assert.deepEqual(preview.preview.recycled.map(p => p.id).sort(), [b.id, c.id].sort());
    assert.equal(service.commitEdit(edit, pageHistory(edit.pageId), preview.preview.token).status, "saved");
    assert.equal(service.get(b.id).attributes.deleted, true);
    assert.equal(service.get(c.id).attributes.deleted, true);
    assert.equal(service.get(a.id).attributes.deleted, false);
    const anchored = service.resolve({ kind: "block", id: paragraph.id });
    assert.equal(anchored?.status, "ok");
    assert.equal(anchored.ownerId, b.id);
    assert.deepEqual(sql.prepare("SELECT target_kind,target_id FROM link_refs WHERE source_id=?").all(entry.id), [{ target_kind: "block", target_id: paragraph.id }]);
});

test("a link to a block with no remaining position cannot retain that block's page target", t => {
    const root = page("Root", true), dependent = page("Dependent", false);
    const outside = reference({ kind: "page", id: dependent.id }, true);
    const entry = reference({ kind: "block", id: outside.id }, false);
    root.children = [entry.id, outside.id];
    const graph = { pages: [root, dependent], blocks: new Map([entry, outside].map(b => [b.id, b])) };
    const { service, sql } = fixture(t, graph);
    assert.deepEqual(checkEdit(service, graph, root, { children: [entry.id] }, "remove last position"), [dependent.id]);
    assert.equal(sql.prepare("SELECT count(*) FROM sync_refs WHERE block_id = ?").pluck().get(outside.id), 0);
});

function random(seed: number): (size: number) => number {
    let state = seed >>> 0;
    return size => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return Math.floor((state / 0x100000000) * size);
    };
}

test("simultaneous manual trash agrees with a full traversal from live roots", t => {
    const nextSeed = random(0x6d2b79f5);
    let followed = 0, unchanged = 0;
    for (let example = 0; example < 128; example++) {
        const seed = nextSeed(2 ** 32), pick = random(seed);
        let serial = 0;
        const id = (): string => "00000000-0000-4000-8000-" + (++serial).toString(16).padStart(12, "0");
        const pages: TestPage[] = Array.from({ length: 5 + pick(6) }, (_, i) => ({
            id: id(), titleBlockId: id(), name: String.fromCharCode(65 + i), children: [],
            attributes: { independent: i === 0 || (i > 1 && pick(3) === 0), deleted: i > 1 && pick(4) === 0, links: [] }
        }));
        pages.at(-1)!.attributes.deleted = true;
        const blocks: ContentBlock[] = Array.from({ length: 6 + pick(9) }, () => ({
            id: id(), type: "paragraph", payload: payload("paragraph"), children: []
        }));
        const pageId = (): string => pages[pick(pages.length)].id;
        const blockId = (): string => blocks[pick(blocks.length)].id;
        const blockLinks: { page: string; block: string }[] = [];
        for (const [index, item] of pages.entries()) {
            item.children = Array.from({ length: pick(4) }, blockId);
            const targets = Array.from({ length: pick(3) }, pageId);
            if (index < 2) targets.push(pages[1 - index].id);
            item.attributes.links = [...new Set(targets)];
            if (pick(3) === 0) blockLinks.push({ page: item.id, block: blockId() });
        }
        // Ensure a shared placement contains a nested block.
        pages[0].children.push(blocks[0].id);
        pages[1].children.push(blocks[0].id);
        for (const [index, block] of blocks.entries()) {
            // Containment must be acyclic even when references form cycles.
            const later = blocks.slice(index + 1);
            if (later.length && pick(2)) block.children.push(later[pick(later.length)].id);
            block.payload.inline = Array.from({ length: pick(3) }, () => ({
                type: "inlineReference", attrs: { target: pick(2) ? { kind: "page", id: pageId() } : { kind: "block", id: blockId() }, label: "link" }
            }));
        }
        blocks[0].children.push(blocks[1].id);
        const graph = new Map(blocks.map(block => [block.id, block]));
        const { service, sql } = fixture(t, { pages, blocks: graph });
        // Attributes currently expose page targets. Exercise page-sourced block edges at the index boundary.
        const insert = sql.prepare("INSERT INTO link_refs VALUES ('page',?,'test-block-link','block',?)");
        for (const link of blockLinks) insert.run(link.page, link.block);
        const active = pages.filter(item => !service.flags(item.id).deleted);
        for (let trial = 0; trial < 4; trial++) {
            const selected = active.filter(() => pick(2)).map(item => item.id);
            if (!selected.length) selected.push(active[pick(active.length)].id);
            const manual = new Set(selected);
            const expected = unreachablePages(pages.filter(page => !manual.has(page.id)), graph, links)
                .filter(id => !service.flags(id).deleted).sort();
            const actual = previewTrash(selected);
            assert.deepEqual(actual, expected, JSON.stringify({ seed, trial, selected, pages, blocks, blockLinks }));
            if (actual.length) followed++;
            else unchanged++;
        }
    }
    assert.ok(followed > 0 && unchanged > 0, "Cover selections with and without dependent pages");
});

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
            const active = pages.filter(p => !service.flags(p.id).deleted);
            const item = active[pick(active.length)];
            let change: Change;
            switch (pick(5)) {
                case 0: {
                    const next = [...item.children];
                    if (next.length && pick(2)) next.splice(pick(next.length), 1);
                    else {
                        const leaf = leaves[pick(leaves.length)].id, owners = service.owners(leaf);
                        if (!owners.length || owners.some(id => !service.flags(id).deleted)) next.push(leaf);
                    }
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