import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { AttributeService } from "../main/knowledge/attributes";
import { type AttributeDefinition } from "../shared/types/attributes";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { id: string; service: AttributeService } {
    const root = process.env.LABLOOM_TEST_ROOT;
    if (!root) throw new Error("Use the isolated workspace test runner.");
    const workspace = createWorkspace(mkdtempSync(join(root, "attributes-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    const id = randomUUID(), title = randomUUID();
    workspace.database.prepare("INSERT INTO blocks (id,type,content) VALUES (?,'title','Test')").run(title);
    workspace.database.prepare("INSERT INTO pages (id,kind,title_block_id) VALUES (?,'editable',?)").run(id, title);
    return { ...workspace, id, service: new AttributeService(workspace.db) };
}

test("generic attributes preserve scalar types, null versus absent, and atomic validation", t => {
    const { id, service } = fixture(t);
    const text = `custom:${randomUUID()}`, number = `custom:${randomUUID()}`;
    service.applyDefinition(text, { id: text, type: "string", metadata: { name: "Text" } });
    service.applyDefinition(number, { id: number, type: "number", metadata: { name: "Number" } });
    service.write(id, { [text]: "000123", [number]: null, pinned: false });
    assert.equal(service.values(id)[text], "000123");
    assert.equal(service.values(id)[number], null);
    assert.equal(service.values(id).pinned, false);
    assert.throws(() => service.write(id, { [text]: "changed", [number]: "not a number" }));
    assert.equal(service.values(id)[text], "000123");
    service.detach(id, [number]);
    assert.equal(Object.hasOwn(service.values(id), number), false);
    assert.throws(() => service.detach(id, [text, "tags"]));
    assert.equal(service.values(id)[text], "000123");
    assert.throws(() => service.write(id, { paper_doi: "10.example/test" }));
    assert.throws(() => service.write(id, { created_at: new Date().toISOString() }));
});

test("tag option identities survive renames; option removal requires a fresh impact token", t => {
    const { id, service } = fixture(t);
    const option = randomUUID();
    const definition: AttributeDefinition = { id: "tags", type: "multiselect", metadata: { name: "标签", options: [{ id: option, name: "Before" }] } };
    assert.equal(service.applyDefinition("tags", definition), null);
    service.write(id, { tags: [option] });
    definition.metadata.options![0].name = "After";
    assert.equal(service.applyDefinition("tags", definition), null);
    assert.deepEqual(service.values(id).tags, [option]);
    definition.metadata.options = [];
    const preview = service.applyDefinition("tags", definition)!;
    assert.deepEqual(preview.pages.map(page => page.id), [id]);
    assert.deepEqual(service.values(id).tags, [option]);
    assert.ok(service.applyDefinition("tags", definition, "stale"));
    assert.equal(service.applyDefinition("tags", definition, preview.token), null);
    assert.deepEqual(service.values(id).tags, []);
});

test("custom retyping and deletion preview affected owners and preserve valid values", t => {
    const { id, service } = fixture(t);
    const key = `custom:${randomUUID()}`;
    service.applyDefinition(key, { id: key, type: "string", metadata: { name: "Count" } });
    service.write(id, { [key]: "0012" });
    const next: AttributeDefinition = { id: key, type: "number", metadata: { name: "Count" } };
    const preview = service.applyDefinition(key, next)!;
    assert.equal(service.values(id)[key], "0012");
    service.applyDefinition(key, next, preview.token);
    assert.equal(service.values(id)[key], null);
    service.write(id, { [key]: 12 });
    const removal = service.applyDefinition(key, null)!;
    service.write(id, { [key]: 13 });
    assert.ok(service.applyDefinition(key, null, removal.token));
    assert.equal(service.values(id)[key], 13);
});

test("legacy knowledge-garden schemas are rejected before migration writes", t => {
    const { database, info } = fixture(t);
    database.exec("CREATE TABLE page_details (page_id TEXT); PRAGMA user_version = 4;");
    database.close();
    assert.throws(() => openWorkspace(info.path), /knowledge-garden/);
});