import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { builtinAttrs, builtinAttrsByPageKind, editableBuiltinMetadata, type BuiltinAttrId } from "../shared/attrs/builtins";
import { defaultMetadata, defaultValue, encodeValue } from "../shared/attrs/values";
import { type AttributeDefinition, type AttributeType } from "../shared/types/attributes";
import { type PageKind } from "../shared/types/content";
import { KnowledgeService } from "../main/knowledge/service";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { service: KnowledgeService } {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "builtin-attrs-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    return { ...workspace, service: new KnowledgeService(workspace.db) };
}

function definition(type: AttributeType = "string"): AttributeDefinition {
    return { id: "custom:" + randomUUID(), type, name: "A", metadata: defaultMetadata(type) };
}

test("builtin rows keep only editable metadata while complete definitions come from code", t => {
    const { database, service } = fixture(t);
    const rows = database.prepare("SELECT id,type,name,metadata FROM attrs_meta ORDER BY id").all();
    assert.deepEqual(rows, Object.entries(builtinAttrs).sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => ({
        id, type: value.type, name: null, metadata: JSON.stringify(editableBuiltinMetadata(id as BuiltinAttrId) ? value.metadata : {})
    })));
    for (const [id, base] of Object.entries(builtinAttrs)) {
        const resolved = service.attributes.definition(id);
        assert.equal(resolved.name, base.name);
        assert.deepEqual(resolved.metadata, base.metadata);
        assert.equal(!!resolved.hidden, "hidden" in base && base.hidden);
        assert.equal(!!resolved.readonly, "readonly" in base && base.readonly);
    }
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type='view' OR name IN ('edit_tabs','undo_nodes','undo_objects')").all(), []);
    assert.equal(database.prepare("SELECT count(*) FROM pragma_table_info('link_refs') WHERE name='retains'").pluck().get(), 0);
});

test("creating every page kind fills all its builtin attributes through the service", t => {
    const { database, service } = fixture(t), parent = service.create("paper", "A");
    for (const [kind, ids] of Object.entries(builtinAttrsByPageKind)) {
        const page = service.create(kind as PageKind, "B", {}, kind === "annotation" ? parent.id : undefined);
        assert.deepEqual(Object.keys(page.attributes).sort(), [...ids].sort());
        for (const id of ids) {
            if (["created_at", "modified_at"].includes(id)) {
                assert.ok(Number.isSafeInteger(page.attributes[id]));
                continue;
            }
            const expected = id === "independent" ? kind !== "annotation" : id === "task_status" ? "todo" : id === "priority" ? "normal" : id === "feed_status" ? "enabled" : id === "feed_refresh" ? { every: 60, unit: "minute" } : defaultValue(builtinAttrs[id].type);
            assert.deepEqual(page.attributes[id], expected);
            const stored = database.prepare("SELECT value FROM page_attrs WHERE page_id=? AND attr_id=?").pluck().get(page.id, id);
            assert.deepEqual(stored, encodeValue(service.attributes.definition(id), expected));
        }
    }
    const page = service.create();
    service.attributes.changePageKind(page.id, "task");
    assert.ok(builtinAttrsByPageKind.task.every(id => Object.hasOwn(service.get(page.id).attributes, id)));
    assert.deepEqual(database.pragma("foreign_key_check"), []);
});

test("direct writes, edits and creation share builtin permissions and canonical value validation", t => {
    const { service } = fixture(t), page = service.create();
    const custom = definition();
    service.setDefinition(custom.id, custom, "manager");
    const boolean = definition("boolean");
    service.setDefinition(boolean.id, boolean, "manager");
    for (const values of [{ pinned: 2 }, { [boolean.id]: 2 }, { [custom.id]: null }]) {
        assert.throws(() => service.attributes.write(page.id, values));
        assert.throws(() => service.commitEdit({ pageId: page.id, tabId: "edit", batch: 1, blocks: [], attributes: values }));
        assert.throws(() => service.create("editable", "B", values));
    }
    assert.equal(service.get(page.id).attributes.pinned, false);
    assert.throws(() => service.attributes.detach(page.id, ["tags"]), hasFailure("attribute-invalid-detach"));
    assert.throws(() => service.commitEdit({ pageId: page.id, tabId: "edit", batch: 1, blocks: [], detach: ["tags"] }), hasFailure("attribute-invalid-detach"));
    assert.throws(() => service.attributes.write(page.id, { created_at: 0 }), hasFailure("attribute-readonly"));
    assert.throws(() => service.attributes.write(page.id, { task_status: "todo" }), hasFailure("attribute-unsupported-builtin"));
});

