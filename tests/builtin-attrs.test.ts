import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { builtinAttrs, builtinAttrsByPageKind } from "../shared/attrs/builtins";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { workspaceFormatVersion } from "../main/storage/schema";
import { runMigrations } from "../main/storage/migrations/runner";
import { v1 } from "../main/storage/migrations/v1";
import { v2 } from "../main/storage/migrations/v2";
import { WorkspaceUpgradeError } from "../main/storage/upgrade";

const testRoot = process.env.LABLOOM_TEST_ROOT;
if (!testRoot) throw new Error("Run these tests with node tests/run-workspace.mjs.");
const oldTimestamp = "2001-02-03T04:05:06.789Z";

function directory(): string {
    return mkdtempSync(join(testRoot!, "builtin-attrs-"));
}

function track(t: TestContext, database: Database.Database): Database.Database {
    t.after(() => {
        if (database.open) database.close();
    });
    return database;
}

function fresh(t: TestContext): { database: Database.Database; root: string; } {
    const workspace = createWorkspace(directory());
    return { database: track(t, workspace.database), root: workspace.info.path };
}

function page(database: Database.Database, kind: string): string {
    const id = randomUUID();
    const title = randomUUID();
    database.prepare("INSERT INTO blocks (id, type) VALUES (?, 'title')").run(title);
    database.prepare("INSERT INTO pages (id, kind, title_block_id) VALUES (?, ?, ?)").run(id, kind, title);
    return id;
}

function versionTwo<T>(setup: (database: Database.Database) => T): { root: string; id: string; data: T; } {
    const root = directory();
    const id = randomUUID();
    mkdirSync(join(root, "attachments"));
    const database = new Database(join(root, "workspace.sqlite"));
    try {
        database.pragma("application_id = 0x4c424c4d");
        database.pragma("foreign_keys = ON");
        runMigrations(database, [v1, v2]);
        database.prepare("INSERT INTO workspace_meta (id, name, created_at, last_modified_at) VALUES (?, 'Version 2', ?, ?)")
            .run(id, oldTimestamp, oldTimestamp);
        const data = setup(database);
        database.prepare("UPDATE workspace_meta SET last_modified_at = ?").run(oldTimestamp);
        return { root, id, data };
    }
    finally {
        database.close();
    }
}

test("only deleted is seeded, with an empty value for each supported page kind", t => {
    const { database } = fresh(t);
    const definitions = database.prepare("SELECT id, type, metadata FROM attrs ORDER BY id").all();
    assert.deepEqual(definitions, Object.entries(builtinAttrs).map(([id, definition]) => ({
        id, type: definition.type, metadata: JSON.stringify(definition.metadata)
    })));
    assert.deepEqual(definitions, [{ id: "deleted", type: "boolean", metadata: "{}" }]);
    for (const [kind, attrs] of Object.entries(builtinAttrsByPageKind)) {
        const id = page(database, kind);
        assert.deepEqual(database.prepare("SELECT attr_id, value FROM page_attrs WHERE page_id = ? ORDER BY attr_id").all(id),
            attrs.map(attrId => ({ attr_id: attrId, value: null })));
    }
    assert.equal(database.pragma("user_version", { simple: true }), 3);
    assert.deepEqual(database.prepare("SELECT user_version AS labloom_format_version FROM pragma_user_version").get(), {
        labloom_format_version: workspaceFormatVersion
    });
});

