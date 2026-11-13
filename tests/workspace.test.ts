import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { rebuildSyncRefs, workspaceFormatVersion } from "../main/storage/schema";
import { createWorkspace, openWorkspace, type OpenWorkspace } from "../main/storage/workspace";
import { AttributeService } from "../main/knowledge/attributes";
import { createWorkspaceDatabase } from "../main/storage/database";
import { AppStorage } from "../main/storage/app";
import { Startup } from "../main/startup/startup";

const testRoot = process.env.LABLOOM_TEST_ROOT;
if (!testRoot) throw new Error("Run these tests with node tests/run-workspace.mjs.");

const applicationId = 0x4c424c4d;
const oldTimestamp = "2001-02-03T04:05:06.789Z";
const oldMs = Date.parse(oldTimestamp);

type WorkspaceMeta = {
    id: string;
    name: string;
    created_at: number;
    last_modified_at: number;
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
    new AttributeService(createWorkspaceDatabase(database)).initializePage(id);
    return { id, title };
}

function uses(database: Database.Database): unknown[] {
    return database.prepare("SELECT * FROM sync_refs ORDER BY container_kind, container_id, slot, position").all();
}

test("new workspaces contain the core and feed tables and reopen without changing timestamps", t => {
    const workspace = fresh(t);
    const { database, info } = workspace;
    assert.equal(database.pragma("application_id", { simple: true }), applicationId);
    assert.equal(database.pragma("user_version", { simple: true }), workspaceFormatVersion);
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
    assert.deepEqual(database.prepare("SELECT name, strict FROM pragma_table_list WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(), [
        { name: "attachments", strict: 0 },
        { name: "attrs_meta", strict: 1 },
        { name: "blocks", strict: 1 },
        { name: "feed_items", strict: 0 },
        { name: "link_refs", strict: 0 },
        { name: "page_attrs", strict: 1 },
        { name: "pages", strict: 1 },
        { name: "sync_refs", strict: 1 },
        { name: "timers", strict: 0 },
        { name: "workspace_meta", strict: 1 }
    ]);
    const before = meta(database);
    assert.equal(before.id, info.id);
    assert.equal(before.name, info.name);
    assert.equal(before.created_at, before.last_modified_at);
    assert.ok(Number.isSafeInteger(before.created_at));
    assert.equal(before.settings, "{}");
    assert.ok(existsSync(join(info.path, "attachments")));
    database.close();
    const reopened = track(t, openWorkspace(info.path, info.id));
    assert.deepEqual(meta(reopened.database), before);
    assert.equal(reopened.database.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(existsSync(join(info.path, "backups")), false);
});

const incompatible = { kind: "workspace-incompatible" };

function files(root: string): Record<string, Buffer> {
    return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
        .map(entry => [join(entry.parentPath, entry.name), readFileSync(join(entry.parentPath, entry.name))]));
}

test("schema drift is rejected read-only even when the format marker is current", t => {
    for (const sql of [
        "ALTER TABLE blocks ADD COLUMN obsolete TEXT",
        "DROP INDEX page_attrs_by_value",
        "DROP TRIGGER pages_uses_insert",
        "ALTER TABLE feed_items DROP COLUMN pdf_url",
        "CREATE TABLE page_details (page_id TEXT)",
        "CREATE TRIGGER unexpected AFTER INSERT ON blocks BEGIN SELECT 1; END"
    ]) {
        const { database, info } = fresh(t);
        writeFileSync(join(info.path, "attachments", "preserved.txt"), "Keep this attachment");
        database.exec(sql);
        database.close();
        const before = files(info.path), metadata = statSync(join(info.path, "workspace.sqlite"));
        assert.throws(() => openWorkspace(info.path), hasFailure("workspace-incompatible"));
        assert.deepEqual(files(info.path), before);
        assert.equal(statSync(join(info.path, "workspace.sqlite")).mtimeMs, metadata.mtimeMs);
        assert.equal(existsSync(join(info.path, "backups")), false);
    }
});

