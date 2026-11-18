import { pageHistory, workspaceHistory } from "./support/history";
import { knowledgeServices, historyServices, purgeServices, session, type Knowledge, type History, type Purge } from "./support/session";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { getSchema } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { createWorkspace } from "./support/session";
import { rebuildSyncRefs } from "../main/storage/schema";
import { payload } from "../shared/content/blocks";
import { type CommitResult, type ContentBlock, type PageRecord } from "../shared/types/content";
import { documentExtensions, indexDoc, pageDocument } from "../renderer/components/Editor/document";
import { identityPlugin } from "../renderer/components/Editor/transactions";
import { pasteBlocks, readClipboard, writeClipboard, type BlockClipboard } from "../renderer/components/Editor/clipboard";
import { hasFailure } from "./failures";

const schema = getSchema(documentExtensions);
type ClipboardFixture = ReturnType<typeof createWorkspace> & {
    service: Knowledge; history: History; purge: Purge; a: PageRecord; b: PageRecord;
    parent: ContentBlock; child: ContentBlock; leaf: ContentBlock; clipboard: BlockClipboard; text: string; slice: Slice;
    target: () => EditorState; paste: (current?: ContentBlock[]) => PageRecord;
};
function confirm(action: (token?: string) => CommitResult): void {
    const result = action();
    assert.equal(result.status === "confirmation" ? action(result.preview.token).status : result.status, "saved");
}
function fixture(t: TestContext): ClipboardFixture {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "clipboard-")));
    t.after(() => session.close());
    const service = knowledgeServices(), history = historyServices(), purge = purgeServices();
    const a = service.create("editable", "A"), b = service.create("editable", "B");
    const parent = a.blocks[a.children[0]], child: ContentBlock = { id: randomUUID(), type: "unordered_list", payload: payload("unordered_list", "Copied child"), children: [] };
    const leaf: ContentBlock = { id: randomUUID(), type: "paragraph", payload: payload("paragraph", "Copied leaf"), children: [] };
    service.commitEdit({ pageId: a.id, tabId: "setup", batch: 0, blocks: [{ ...parent, children: [child.id] }, { ...child, children: [leaf.id] }, leaf] }, pageHistory(a.id));
    const source = schema.nodeFromJSON(pageDocument(service.get(a.id))), slice = new Slice(Fragment.from(source.lastChild!), 0, 0);
    const text = writeClipboard(workspace.info.id, slice)!;
    const clipboard = readClipboard(schema, text)!;
    const target = (): EditorState => {
        const doc = schema.nodeFromJSON(pageDocument(service.get(b.id)));
        return EditorState.create({ schema, doc, selection: NodeSelection.create(doc, doc.firstChild!.nodeSize), plugins: [identityPlugin()] });
    };
    const paste = (current?: ContentBlock[]): PageRecord => {
        const planned = pasteBlocks(target(), clipboard, current);
        assert.equal(service.commitEdit({ ...planned.edit, pageId: b.id, tabId: "paste", batch: 0, ...(current ? { sync: clipboard.ids } : {}) }, pageHistory(b.id)).status, "saved");
        const sync = workspace.database.prepare("SELECT * FROM sync_refs ORDER BY container_kind,container_id,slot,position");
        const links = workspace.database.prepare("SELECT * FROM link_refs ORDER BY source_kind,source_id,source_field,target_kind,target_id");
        const expectedSync = sync.all(), expectedLinks = links.all();
        rebuildSyncRefs(workspace.database); service.rebuildLinks();
        assert.deepEqual(sync.all(), expectedSync);
        assert.deepEqual(links.all(), expectedLinks);
        return service.get(b.id);
    };
    return { ...workspace, service, history, purge, a, b, parent, child, leaf, clipboard, text, slice, target, paste };
}