test("builtin definitions keep their identity and type while metadata remains editable", t => {
    const { database, root } = fresh(t);
    assert.throws(() => database.exec("DELETE FROM attrs WHERE id = 'deleted'"), /builtin attributes cannot be deleted/);
    assert.throws(() => database.exec("UPDATE attrs SET id = 'custom:renamed' WHERE id = 'deleted'"), /cannot be changed/);
    assert.throws(() => database.exec("UPDATE attrs SET type = 'string' WHERE id = 'deleted'"), /cannot be changed/);
    assert.throws(() => database.exec("INSERT OR REPLACE INTO attrs (id, type) VALUES ('deleted', 'number')"), /must have type boolean/);
    database.exec("INSERT INTO attrs (id, type) VALUES ('custom:text', 'string')");
    assert.throws(() => database.exec("UPDATE OR REPLACE attrs SET id = 'deleted' WHERE id = 'custom:text'"), /cannot be changed/);
    const metadata = JSON.stringify({ name: "Custom deleted metadata" });
    database.prepare("UPDATE attrs SET metadata = ? WHERE id = 'deleted'").run(metadata);
    const before = database.prepare("SELECT last_modified_at FROM workspace_meta").get();
    database.close();
    const reopened = track(t, openWorkspace(root).database);
    assert.deepEqual(reopened.prepare("SELECT type, metadata FROM attrs WHERE id = 'deleted'").get(), { type: "boolean", metadata });
    assert.deepEqual(reopened.prepare("SELECT last_modified_at FROM workspace_meta").get(), before);
});

test("deleted accepts empty and boolean values but cannot be detached or moved", t => {
    const { database } = fresh(t);
    const id = page(database, "editable");
    const other = page(database, "paper");
    const update = database.prepare("UPDATE page_attrs SET value = ? WHERE page_id = ? AND attr_id = 'deleted'");
    for (const value of [0, 1, null]) {
        update.run(value, id);
        assert.deepEqual(database.prepare("SELECT value FROM page_attrs WHERE page_id = ? AND attr_id = 'deleted'").get(id), { value });
    }
    for (const value of [2, -1, 0.5, "true", "1", "[]"]) {
        assert.throws(() => update.run(value, id), /must be NULL, 0, or 1/);
    }
    assert.throws(() => database.prepare("DELETE FROM page_attrs WHERE page_id = ? AND attr_id = 'deleted'").run(id), /cannot remove a builtin attribute/);
    database.exec("INSERT INTO attrs (id, type) VALUES ('custom:test', 'boolean')");
    assert.throws(() => database.prepare("UPDATE page_attrs SET attr_id = 'custom:test' WHERE page_id = ? AND attr_id = 'deleted'").run(id), /cannot remove a builtin attribute/);
    assert.throws(() => database.prepare("UPDATE page_attrs SET page_id = ? WHERE page_id = ? AND attr_id = 'deleted'").run(other, id), /cannot remove a builtin attribute/);
    update.run(1, id);
    database.prepare("UPDATE pages SET kind = 'paper' WHERE id = ?").run(id);
    assert.deepEqual(database.prepare("SELECT attr_id, value FROM page_attrs WHERE page_id = ?").all(id), [{ attr_id: "deleted", value: 1 }]);
});

test("ordinary attributes can be attached, removed, and retyped, and page deletion cleans up its values", t => {
    const { database } = fresh(t);
    const id = page(database, "editable");
    database.exec("INSERT INTO attrs (id, type) VALUES ('custom:test', 'string')");
    database.prepare("INSERT INTO page_attrs (page_id, attr_id) VALUES (?, 'custom:test')").run(id);
    database.exec("UPDATE attrs SET type = 'number' WHERE id = 'custom:test'");
    database.prepare("DELETE FROM page_attrs WHERE page_id = ? AND attr_id = 'custom:test'").run(id);
    database.exec("DELETE FROM attrs WHERE id = 'custom:test'");
    database.prepare("DELETE FROM pages WHERE id = ?").run(id);
    assert.deepEqual(database.prepare("SELECT * FROM page_attrs WHERE page_id = ?").all(id), []);
    assert.ok(database.prepare("SELECT id FROM attrs WHERE id = 'deleted'").get());
    assert.deepEqual(database.pragma("foreign_key_check"), []);
});