test("identity, application, format, and attachments are validated without changing files", t => {
    const mismatched = fresh(t);
    mismatched.database.close();
    assert.throws(() => openWorkspace(mismatched.info.path, randomUUID()), hasFailure("workspace-changed"));
    for (const version of [0, 17, workspaceFormatVersion + 1]) {
        const { database, info } = fresh(t);
        database.pragma(`user_version = ${version}`);
        database.close();
        const before = files(info.path);
        assert.throws(() => openWorkspace(info.path), hasFailure("workspace-incompatible"));
        assert.deepEqual(files(info.path), before);
    }
    const foreign = fresh(t);
    foreign.database.pragma("application_id = 1");
    foreign.database.close();
    assert.throws(() => openWorkspace(foreign.info.path), hasFailure("workspace-not-workspace"));
    const missing = fresh(t);
    missing.database.close();
    rmdirSync(join(missing.info.path, "attachments"));
    const before = files(missing.info.path);
    assert.throws(() => openWorkspace(missing.info.path), hasFailure("workspace-attachments-unavailable"));
    assert.deepEqual(files(missing.info.path), before);
});

test("startup shows the incompatible workspace message on restore and manual open", t => {
    const { database, info } = fresh(t);
    database.exec("ALTER TABLE blocks ADD COLUMN obsolete TEXT");
    database.close();
    const storage = new AppStorage(directory());
    storage.load();
    storage.remember(info);
    const startup = new Startup(storage);
    t.after(() => startup.close());
    const before = files(info.path);
    for (const state of [startup.restore(), startup.choose(info.path, "open")]) {
        assert.equal(state.status, "needs-workspace");
        if (state.status === "needs-workspace") {
            assert.deepEqual(state.error, incompatible);
            assert.equal(state.canChoose, true);
        }
    }
    assert.deepEqual(files(info.path), before);
    assert.equal(startup.choose(directory(), "create").status, "ready");
});

test("attribute ownership is distinct from an empty value and ANY retains scalar types", t => {
    const { database } = fresh(t);
    const first = page(database);
    const second = page(database);
    database.exec("INSERT INTO attrs_meta (id, type) VALUES ('custom:text', 'string'), ('custom:number', 'number'), ('label', 'multi_select')");
    database.prepare("INSERT INTO page_attrs VALUES (?, 'custom:text', '')").run(first.id);
    assert.deepEqual(database.prepare("SELECT value FROM page_attrs WHERE page_id = ? AND attr_id = 'custom:text'").get(first.id), { value: "" });
    assert.equal(database.prepare("SELECT value FROM page_attrs WHERE page_id = ? AND attr_id = 'custom:text'").get(second.id), undefined);

    database.prepare("UPDATE page_attrs SET value = ? WHERE page_id = ? AND attr_id = 'custom:text'").run("000123", first.id);
    assert.deepEqual(database.prepare("SELECT value, typeof(value) AS storage FROM page_attrs WHERE page_id = ? AND attr_id = 'custom:text'").get(first.id), { value: "000123", storage: "text" });
    database.prepare("INSERT INTO page_attrs VALUES (?, 'custom:number', 2026)").run(first.id);
    assert.deepEqual(database.prepare("SELECT value, typeof(value) AS storage FROM page_attrs WHERE attr_id = 'custom:number'").get(), { value: 2026, storage: "integer" });

    const metadata = JSON.stringify({ options: [{ id: "option-1", name: "Research" }] });
    database.prepare("UPDATE attrs_meta SET metadata = ? WHERE id = 'label'").run(metadata);
    database.prepare("INSERT INTO page_attrs VALUES (?, 'label', ?)").run(first.id, JSON.stringify(["option-1"]));
    assert.deepEqual(database.prepare("SELECT metadata FROM attrs_meta WHERE id = 'label'").get(), { metadata });
    assert.throws(() => database.prepare("INSERT INTO page_attrs VALUES (?, 'custom:text', '')").run(first.id), /UNIQUE/);
    database.prepare("DELETE FROM page_attrs WHERE page_id = ? AND attr_id = 'custom:text'").run(first.id);
    assert.ok(database.prepare("SELECT id FROM attrs_meta WHERE id = 'custom:text'").get());
});