test("only closed whole Labloom blocks carry the internal block clipboard format", t => {
    const { slice, text, info } = fixture(t);
    assert.ok(readClipboard(schema, text));
    assert.equal(writeClipboard(info.id, new Slice(slice.content, 1, 1)), null);
    assert.equal(writeClipboard(info.id, new Slice(Fragment.from(schema.text("part of a block")), 0, 0)), null);
    assert.equal(readClipboard(schema, "invalid JSON"), null);
    assert.equal(readClipboard(schema, JSON.stringify(slice.toJSON())), null);
});

for (const origin of ["live", "recycled", "orphan", "purged", "other-workspace"] as const) {
    test("ordinary paste fully copies the snapshot with independent IDs: " + origin, t => {
        const f = fixture(t), { service, history, a, b, parent, child, leaf, clipboard, purge } = f;
        if (origin === "recycled" || origin === "purged") confirm(token => service.trash([a.id], "trash", workspaceHistory, token));
        if (origin === "purged") {
            const preview = purge.purge([a.id], "purge");
            assert.equal(preview.status, "confirmation");
            if (preview.status === "confirmation") purge.purge([a.id], "purge", preview.token);
        }
        if (origin === "orphan") confirm(token => service.deleteBlock({ pageId: a.id, blockId: parent.id, tabId: "delete" }, pageHistory(a.id), token));
        if (origin === "other-workspace") clipboard.workspaceId = randomUUID();
        const available = service.syncBlocks(clipboard.workspaceId, clipboard.ids);
        assert.equal(available !== null, origin === "live");
        if (origin === "live") service.commitEdit({ pageId: a.id, tabId: "source", batch: 1, blocks: [{ ...leaf, payload: payload("paragraph", "Changed after copy") }] }, pageHistory(a.id));
        const result = f.paste(), root = result.blocks[result.children[0]], copiedChild = result.blocks[root.children[0]], copiedLeaf = result.blocks[copiedChild.children[0]];
        assert.ok(![parent.id, child.id, leaf.id].includes(root.id));
        assert.ok(![parent.id, child.id, leaf.id].includes(copiedChild.id));
        assert.ok(![parent.id, child.id, leaf.id].includes(copiedLeaf.id));
        assert.equal(copiedLeaf.payload.inline[0].type === "text" && copiedLeaf.payload.inline[0].text, "Copied leaf");
        assert.equal(service.commitEdit({ pageId: b.id, tabId: "edit-copy", batch: 1, blocks: [{ ...copiedLeaf, payload: payload("paragraph", "Independent") }] }, pageHistory(b.id)).status, "saved");
        if (origin === "live") assert.equal(service.get(a.id).blocks[leaf.id].payload.inline[0].type === "text" && (service.get(a.id).blocks[leaf.id].payload.inline[0] as { text: string }).text, "Changed after copy");
        assert.equal(history.state(pageHistory(f.b.id)).canUndo, true, "both edits belong to the destination page");
        assert.deepEqual(f.database.pragma("foreign_key_check"), []);
    });
}

test("one full-copy paste is one undo record and redo restores the complete subtree", t => {
    const f = fixture(t), before = f.service.get(f.b.id).children, copied = f.paste();
    assert.equal(f.history.apply(pageHistory(f.b.id), "undo").status, "saved");
    assert.deepEqual(f.service.get(f.b.id).children, before);
    assert.equal(f.history.state(pageHistory(f.b.id)).canUndo, false);
    assert.equal(f.history.apply(pageHistory(f.b.id), "redo").status, "saved");
    assert.deepEqual(f.service.get(f.b.id).children, copied.children);
    assert.deepEqual(f.service.get(f.b.id).blocks[copied.children[0]], copied.blocks[copied.children[0]]);
});

