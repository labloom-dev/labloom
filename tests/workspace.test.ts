import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { rebuildBlockUses, workspaceFormatVersion } from "../main/storage/schema";
import { createWorkspace, openWorkspace, type OpenWorkspace } from "../main/storage/workspace";
import { runMigrations, type WorkspaceMigration } from "../main/storage/migrations/runner";
import { WorkspaceUpgradeError } from "../main/storage/upgrade";
import { AppStorage } from "../main/storage/app";
import { Startup } from "../main/startup/startup";
import { logUpgradeFailure } from "../renderer/components/startup/log-upgrade-failure";

const testRoot = process.env.LABLOOM_TEST_ROOT;
if (!testRoot) throw new Error("Run these tests with node tests/run-workspace.mjs.");

const applicationId = 0x4c424c4d;
const oldTimestamp = "2001-02-03T04:05:06.789Z";

type WorkspaceMeta = {
    id: string;
    name: string;
    created_at: string;
    last_modified_at: string;
    settings: string;
};

function directory(): string {
    return mkdtempSync(join(testRoot!, "workspace-"));
}

function track(t: TestContext, workspace: OpenWorkspace): OpenWorkspace {
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    return workspace;
}

function fresh(t: TestContext): OpenWorkspace {
    return track(t, createWorkspace(directory()));
}

function meta(database: Database.Database): WorkspaceMeta {
    return database.prepare<[], WorkspaceMeta>("SELECT * FROM workspace_meta").get()!;
}

function block(database: Database.Database, type = "paragraph", children: string[] = []): string {
    const id = randomUUID();
    database.prepare("INSERT INTO blocks (id, type, children) VALUES (?, ?, ?)").run(id, type, JSON.stringify(children));
    return id;
}

function page(database: Database.Database, children: string[] = []): { id: string; title: string; } {
    const id = randomUUID();
    const title = block(database, "title");
    database.prepare("INSERT INTO pages (id, kind, title_block_id, children) VALUES (?, 'editable', ?, ?)")
        .run(id, title, JSON.stringify(children));
    return { id, title };
}

function uses(database: Database.Database): unknown[] {
    return database.prepare("SELECT * FROM block_uses ORDER BY container_kind, container_id, slot, position").all();
}

function legacy(): { root: string; id: string; } {
    const root = directory();
    const id = randomUUID();
    mkdirSync(join(root, "attachments"));
    writeFileSync(join(root, "attachments", "preserved.txt"), "keep this attachment");
    const database = new Database(join(root, "workspace.sqlite"));
    try {
        database.pragma(`application_id = ${applicationId}`);
        database.pragma("user_version = 1");
        database.exec("CREATE TABLE workspace_meta (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL)");
        database.prepare("INSERT INTO workspace_meta VALUES (?, 'Existing workspace', ?)").run(id, oldTimestamp);
    }
    finally {
        database.close();
    }
    return { root, id };
}

function raw<T>(root: string, action: (database: Database.Database) => T): T {
    const database = new Database(join(root, "workspace.sqlite"), { fileMustExist: true });
    try {
        return action(database);
    }
    finally {
        database.close();
    }
}

function backups(root: string): string[] {
    return readdirSync(join(root, "backups")).map(name => join(root, "backups", name));
}

function snapshot<T>(path: string, action: (database: Database.Database) => T): T {
    const database = new Database(path, { readonly: true, fileMustExist: true });
    try {
        assert.deepEqual(database.pragma("quick_check"), [{ quick_check: "ok" }]);
        assert.equal(database.pragma("application_id", { simple: true }), applicationId);
        return action(database);
    }
    finally {
        database.close();
    }
}