test("foreign keys, JSON shapes, and block-use positions reject invalid data atomically", t => {
    const { database } = fresh(t);
    const created = page(database);
    database.exec("INSERT INTO attrs_meta (id, type) VALUES ('custom:test', 'string')");
    assert.throws(() => database.prepare("INSERT INTO page_attrs VALUES (?, 'unknown', NULL)").run(created.id), /FOREIGN KEY/);
    assert.throws(() => database.exec("INSERT INTO page_attrs VALUES ('unknown', 'custom:test', '')"), /FOREIGN KEY/);
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
        assert.throws(() => database.prepare("UPDATE attrs_meta SET metadata = ? WHERE id = 'custom:test'").run(invalid));
        assert.throws(() => database.prepare("UPDATE workspace_meta SET settings = ?").run(invalid));
    }
    for (const [kind, slot, position] of [["block", "title", 0], ["page", "title", 1], ["page", "children", -1], ["other", "children", 0]]) {
        assert.throws(() => database.prepare("INSERT INTO sync_refs VALUES (?, 'container', ?, ?, 'target')").run(kind, slot, position));
    }
    assert.deepEqual(database.pragma("foreign_key_check"), []);
});

test("reverse lookup tracks shared and repeated blocks, titles, nesting, and reordering", t => {
    const { database } = fresh(t);
    const shared = block(database);
    const nested = block(database, "blockquote", [shared]);
    const first = page(database, [shared, nested, shared]);
    const second = page(database, [shared]);
    assert.equal(database.prepare("SELECT count(*) FROM sync_refs WHERE block_id = ?").pluck().get(shared), 4);
    assert.deepEqual(database.prepare("SELECT slot, position FROM sync_refs WHERE container_id = ? AND block_id = ? ORDER BY position").all(first.id, shared), [
        { slot: "children", position: 0 }, { slot: "children", position: 2 }
    ]);
    assert.deepEqual(database.prepare("SELECT container_kind, container_id, position FROM sync_refs WHERE slot = 'title' AND block_id = ?").get(first.title), {
        container_kind: "page", container_id: first.id, position: 0
    });

    database.prepare("UPDATE pages SET children = ? WHERE id = ?").run(JSON.stringify([nested, shared]), first.id);
    assert.deepEqual(database.prepare("SELECT position FROM sync_refs WHERE container_id = ? AND block_id = ?").get(first.id, shared), { position: 1 });
    database.prepare("UPDATE blocks SET children = '[]' WHERE id = ?").run(nested);
    database.prepare("DELETE FROM pages WHERE id = ?").run(second.id);
    assert.equal(database.prepare("SELECT count(*) FROM sync_refs WHERE block_id = ?").pluck().get(shared), 1);
    assert.ok(database.prepare("SELECT id FROM blocks WHERE id = ?").get(shared));

    const nextTitle = block(database, "title");
    database.prepare("UPDATE pages SET title_block_id = ? WHERE id = ?").run(nextTitle, first.id);
    assert.equal(database.prepare("SELECT count(*) FROM sync_refs WHERE block_id = ?").pluck().get(first.title), 0);
    assert.deepEqual(database.prepare("SELECT block_id FROM sync_refs WHERE container_id = ? AND slot = 'title'").get(first.id), { block_id: nextTitle });

    // Removing a target retains the source reference so the UI can show it as missing.
    database.prepare("DELETE FROM blocks WHERE id = ?").run(shared);
    assert.equal(database.prepare("SELECT count(*) FROM sync_refs WHERE block_id = ?").pluck().get(shared), 1);
    database.prepare("UPDATE blocks SET children = ? WHERE id = ?").run(JSON.stringify([shared]), nested);
    database.prepare("DELETE FROM blocks WHERE id = ?").run(nested);
    assert.equal(database.prepare("SELECT count(*) FROM sync_refs WHERE container_kind = 'block' AND container_id = ?").pluck().get(nested), 0);
    assert.equal(database.prepare("SELECT count(*) FROM sync_refs WHERE block_id = ?").pluck().get(nested), 1);
});