test("synchronous paste takes current database content, shares identities and undoes once", t => {
    const f = fixture(t), { service, history, leaf, clipboard } = f, before = service.get(f.b.id).children;
    service.commitEdit({ pageId: f.a.id, tabId: "source", batch: 1, blocks: [{ ...leaf, payload: payload("paragraph", "Current database content") }] }, pageHistory(f.a.id));
    const current = service.syncBlocks(clipboard.workspaceId, clipboard.ids)!;
    const pasted = f.paste(current);
    assert.deepEqual(pasted.children, [f.parent.id]);
    assert.equal(pasted.blocks[leaf.id].payload.inline[0].type === "text" && (pasted.blocks[leaf.id].payload.inline[0] as { text: string }).text, "Current database content");
    assert.equal(history.apply(pageHistory(f.b.id), "undo").status, "saved");
    assert.deepEqual(service.get(f.b.id).children, before);
    assert.equal(history.state(pageHistory(f.b.id)).canUndo, false);
    assert.equal(history.apply(pageHistory(f.b.id), "redo").status, "saved");
    service.commitEdit({ pageId: f.b.id, tabId: "paste", batch: 2, blocks: [{ ...pasted.blocks[leaf.id], payload: payload("paragraph", "Shared edit") }] }, pageHistory(f.b.id));
    assert.deepEqual(service.get(f.a.id).blocks[leaf.id], service.get(f.b.id).blocks[leaf.id]);
});

test("sync eligibility requires every root and is rechecked at commit; cycles and feed bodies remain forbidden", t => {
    const f = fixture(t), { service, clipboard, target } = f;
    assert.equal(service.syncBlocks(clipboard.workspaceId, [...clipboard.ids, randomUUID()]), null);
    const current = service.syncBlocks(clipboard.workspaceId, clipboard.ids)!;
    const planned = pasteBlocks(target(), clipboard, current);
    const doc = schema.nodeFromJSON(pageDocument(service.get(f.a.id))), position = indexDoc(doc).get(f.child.id)![0].pos;
    const cycle = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, position), plugins: [identityPlugin()] });
    assert.throws(() => pasteBlocks(cycle, clipboard, current), hasFailure("block-cycle"));
    const feed = service.create("feed", "Feed");
    assert.throws(() => service.commitEdit({ pageId: feed.id, tabId: "feed", batch: 0, blocks: [], pageChildren: clipboard.ids, sync: clipboard.ids }, pageHistory(feed.id)), hasFailure("feed-body-forbidden"));
    confirm(token => service.trash([f.a.id], "trash", workspaceHistory, token));
    const before = service.get(f.b.id);
    assert.throws(() => service.commitEdit({ ...planned.edit, pageId: f.b.id, tabId: "paste", batch: 0, sync: clipboard.ids }, pageHistory(f.b.id)), hasFailure("block-sync-unavailable"));
    assert.deepEqual(service.get(f.b.id), before);
});

for (const synced of [false, true]) {
    test("pasting whole blocks within existing text preserves both text halves without accidental sync: " + synced, t => {
        const f = fixture(t), original = f.b.blocks[f.b.children[0]];
        f.service.commitEdit({ pageId: f.b.id, tabId: "setup", batch: 1, blocks: [{ ...original, payload: payload("paragraph", "ABCD") }] }, pageHistory(f.b.id));
        const state = f.target(), position = indexDoc(state.doc).get(original.id)![0].pos + 4;
        const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, position)));
        const current = synced ? f.service.syncBlocks(f.clipboard.workspaceId, f.clipboard.ids)! : undefined;
        const planned = pasteBlocks(selected, f.clipboard, current);
        assert.equal(f.service.commitEdit({ ...planned.edit, pageId: f.b.id, tabId: "paste", batch: 1, ...(synced ? { sync: f.clipboard.ids } : {}) }, pageHistory(f.b.id)).status, "saved");
        const saved = f.service.get(f.b.id), bodies = saved.children.map(id => saved.blocks[id]);
        assert.equal(bodies.filter(block => block.id === original.id).length, 1);
        assert.equal(new Set(bodies.map(block => block.id)).size, bodies.length);
        assert.equal(bodies[0].payload.inline[0].type === "text" && bodies[0].payload.inline[0].text, "AB");
        assert.equal(bodies.at(-1)!.payload.inline[0].type === "text" && (bodies.at(-1)!.payload.inline[0] as { text: string }).text, "CD");
        assert.deepEqual(f.database.pragma("foreign_key_check"), []);
    });
}