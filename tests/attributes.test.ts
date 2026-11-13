import { convertValue } from "../shared/attrs/convert";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { AttributeService } from "../main/knowledge/attributes";
import { builtinAttrs } from "../shared/attrs/builtins";
import { display, search } from "../shared/attrs/format";
import { decodeValue, defaultMetadata, defaultValue, emptyValue, encodeValue, isEmpty, nullable, validateValue } from "../shared/attrs/values";
import { attributeTypes, type AttributeDefinition, type AttributeType, type AttributeValue } from "../shared/types/attributes";

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { id: string; service: AttributeService } {
    const root = process.env.LABLOOM_TEST_ROOT;
    if (!root) throw new Error("Use the isolated workspace test runner.");
    const workspace = createWorkspace(mkdtempSync(join(root, "attributes-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    const id = new KnowledgeService(workspace.db).create("editable", "Test").id;
    return { ...workspace, id, service: new AttributeService(workspace.db) };
}

test("generic attributes preserve scalar types, null versus absent, and atomic validation", t => {
    const { id, service } = fixture(t);
    const text = `custom:${randomUUID()}`, number = `custom:${randomUUID()}`;
    service.applyDefinition(text, { id: text, type: "string", name: "Text", metadata: {} });
    service.applyDefinition(number, { id: number, type: "number", name: "Number", metadata: {} });
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
    const definition: AttributeDefinition = { id: "tags", type: "multiselect", name: "标签", metadata: { options: [{ id: option, name: "Before" }] } };
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
    service.applyDefinition(key, { id: key, type: "string", name: "Count", metadata: {} });
    service.write(id, { [key]: "0012" });
    const next: AttributeDefinition = { id: key, type: "number", name: "Count", metadata: {} };
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

test("every attribute type has display and search text, with independent builtin overrides", () => {
    const zone = { zone: "Asia/Singapore" };
    const metadata = { options: [{ id: "x", name: "甲" }, { id: "y", name: "乙" }] };
    const cases: [AttributeDefinition["type"], AttributeValue, string, string][] = [
        ["string", "000123", "000123", "000123"], ["url", "https://labloom.dev", "https://labloom.dev", "https://labloom.dev"],
        ["number", 0, "0", "0"], ["day", Date.UTC(2026, 10, 8) / 1000, "2026-11-08", "2026-11-08"],
        ["minute", 1794071576, "2026-11-08 01:12", "2026-11-08 01:12"],
        ["boolean", true, "是", ""], ["boolean", false, "否", ""],
        ["select", "x", "甲", "甲"], ["multiselect", ["y", "x"], "乙、甲", "乙、甲"],
        ["page-link", randomUUID(), "", ""], ["page-links", [randomUUID()], "", ""], ["json", { visible: true }, "", ""]
    ];
    for (const [type, value, label, keyword] of cases) {
        const def = { name: "属性", id: "custom:" + randomUUID(), type, metadata: type === "select" || type === "multiselect" ? metadata : defaultMetadata(type) };
        assert.equal(display(def, value, zone), label);
        assert.equal(search(def, value, zone), keyword);
    }
    for (const [id, value, label] of [
        ["recycle_reason", "unreachable", "失去保留关系"], ["recycled_at", 1794071576, "2026-11-08 01:12"],
        ["annotation_context", "anchor", "anchor"]
    ] as const) {
        const def = { id, ...builtinAttrs[id] };
        assert.equal(display(def, value, zone), label);
        assert.equal(search(def, value, zone), "");
    }
    const dt = { id: "created_at", ...builtinAttrs.created_at };
    for (const value of [1.2, Infinity, Number.MAX_SAFE_INTEGER + 1, "2026-11-07T17:12:56.210Z"]) assert.throws(() => validateValue(dt, value));
    validateValue(dt, 0);
});

test("each attribute type round-trips its canonical empty or required default", () => {
    const cases: Record<AttributeType, [AttributeValue, string | number | null]> = {
        string: ["", ""], url: ["", ""], number: [null, null], minute: [null, null], hour: [null, null], day: [null, null], month: [null, null], year: [null, null],
        select: [null, null], "page-link": [null, null], multiselect: [[], "[]"], "page-links": [[], "[]"], file: [null, null], files: [[], "[]"], recurrence: [null, null],
        json: [null, "null"], boolean: [false, 0]
    };
    for (const type of attributeTypes) {
        const def = { name: "属性", id: "custom:" + randomUUID(), type, metadata: defaultMetadata(type) };
        const [initial, stored] = cases[type];
        assert.deepEqual(defaultValue(type), initial);
        assert.equal(encodeValue(def, initial), stored);
        assert.deepEqual(decodeValue(def, stored), initial);
        assert.equal(nullable(type), type !== "boolean");
        assert.equal(isEmpty(type, initial), nullable(type));
        if (nullable(type)) {
            assert.deepEqual(emptyValue(type), initial);
            assert.equal(display(def, initial), "");
            assert.equal(search(def, initial), "");
        }
        else assert.throws(() => emptyValue(type));
        for (const other of [null, "", []]) {
            if (isEmpty(type, other)) continue;
            if (type === "json") validateValue(def, other); // JSON strings and arrays are ordinary, nonempty JSON values.
            else assert.throws(() => validateValue(def, other), type);
        }
        if (stored !== null) assert.throws(() => decodeValue(def, null), type);
    }
    assert.notEqual(defaultValue("page-links"), defaultValue("page-links"));
});

test("retyping falls back to the target type default, including previously empty rows", t => {
    const { id, service } = fixture(t);
    const key = `custom:${randomUUID()}`;
    for (const [text, type] of [["差不多", "boolean"], ["很急", "number"]] as const) {
        const original = { name: "属性", id: key, type: "string" as const, metadata: {} };
        const back = service.applyDefinition(key, original);
        if (back) service.applyDefinition(key, original, back.token);
        service.write(id, { [key]: text });
        const target = { ...original, type };
        const preview = service.applyDefinition(key, target)!;
        assert.deepEqual(preview.pages.map(p => p.id), [id]);
        assert.equal(service.values(id)[key], text);
        service.applyDefinition(key, target, preview.token);
        assert.equal(service.values(id)[key], defaultValue(type));
    }
    const target = { name: "属性", id: key, type: "page-links" as const, metadata: {} };
    const impact = service.applyDefinition(key, target)!;
    service.applyDefinition(key, target, impact.token);
    assert.deepEqual(service.values(id)[key], []);
});

test("removing options clears a selected option and preserves remaining multiselect choices", t => {
    const { id, service } = fixture(t);
    for (const type of ["select", "multiselect"] as const) {
        const key = `custom:${randomUUID()}`, a = { id: "a", name: "A" }, b = { id: "b", name: "B" };
        const original = { name: "属性", id: key, type, metadata: { options: [a, b] } };
        service.applyDefinition(key, original);
        service.write(id, { [key]: type === "select" ? a.id : [a.id, b.id] });
        const next = { ...original, metadata: { options: [b] } };
        const preview = service.applyDefinition(key, next)!;
        assert.deepEqual(preview.pages.map(page => page.id), [id]);
        service.applyDefinition(key, next, preview.token);
        assert.deepEqual(service.values(id)[key], type === "select" ? null : [b.id]);
    }
});

test("recurrence has a canonical nullable JSON value, readable search text and empty cross-type conversions", () => {
    const recurrence: AttributeDefinition = { id: "feed_refresh", type: "recurrence", name: "重复", metadata: {} }, value = { every: 2, unit: "week" };
    validateValue(recurrence, value);
    assert.deepEqual(decodeValue(recurrence, encodeValue(recurrence, value)), value);
    assert.equal(encodeValue(recurrence, null), null);
    assert.equal(display(recurrence, value), "每 2 周"); assert.equal(search(recurrence, value), "每 2 周");
    for (const invalid of [{ every: 0, unit: "minute" }, { every: 1.5, unit: "hour" }, { every: 1, unit: "year" }, { every: 1, unit: "day", action: "x" }, [], "每天"]) assert.throws(() => validateValue(recurrence, invalid));
    for (const type of attributeTypes.filter(type => type !== "recurrence")) {
        const definition: AttributeDefinition = { id: "custom:" + randomUUID(), type, name: "A", metadata: defaultMetadata(type) };
        assert.deepEqual(convertValue(recurrence, definition, value, "UTC"), defaultValue(type));
        assert.equal(convertValue(definition, recurrence, defaultValue(type), "UTC"), null);
    }
});