test("new workspaces contain the six strict tables and reopen without changing timestamps", t => {
    const workspace = fresh(t);
    const { database, info } = workspace;
    assert.equal(database.pragma("application_id", { simple: true }), applicationId);
    assert.equal(database.pragma("user_version", { simple: true }), workspaceFormatVersion);
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
    assert.deepEqual(database.prepare("SELECT name, strict FROM pragma_table_list WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(), [
        { name: "attrs", strict: 1 },
        { name: "block_uses", strict: 1 },
        { name: "blocks", strict: 1 },
        { name: "page_attrs", strict: 1 },
        { name: "pages", strict: 1 },
        { name: "workspace_meta", strict: 1 }
    ]);
    const before = meta(database);
    assert.equal(before.id, info.id);
    assert.equal(before.name, info.name);
    assert.equal(before.created_at, before.last_modified_at);
    assert.equal(new Date(before.created_at).toISOString(), before.created_at);
    assert.equal(before.settings, "{}");
    assert.ok(existsSync(join(info.path, "attachments")));
    database.close();
    const reopened = track(t, openWorkspace(info.path, info.id));
    assert.deepEqual(meta(reopened.database), before);
    assert.equal(reopened.database.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(existsSync(join(info.path, "backups")), false);
});

test("version 1 migrates without changing workspace identity, creation time, or attachments", t => {
    const { root, id } = legacy();
    const { database } = track(t, openWorkspace(root, id));
    assert.equal(database.pragma("user_version", { simple: true }), workspaceFormatVersion);
    assert.deepEqual(meta(database), {
        id,
        name: "Existing workspace",
        created_at: oldTimestamp,
        last_modified_at: oldTimestamp,
        settings: "{}"
    });
    assert.equal(readFileSync(join(root, "attachments", "preserved.txt"), "utf8"), "keep this attachment");
    const created = page(database);
    database.close();
    const reopened = track(t, openWorkspace(root, id));
    assert.ok(reopened.database.prepare("SELECT id FROM pages WHERE id = ?").get(created.id));
    assert.deepEqual(reopened.database.pragma("foreign_key_check"), []);
    assert.deepEqual(reopened.database.pragma("quick_check"), [{ quick_check: "ok" }]);
    const paths = backups(root);
    assert.equal(paths.length, 1);
    assert.match(paths[0], /workspace-v1-.*\.sqlite$/);
    snapshot(paths[0], backup => {
        assert.equal(backup.pragma("user_version", { simple: true }), 1);
        assert.deepEqual(backup.prepare("SELECT * FROM workspace_meta").get(), { id, name: "Existing workspace", created_at: oldTimestamp });
        assert.deepEqual(backup.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all(), ["workspace_meta"]);
    });
    const schema = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name";
    assert.deepEqual(reopened.database.prepare(schema).all(), fresh(t).database.prepare(schema).all());
});

test("identity, application, version, and attachment validation happens before migration", () => {
    const mismatched = legacy();
    assert.throws(() => openWorkspace(mismatched.root, randomUUID()), /workspace at this location has changed/);
    assert.equal(existsSync(join(mismatched.root, "backups")), false);
    raw(mismatched.root, database => {
        assert.equal(database.pragma("user_version", { simple: true }), 1);
        assert.deepEqual(database.prepare("SELECT name FROM pragma_table_info('workspace_meta')").pluck().all(), ["id", "name", "created_at"]);
    });

    for (const version of [0, workspaceFormatVersion + 1]) {
        const fixture = legacy();
        raw(fixture.root, database => database.pragma(`user_version = ${version}`));
        assert.throws(() => openWorkspace(fixture.root), /workspace format is incompatible/);
        assert.equal(existsSync(join(fixture.root, "backups")), false);
        raw(fixture.root, database => assert.equal(database.pragma("user_version", { simple: true }), version));
    }

    const foreign = legacy();
    raw(foreign.root, database => database.pragma("application_id = 1"));
    assert.throws(() => openWorkspace(foreign.root), /not a valid Labloom workspace/);
    assert.equal(existsSync(join(foreign.root, "backups")), false);
    raw(foreign.root, database => assert.equal(database.pragma("user_version", { simple: true }), 1));

    const missing = directory();
    const database = new Database(join(missing, "workspace.sqlite"));
    database.pragma(`application_id = ${applicationId}`);
    database.pragma("user_version = 1");
    database.exec("CREATE TABLE workspace_meta (id TEXT, name TEXT, created_at TEXT)");
    database.prepare("INSERT INTO workspace_meta VALUES (?, 'Missing attachments', ?)").run(randomUUID(), oldTimestamp);
    database.close();
    assert.throws(() => openWorkspace(missing), /ENOENT/);
    assert.equal(existsSync(join(missing, "backups")), false);
    raw(missing, existing => assert.equal(existing.pragma("user_version", { simple: true }), 1));
});

test("a failed migration rolls back all schema and version changes", () => {
    const { root, id } = legacy();
    raw(root, database => {
        database.exec("CREATE TABLE attrs (sentinel TEXT); INSERT INTO attrs VALUES ('preserve me');");
    });
    assert.throws(() => openWorkspace(root, id), (error: unknown) => {
        assert.ok(error instanceof WorkspaceUpgradeError);
        assert.equal(error.failure.stage, "migration");
        assert.match(error.failure.error.message, /already exists/);
        assert.equal(error.failure.error.code, "SQLITE_ERROR");
        assert.equal(error.failure.backupPath, backups(root)[0]);
        snapshot(error.failure.backupPath!, backup => {
            assert.equal(backup.pragma("user_version", { simple: true }), 1);
            assert.deepEqual(backup.prepare("SELECT * FROM attrs").get(), { sentinel: "preserve me" });
        });
        return true;
    });
    raw(root, database => {
        assert.equal(database.pragma("user_version", { simple: true }), 1);
        assert.deepEqual(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all(), ["attrs", "workspace_meta"]);
        assert.deepEqual(database.prepare("SELECT * FROM workspace_meta").get(), { id, name: "Existing workspace", created_at: oldTimestamp });
        assert.deepEqual(database.prepare("SELECT * FROM attrs").get(), { sentinel: "preserve me" });
    });
});

test("attribute ownership is distinct from an empty value and ANY retains scalar types", t => {
    const { database } = fresh(t);
    const first = page(database);
    const second = page(database);
    database.exec("INSERT INTO attrs (id, type) VALUES ('custom:text', 'string'), ('custom:number', 'number'), ('label', 'multi_select')");
    database.prepare("INSERT INTO page_attrs (page_id, attr_id) VALUES (?, 'custom:text')").run(first.id);
    assert.deepEqual(database.prepare("SELECT value FROM page_attrs WHERE page_id = ? AND attr_id = 'custom:text'").get(first.id), { value: null });
    assert.equal(database.prepare("SELECT value FROM page_attrs WHERE page_id = ? AND attr_id = 'custom:text'").get(second.id), undefined);

    database.prepare("UPDATE page_attrs SET value = ? WHERE page_id = ? AND attr_id = 'custom:text'").run("000123", first.id);
    assert.deepEqual(database.prepare("SELECT value, typeof(value) AS storage FROM page_attrs WHERE page_id = ? AND attr_id = 'custom:text'").get(first.id), { value: "000123", storage: "text" });
    database.prepare("INSERT INTO page_attrs VALUES (?, 'custom:number', 2026)").run(first.id);
    assert.deepEqual(database.prepare("SELECT value, typeof(value) AS storage FROM page_attrs WHERE attr_id = 'custom:number'").get(), { value: 2026, storage: "integer" });

    const metadata = JSON.stringify({ options: [{ id: "option-1", name: "Research" }] });
    database.prepare("UPDATE attrs SET metadata = ? WHERE id = 'label'").run(metadata);
    database.prepare("INSERT INTO page_attrs VALUES (?, 'label', ?)").run(first.id, JSON.stringify(["option-1"]));
    assert.deepEqual(database.prepare("SELECT metadata FROM attrs WHERE id = 'label'").get(), { metadata });
    assert.throws(() => database.prepare("INSERT INTO page_attrs (page_id, attr_id) VALUES (?, 'custom:text')").run(first.id), /UNIQUE/);
    database.prepare("DELETE FROM page_attrs WHERE page_id = ? AND attr_id = 'custom:text'").run(first.id);
    assert.ok(database.prepare("SELECT id FROM attrs WHERE id = 'custom:text'").get());
});

test("foreign keys, JSON shapes, and block-use positions reject invalid data atomically", t => {
    const { database } = fresh(t);
    const created = page(database);
    database.exec("INSERT INTO attrs (id, type) VALUES ('custom:test', 'string')");
    assert.throws(() => database.prepare("INSERT INTO page_attrs VALUES (?, 'unknown', NULL)").run(created.id), /FOREIGN KEY/);
    assert.throws(() => database.exec("INSERT INTO page_attrs VALUES ('unknown', 'custom:test', NULL)"), /FOREIGN KEY/);
    assert.throws(() => database.exec("INSERT INTO pages (id, kind, title_block_id) VALUES ('unknown-title', 'editable', 'unknown')"), /FOREIGN KEY/);
    assert.throws(() => database.prepare("DELETE FROM blocks WHERE id = ?").run(created.title), /FOREIGN KEY/);

    for (const invalid of ["not-json", "null", "{}", "[1]", "[null]", "[{}]"]) {
        const before = uses(database);
        const beforeMeta = meta(database);
        assert.throws(() => database.prepare("UPDATE pages SET children = ? WHERE id = ?").run(invalid, created.id));
        assert.throws(() => database.prepare("INSERT INTO blocks (id, type, children) VALUES (?, 'paragraph', ?)").run(randomUUID(), invalid));
        assert.deepEqual(uses(database), before);
        assert.deepEqual(meta(database), beforeMeta);
        assert.deepEqual(database.prepare("SELECT children FROM pages WHERE id = ?").get(created.id), { children: "[]" });
    }
    for (const invalid of ["not-json", "null", "[]"]) {
        assert.throws(() => database.prepare("UPDATE attrs SET metadata = ? WHERE id = 'custom:test'").run(invalid));
        assert.throws(() => database.prepare("UPDATE workspace_meta SET settings = ?").run(invalid));
    }
    for (const [kind, slot, position] of [["block", "title", 0], ["page", "title", 1], ["page", "children", -1], ["other", "children", 0]]) {
        assert.throws(() => database.prepare("INSERT INTO block_uses VALUES (?, 'container', ?, ?, 'target')").run(kind, slot, position));
    }
    assert.deepEqual(database.pragma("foreign_key_check"), []);
});

test("reverse lookup tracks shared and repeated blocks, titles, nesting, and reordering", t => {
    const { database } = fresh(t);
    const shared = block(database);
    const nested = block(database, "blockquote", [shared]);
    const first = page(database, [shared, nested, shared]);
    const second = page(database, [shared]);
    assert.equal(database.prepare("SELECT count(*) FROM block_uses WHERE block_id = ?").pluck().get(shared), 4);
    assert.deepEqual(database.prepare("SELECT slot, position FROM block_uses WHERE container_id = ? AND block_id = ? ORDER BY position").all(first.id, shared), [
        { slot: "children", position: 0 }, { slot: "children", position: 2 }
    ]);
    assert.deepEqual(database.prepare("SELECT container_kind, container_id, position FROM block_uses WHERE slot = 'title' AND block_id = ?").get(first.title), {
        container_kind: "page", container_id: first.id, position: 0
    });

    database.prepare("UPDATE pages SET children = ? WHERE id = ?").run(JSON.stringify([nested, shared]), first.id);
    assert.deepEqual(database.prepare("SELECT position FROM block_uses WHERE container_id = ? AND block_id = ?").get(first.id, shared), { position: 1 });
    database.prepare("UPDATE blocks SET children = '[]' WHERE id = ?").run(nested);
    database.prepare("DELETE FROM pages WHERE id = ?").run(second.id);
    assert.equal(database.prepare("SELECT count(*) FROM block_uses WHERE block_id = ?").pluck().get(shared), 1);
    assert.ok(database.prepare("SELECT id FROM blocks WHERE id = ?").get(shared));

    const nextTitle = block(database, "title");
    database.prepare("UPDATE pages SET title_block_id = ? WHERE id = ?").run(nextTitle, first.id);
    assert.equal(database.prepare("SELECT count(*) FROM block_uses WHERE block_id = ?").pluck().get(first.title), 0);
    assert.deepEqual(database.prepare("SELECT block_id FROM block_uses WHERE container_id = ? AND slot = 'title'").get(first.id), { block_id: nextTitle });

    // Removing a target retains the source reference so the UI can show it as missing.
    database.prepare("DELETE FROM blocks WHERE id = ?").run(shared);
    assert.equal(database.prepare("SELECT count(*) FROM block_uses WHERE block_id = ?").pluck().get(shared), 1);
    database.prepare("UPDATE blocks SET children = ? WHERE id = ?").run(JSON.stringify([shared]), nested);
    database.prepare("DELETE FROM blocks WHERE id = ?").run(nested);
    assert.equal(database.prepare("SELECT count(*) FROM block_uses WHERE container_kind = 'block' AND container_id = ?").pluck().get(nested), 0);
    assert.equal(database.prepare("SELECT count(*) FROM block_uses WHERE block_id = ?").pluck().get(nested), 1);
});

test("rollback restores source data, derived uses, and last_modified_at together", t => {
    const { database } = fresh(t);
    const shared = block(database);
    const created = page(database, [shared]);
    database.prepare("UPDATE workspace_meta SET last_modified_at = ?").run(oldTimestamp);
    const before = uses(database);
    const rollback = database.transaction(() => {
        database.prepare("UPDATE pages SET children = '[]' WHERE id = ?").run(created.id);
        database.prepare("UPDATE blocks SET content = 'changed' WHERE id = ?").run(shared);
        assert.notEqual(meta(database).last_modified_at, oldTimestamp);
        throw new Error("abort this edit");
    });
    assert.throws(rollback, /abort this edit/);
    assert.deepEqual(uses(database), before);
    assert.deepEqual(database.prepare("SELECT children FROM pages WHERE id = ?").get(created.id), { children: JSON.stringify([shared]) });
    assert.deepEqual(database.prepare("SELECT content FROM blocks WHERE id = ?").get(shared), { content: null });
    assert.equal(meta(database).last_modified_at, oldTimestamp);
});

test("the reverse index can be rebuilt without modifying business data or timestamps", t => {
    const { database } = fresh(t);
    const missing = randomUUID();
    const nested = block(database, "blockquote", [missing]);
    page(database, [nested, nested]);
    const before = uses(database);
    const beforeMeta = meta(database);
    database.exec("DELETE FROM block_uses; INSERT INTO block_uses VALUES ('page', 'stale-container', 'children', 0, 'stale-target');");
    rebuildBlockUses(database);
    assert.deepEqual(uses(database), before);
    assert.deepEqual(meta(database), beforeMeta);
});

test("business edits update last_modified_at while reads and unchanged updates do not", t => {
    const { database } = fresh(t);
    const createdAt = meta(database).created_at;
    const content = block(database);
    const created = page(database, [content]);
    database.exec("INSERT INTO attrs (id, type) VALUES ('custom:test', 'string')");
    database.prepare("INSERT INTO page_attrs VALUES (?, 'custom:test', NULL)").run(created.id);

    const edits = [
        (): void => {
            database.prepare("UPDATE blocks SET content = 'edited' WHERE id = ?").run(content);
        },
        (): void => {
            database.prepare("UPDATE pages SET kind = 'paper' WHERE id = ?").run(created.id);
        },
        (): void => {
            database.exec("UPDATE attrs SET metadata = '{\"name\":\"Updated\"}' WHERE id = 'custom:test'");
        },
        (): void => {
            database.prepare("UPDATE page_attrs SET value = 'filled' WHERE page_id = ? AND attr_id = 'custom:test'").run(created.id);
        },
        (): void => {
            database.exec("UPDATE workspace_meta SET name = 'Renamed'");
        },
        (): void => {
            database.exec("UPDATE workspace_meta SET settings = '{\"example\":true}'");
        },
        (): void => {
            database.prepare("DELETE FROM page_attrs WHERE page_id = ? AND attr_id = 'custom:test'").run(created.id);
        },
        (): void => {
            database.exec("DELETE FROM attrs WHERE id = 'custom:test'");
        },
        (): void => {
            database.prepare("DELETE FROM pages WHERE id = ?").run(created.id);
        },
        (): void => {
            database.prepare("DELETE FROM blocks WHERE id = ?").run(content);
        }
    ];
    for (const edit of edits) {
        database.prepare("UPDATE workspace_meta SET last_modified_at = ?").run(oldTimestamp);
        edit();
        const current = meta(database);
        assert.notEqual(current.last_modified_at, oldTimestamp);
        assert.equal(new Date(current.last_modified_at).toISOString(), current.last_modified_at);
        assert.equal(current.created_at, createdAt);
    }

    const remaining = page(database);
    database.exec("INSERT INTO attrs (id, type) VALUES ('custom:unchanged', 'number')");
    database.prepare("INSERT INTO page_attrs VALUES (?, 'custom:unchanged', NULL)").run(remaining.id);
    database.prepare("UPDATE workspace_meta SET last_modified_at = ?").run(oldTimestamp);
    database.exec("UPDATE pages SET children = children; UPDATE blocks SET content = content; UPDATE attrs SET metadata = metadata; UPDATE page_attrs SET value = value; UPDATE workspace_meta SET name = name, settings = settings;");
    database.prepare("SELECT * FROM pages").all();
    assert.equal(meta(database).last_modified_at, oldTimestamp);
});