test("version 2 gains deleted and empty ownership rows without changing modification time", t => {
    const fixture = versionTwo(database => [page(database, "editable"), page(database, "paper")]);
    const database = track(t, openWorkspace(fixture.root, fixture.id).database);
    assert.equal(database.pragma("user_version", { simple: true }), 3);
    assert.deepEqual(database.prepare("SELECT id, type, metadata FROM attrs").all(), [{ id: "deleted", type: "boolean", metadata: "{}" }]);
    for (const id of fixture.data) {
        assert.deepEqual(database.prepare("SELECT attr_id, value FROM page_attrs WHERE page_id = ?").all(id), [{ attr_id: "deleted", value: null }]);
    }
    assert.deepEqual(database.prepare("SELECT last_modified_at FROM workspace_meta").get(), { last_modified_at: oldTimestamp });
    const paths = readdirSync(join(fixture.root, "backups"));
    assert.equal(paths.length, 1);
    const backup = track(t, new Database(join(fixture.root, "backups", paths[0]), { readonly: true, fileMustExist: true }));
    assert.equal(backup.pragma("user_version", { simple: true }), 2);
    assert.deepEqual(backup.prepare("SELECT * FROM attrs").all(), []);
    assert.equal(backup.prepare("SELECT count(*) FROM pages").pluck().get(), 2);
    const schema = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name";
    assert.deepEqual(database.prepare(schema).all(), fresh(t).database.prepare(schema).all());
});

test("version 2 retains existing builtin metadata and values, including deleted pages", t => {
    const metadata = JSON.stringify({ name: "Keep this metadata" });
    const fixture = versionTwo(database => {
        database.prepare("INSERT INTO attrs (id, type, metadata) VALUES ('deleted', 'boolean', ?)").run(metadata);
        const ids = [page(database, "editable"), page(database, "paper")];
        database.prepare("INSERT INTO page_attrs VALUES (?, 'deleted', 1)").run(ids[0]);
        database.prepare("INSERT INTO page_attrs VALUES (?, 'deleted', NULL)").run(ids[1]);
        return ids;
    });
    const database = track(t, openWorkspace(fixture.root, fixture.id).database);
    assert.deepEqual(database.prepare("SELECT metadata FROM attrs WHERE id = 'deleted'").get(), { metadata });
    assert.deepEqual(database.prepare("SELECT value FROM page_attrs WHERE page_id = ? AND attr_id = 'deleted'").get(fixture.data[0]), { value: 1 });
    assert.deepEqual(database.prepare("SELECT value FROM page_attrs WHERE page_id = ? AND attr_id = 'deleted'").get(fixture.data[1]), { value: null });
    assert.deepEqual(database.prepare("SELECT last_modified_at FROM workspace_meta").get(), { last_modified_at: oldTimestamp });
});

test("conflicting builtin definitions or invalid old values abort the upgrade without overwriting data", t => {
    for (const type of ["string", "boolean"]) {
        const fixture = versionTwo(database => {
            database.prepare("INSERT INTO attrs (id, type) VALUES ('deleted', ?)").run(type);
            const id = page(database, "editable");
            database.prepare("INSERT INTO page_attrs VALUES (?, 'deleted', 'keep this invalid value')").run(id);
            return id;
        });
        assert.throws(() => openWorkspace(fixture.root, fixture.id), error => {
            assert.ok(error instanceof WorkspaceUpgradeError);
            assert.equal(error.failure.stage, "migration");
            assert.equal(error.failure.fromVersion, 2);
            assert.equal(error.failure.toVersion, 3);
            assert.match(error.failure.error.message, type === "string" ? /incompatible type/ : /value is invalid/);
            return true;
        });
        const database = track(t, new Database(join(fixture.root, "workspace.sqlite"), { readonly: true, fileMustExist: true }));
        assert.equal(database.pragma("user_version", { simple: true }), 2);
        assert.deepEqual(database.prepare("SELECT type FROM attrs WHERE id = 'deleted'").get(), { type });
        assert.deepEqual(database.prepare("SELECT value FROM page_attrs WHERE page_id = ?").get(fixture.data), { value: "keep this invalid value" });
        assert.equal(database.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'builtin_attrs_delete'").pluck().get(), 0);
    }
});