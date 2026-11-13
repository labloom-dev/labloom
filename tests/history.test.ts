import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { EditHistory } from "../main/knowledge/history";
import { KnowledgeService } from "../main/knowledge/service";
import { PurgeService } from "../main/knowledge/purge";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { blockText, payload } from "../shared/content/blocks";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { service: KnowledgeService; history: EditHistory } {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "history-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    const service = new KnowledgeService(workspace.db), history = new EditHistory(service);
    return { ...workspace, service, history };
}

function edit(service: KnowledgeService, pageId: string, tabId: string, text: string): void {
    const page = service.get(pageId), block = page.blocks[page.children[0]];
    assert.equal(service.commitEdit({ pageId, tabId, batch: 1, blocks: [{ ...block, payload: payload("paragraph", text) }] }).status, "saved");
}

function text(service: KnowledgeService, pageId: string): string {
    const page = service.get(pageId);
    return blockText(page.blocks[page.children[0]]);
}

test("windows on the same workspace share history and invalidate overlapping edits", t => {
    const { service, history, db } = fixture(t), page = service.create();
    const window = new KnowledgeService(db), other = new EditHistory(window);
    edit(service, page.id, "a", "A");
    assert.equal(other.state("a").canUndo, true);
    other.apply("a", "undo");
    assert.equal(text(service, page.id), "");
    history.apply("a", "redo");
    assert.equal(text(window, page.id), "A");
    edit(window, page.id, "b", "B");
    assert.deepEqual(history.state("a"), { canUndo: false, redo: [] });
    assert.equal(history.state("b").canUndo, true);
    service.transaction(() => edit(window, page.id, "c", "C"));
    assert.equal(history.state("c").canUndo, true);
    const before = other.state("c");
    assert.throws(() => service.transaction(() => {
        edit(window, page.id, "d", "D");
        throw new Error("Abort another window");
    }), /Abort another/);
    assert.equal(text(service, page.id), "C");
    assert.deepEqual(other.state("c"), before);
    assert.equal(other.state("d").canUndo, false);
});

test("overlapping ancestors are removed while unrelated descendants and redo branches survive", t => {
    const { service, history } = fixture(t), a = service.create(), b = service.create();
    edit(service, a.id, "a", "A");
    edit(service, b.id, "a", "B");
    history.apply("a", "undo");
    const branch = history.state("a").redo[0].id;
    edit(service, b.id, "a", "C");
    history.apply("a", "undo");
    assert.equal(history.state("a").redo.length, 2);
    edit(service, a.id, "b", "D");
    assert.equal(history.state("a").canUndo, false);
    assert.equal(history.state("a").redo.length, 2);
    history.apply("a", "redo", branch);
    assert.equal(text(service, b.id), "B");
    history.apply("a", "undo");
    assert.equal(text(service, b.id), "");
    assert.equal(text(service, a.id), "D");
});

test("a rolled-back outer transaction neither captures history nor invalidates other tabs", t => {
    const { service, history } = fixture(t), page = service.create();
    edit(service, page.id, "a", "A");
    const before = history.state("a");
    assert.throws(() => service.transaction(() => {
        edit(service, page.id, "b", "B");
        throw new Error("Abort outer transaction");
    }), /Abort outer/);
    assert.equal(text(service, page.id), "A");
    assert.deepEqual(history.state("a"), before);
    assert.deepEqual(history.state("b"), { canUndo: false, redo: [] });
    history.apply("a", "undo");
    assert.equal(text(service, page.id), "");
    const undo = history.state("a");
    assert.ok(Number.isSafeInteger(undo.redo[0].time) && undo.redo[0].time > 1e12);
    assert.throws(() => service.transaction(() => {
        history.apply("a", "redo");
        throw new Error("Abort redo");
    }), /Abort redo/);
    assert.equal(text(service, page.id), "");
    assert.deepEqual(history.state("a"), undo);
});

test("closing a tab removes undo and redo, and reusing its ID starts a fresh tree", t => {
    const { service, history } = fixture(t), page = service.create();
    edit(service, page.id, "a", "A");
    history.apply("a", "undo");
    assert.equal(history.state("a").redo.length, 1);
    history.close("a");
    assert.deepEqual(history.state("a"), { canUndo: false, redo: [] });
    edit(service, page.id, "b", "B");
    edit(service, page.id, "a", "C");
    assert.equal(history.state("b").canUndo, false);
    history.apply("a", "undo");
    assert.equal(text(service, page.id), "B");
    history.close("a");
    assert.throws(() => history.apply("a", "redo"), hasFailure("history-empty"));
});

test("reopening preserves content and loses every undo and redo branch", t => {
    const { service, history, database, info } = fixture(t), page = service.create();
    edit(service, page.id, "a", "A");
    edit(service, page.id, "a", "B");
    history.apply("a", "undo");
    database.close();
    const workspace = openWorkspace(info.path);
    t.after(() => workspace.database.close());
    const restored = new KnowledgeService(workspace.db), next = new EditHistory(restored);
    assert.equal(text(restored, page.id), "A");
    assert.deepEqual(next.state("a"), { canUndo: false, redo: [] });
    assert.throws(() => next.apply("a", "undo"), hasFailure("history-empty"));
});

test("permanent deletion clears unrelated history in every window only after confirmation", t => {
    const { service, history, db, info } = fixture(t), a = service.create(), b = service.create();
    const window = new KnowledgeService(db), other = new EditHistory(window), purge = new PurgeService(service, history, info.path);
    edit(service, a.id, "a", "A");
    edit(window, b.id, "b", "B");
    const trash = service.trash([a.id], "trash");
    assert.equal(trash.status, "confirmation");
    service.trash([a.id], "trash", trash.preview.token);
    const before = other.state("b"), preview = purge.purge([a.id], "purge");
    assert.equal(preview.status, "confirmation");
    assert.deepEqual(other.state("b"), before);
    const deleted = purge.purge([a.id], "purge", preview.token);
    assert.equal(deleted.status, "deleted");
    for (const tab of ["a", "b", "trash"]) assert.deepEqual(other.state(tab), { canUndo: false, redo: [] });
    assert.deepEqual(history.state("b"), { canUndo: false, redo: [] });
    assert.equal(text(service, b.id), "B");
});

test("removing a detached attribute definition invalidates history that could restore its values", t => {
    const { service, history } = fixture(t), page = service.create();
    const definition = { id: "custom:" + randomUUID(), type: "string" as const, name: "A", metadata: {} };
    service.setDefinition(definition.id, definition, "manager");
    service.commitEdit({ pageId: page.id, tabId: "a", batch: 1, blocks: [], attributes: { [definition.id]: "A" } });
    service.setDefinition(definition.id, { ...definition, name: "B" }, "manager");
    assert.equal(history.state("a").canUndo, true);
    service.commitEdit({ pageId: page.id, tabId: "a", batch: 2, blocks: [], detach: [definition.id] });
    assert.equal(history.state("a").canUndo, true);
    service.setDefinition(definition.id, null, "manager");
    assert.deepEqual(history.state("a"), { canUndo: false, redo: [] });
});