test("builtin identity, names, permissions and fixed metadata cannot be edited", t => {
    const { service } = fixture(t), base = service.attributes.definition("task_status");
    for (const value of [null, { ...base, type: "string" as const }, { ...base, id: "other" }, { ...base, name: "Changed" }, { ...base, hidden: true },
        { ...base, metadata: { options: [{ id: "x", name: "X" }] } }]) {
        assert.throws(() => service.setDefinition(base.id, value, "manager"));
    }
    assert.deepEqual(service.attributes.definition(base.id), base);
});

test("metadata has a type-specific shape and retyping normalizes metadata before converting values", t => {
    const { service, database } = fixture(t), select = definition("select");
    for (const value of [
        { ...select, metadata: { options: [{ id: "a", name: "A" }, { id: "a", name: "B" }] } },
        { ...definition(), metadata: { options: [] } },
        { ...select, metadata: { options: [], name: "Wrong location" } },
        { ...select, metadata: { options: [{ id: "a", name: "A", extra: 1 }] } }
    ]) assert.throws(() => service.setDefinition(value.id, value, "manager"), hasFailure("attribute-invalid-metadata"));
    select.metadata.options = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    service.setDefinition(select.id, select, "manager");
    service.setDefinition(select.id, { ...select, type: "multiselect", metadata: {} }, "manager");
    assert.deepEqual(service.attributes.definition(select.id).metadata, select.metadata);
    service.setDefinition(select.id, { ...select, type: "string" }, "manager");
    assert.deepEqual(service.attributes.definition(select.id).metadata, {});
    assert.deepEqual(database.prepare("SELECT name,metadata FROM attrs_meta WHERE id=?").get(select.id), { name: "A", metadata: "{}" });
});

test("editable tag options persist, rename searchable values and never store the builtin name", t => {
    const { service, database, info } = fixture(t), page = service.create("editable", "A"), tags = service.attributes.definition("tags");
    tags.metadata.options = [{ id: "paper", name: "论文" }];
    service.setDefinition("tags", tags, "manager");
    service.commitEdit({ pageId: page.id, tabId: "edit", batch: 1, blocks: [], attributes: { tags: ["paper"] } });
    assert.equal(service.list({ keyword: "论文" }).total, 1);
    tags.metadata.options[0].name = "研究";
    service.setDefinition("tags", tags, "manager");
    assert.equal(service.list({ keyword: "论文" }).total, 0);
    assert.equal(service.list({ keyword: "研究" }).total, 1);
    database.close();
    const reopened = openWorkspace(info.path);
    t.after(() => reopened.database.close());
    const restored = new KnowledgeService(reopened.db);
    assert.deepEqual(restored.attributes.definition("tags").metadata.options, [{ id: "paper", name: "研究" }]);
    assert.deepEqual(restored.get(page.id).attributes.tags, ["paper"]);
    assert.equal(reopened.database.prepare("SELECT name FROM attrs_meta WHERE id='tags'").pluck().get(), null);
});

test("opening validates builtin names, types, fixed metadata and editable metadata without repairing rows", t => {
    for (const sql of [
        "DELETE FROM attrs_meta WHERE id='deleted'",
        "UPDATE attrs_meta SET type='string' WHERE id='deleted'",
        "UPDATE attrs_meta SET name='Changed' WHERE id='tags'",
        "UPDATE attrs_meta SET metadata='{\"options\":[]}' WHERE id='task_status'",
        "UPDATE attrs_meta SET metadata='{}' WHERE id='tags'"
    ]) {
        const { database, info } = fixture(t);
        database.exec(sql);
        database.close();
        const before = readFileSync(join(info.path, "workspace.sqlite"));
        assert.throws(() => openWorkspace(info.path));
        assert.deepEqual(readFileSync(join(info.path, "workspace.sqlite")), before);
    }
});