test("rollback restores source data, derived uses, and last_modified_at together", t => {
    const { database } = fresh(t);
    const shared = block(database);
    const created = page(database, [shared]);
    database.prepare("UPDATE workspace_meta SET last_modified_at = ?").run(oldMs);
    const before = uses(database);
    const rollback = database.transaction(() => {
        database.prepare("UPDATE pages SET children = '[]' WHERE id = ?").run(created.id);
        database.prepare("UPDATE blocks SET content = 'changed' WHERE id = ?").run(shared);
        assert.notEqual(meta(database).last_modified_at, oldMs);
        throw new Error("abort this edit");
    });
    assert.throws(rollback, /abort this edit/);
    assert.deepEqual(uses(database), before);
    assert.deepEqual(database.prepare("SELECT children FROM pages WHERE id = ?").get(created.id), { children: JSON.stringify([shared]) });
    assert.deepEqual(database.prepare("SELECT content FROM blocks WHERE id = ?").get(shared), { content: null });
    assert.equal(meta(database).last_modified_at, oldMs);
});

test("the reverse index can be rebuilt without modifying business data or timestamps", t => {
    const { database } = fresh(t);
    const missing = randomUUID();
    const nested = block(database, "blockquote", [missing]);
    page(database, [nested, nested]);
    const before = uses(database);
    const beforeMeta = meta(database);
    database.exec("DELETE FROM sync_refs; INSERT INTO sync_refs VALUES ('page', 'stale-container', 'children', 0, 'stale-target');");
    rebuildSyncRefs(database);
    assert.deepEqual(uses(database), before);
    assert.deepEqual(meta(database), beforeMeta);
});

test("business edits update last_modified_at while reads and unchanged updates do not", t => {
    const { database } = fresh(t);
    const createdAt = meta(database).created_at;
    const content = block(database);
    const created = page(database, [content]);
    database.exec("INSERT INTO attrs_meta (id, type) VALUES ('custom:test', 'string')");
    database.prepare("INSERT INTO page_attrs VALUES (?, 'custom:test', '')").run(created.id);

    const edits = [
        (): void => {
            database.prepare("UPDATE blocks SET content = 'edited' WHERE id = ?").run(content);
        },
        (): void => {
            database.prepare("UPDATE pages SET kind = 'paper' WHERE id = ?").run(created.id);
        },
        (): void => {
            database.exec("UPDATE attrs_meta SET name = 'Updated' WHERE id = 'custom:test'");
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
            database.exec("DELETE FROM attrs_meta WHERE id = 'custom:test'");
        },
        (): void => {
            database.prepare("DELETE FROM pages WHERE id = ?").run(created.id);
        },
        (): void => {
            database.prepare("DELETE FROM blocks WHERE id = ?").run(content);
        }
    ];
    for (const edit of edits) {
        database.prepare("UPDATE workspace_meta SET last_modified_at = ?").run(oldMs);
        edit();
        const current = meta(database);
        assert.notEqual(current.last_modified_at, oldMs);
        assert.ok(Number.isSafeInteger(current.last_modified_at));
        assert.equal(current.created_at, createdAt);
    }

    const remaining = page(database);
    database.exec("INSERT INTO attrs_meta (id, type) VALUES ('custom:unchanged', 'number')");
    database.prepare("INSERT INTO page_attrs VALUES (?, 'custom:unchanged', NULL)").run(remaining.id);
    database.prepare("UPDATE workspace_meta SET last_modified_at = ?").run(oldMs);
    database.exec("UPDATE pages SET children = children; UPDATE blocks SET content = content; UPDATE attrs_meta SET metadata = metadata; UPDATE page_attrs SET value = value; UPDATE workspace_meta SET name = name, settings = settings;");
    database.prepare("SELECT * FROM pages").all();
    assert.equal(meta(database).last_modified_at, oldMs);
});