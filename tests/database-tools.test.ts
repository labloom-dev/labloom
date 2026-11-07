import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { runMigrations } from "../main/storage/migrations/runner";
import { v1 } from "../main/storage/migrations/v1";
import { v2 } from "../main/storage/migrations/v2";
import { v3 } from "../main/storage/migrations/v3";
import { v4 } from "../main/storage/migrations/v4";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const localRoot = join(projectRoot, ".local");
const timestamp = "2001-02-03T04:05:06.789Z";
const journal = JSON.parse(readFileSync(join(projectRoot, "main/storage/migrations/generated/meta/_journal.json"), "utf8"));
const nextVersion: number = journal.entries.at(-1).version + 1;
const nextPrefix = String(nextVersion).padStart(4, "0");

function fixture(t: TestContext): string {
    mkdirSync(localRoot, { recursive: true });
    const root = mkdtempSync(join(localRoot, "database-tools-"));
    t.after(() => {
        const target = realpathSync(root);
        const path = relative(realpathSync(localRoot), target);
        if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) throw new Error("Unsafe fixture cleanup path.");
        rmSync(target, { recursive: true, force: true });
    });
    for (const path of ["scripts", "main/storage", "shared"]) cpSync(join(projectRoot, path), join(root, path), { recursive: true });
    writeFileSync(join(root, "package.json"), "{\"type\":\"module\"}");
    return root;
}

function cli(root: string, ...args: string[]): string {
    const result = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/database.mjs"), ...args], {
        cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
}

function rejected(root: string, ...args: string[]): string {
    const result = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/database.mjs"), ...args], {
        cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    return result.stderr;
}

function savedFiles(directory: string): Record<string, string> {
    return Object.fromEntries(readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile()).map(entry => {
            const path = join(entry.parentPath, entry.name);
            return [relative(directory, path), readFileSync(path, "utf8")];
        }));
}

function legacyWorkspace(root: string): string {
    const path = join(root, "workspace");
    mkdirSync(join(path, "attachments"), { recursive: true });
    const db = new Database(join(path, "workspace.sqlite"));
    try {
        db.pragma("application_id = 0x4c424c4d");
        db.pragma("foreign_keys = ON");
        runMigrations(db, [v1, v2, v3, v4]);
        db.prepare("INSERT INTO workspace_meta (id, name, created_at, last_modified_at) VALUES (?, 'Fixture', ?, ?)").run(randomUUID(), timestamp, timestamp);
        db.exec(`
            INSERT INTO blocks (id, type, content) VALUES ('title', 'title', 'Original');
            INSERT INTO pages (id, kind, title_block_id, children) VALUES ('page', 'editable', 'title', '["missing"]');
            INSERT INTO attrs (id, type) VALUES ('custom', 'string');
            INSERT INTO page_attrs VALUES ('page', 'custom', '000123');
            UPDATE page_attrs SET value = 1 WHERE attr_id = 'deleted';
            INSERT INTO feed_sources (id, name, url) VALUES ('source', 'Saved feed', 'https://example.org/feed');
            INSERT INTO feed_items (id, source_id, external_id, title, authors, summary, is_read)
                VALUES ('item', 'source', 'external', 'Saved article', 'Author', 'Summary', 1);
        `);
        db.prepare("UPDATE workspace_meta SET last_modified_at = ?").run(timestamp);
    }
    finally {
        db.close();
    }
    return path;
}

test("repository checking rejects target flags, validates history, and generation is a no-op without changes", t => {
    const root = fixture(t);
    const directory = join(root, "main/storage/migrations/generated");
    const before = savedFiles(directory);
    assert.match(cli(root, "check"), /No database was connected/);
    assert.match(cli(root, "generate"), /no files written/);
    assert.deepEqual(savedFiles(directory), before);
    for (const args of [["--remote", "missing.json"], ["--workspace", "missing"], ["--help", "--help"], ["unexpected"]]) rejected(root, "check", ...args);
    rejected(root, "migrate");
    rejected(root, "migrate", "--workspace", "a", "--workspace", "b");
    const path = join(directory, "meta/0005_snapshot.json");
    const snapshot = JSON.parse(readFileSync(path, "utf8"));
    snapshot.prevId = "broken";
    writeFileSync(path, JSON.stringify(snapshot));
    assert.match(rejected(root, "check"), /snapshot chain/);
});

test("generated table rebuilds preserve legacy rows, STRICT storage, triggers, and upgrade backups", t => {
    const root = fixture(t);
    const directory = join(root, "main/storage/migrations/generated");
    const before = savedFiles(directory);
    const source = join(root, "main/storage/tables.ts");
    const text = readFileSync(source, "utf8").replace("content: text(\"content\"),", "content: text(\"content\").default(\"\"),")
        .replace("name: text(\"name\").notNull(),\n    url:", "name: text(\"name\").notNull().default(\"Untitled\"),\n    url:");
    writeFileSync(source, text);
    const rulesPath = join(root, "main/storage/rules.sql");
    writeFileSync(rulesPath, readFileSync(rulesPath, "utf8") + "\n--> statement-breakpoint\nCREATE TRIGGER fixture_feed_name BEFORE INSERT ON feed_sources\nWHEN NEW.name = 'blocked' BEGIN SELECT RAISE(ABORT, 'fixture rule'); END;");
    assert.match(rejected(root, "check"), /definitions have changed/);
    cli(root, "generate", "--name", "defaults");
    cli(root, "check");
    const sql = readFileSync(join(directory, `${nextPrefix}_defaults.sql`), "utf8");
    assert.match(sql, /CREATE TABLE `__new_blocks`[\s\S]*?\) STRICT;/);
    assert.match(sql, /CREATE TABLE `__new_feed_sources`/);
    assert.doesNotMatch(sql, /PRAGMA foreign_keys/);
    for (const [path, content] of Object.entries(before)) {
        if (path === "index.ts" || path.endsWith("_journal.json")) continue;
        assert.equal(readFileSync(join(directory, path), "utf8"), content);
    }
    const after = savedFiles(directory);
    cli(root, "generate");
    assert.deepEqual(savedFiles(directory), after);
    const workspace = legacyWorkspace(root);
    assert.match(cli(root, "status", "--workspace", workspace), /Stored version: 4/);
    assert.equal(existsSync(join(workspace, "backups")), false);
    cli(root, "migrate", "--workspace", workspace);
    const database = new Database(join(workspace, "workspace.sqlite"));
    database.pragma("foreign_keys = ON");
    assert.equal(database.pragma("user_version", { simple: true }), nextVersion);
    assert.equal(database.prepare("SELECT is_read FROM feed_items WHERE id = 'item'").pluck().get(), 1);
    assert.equal(database.prepare("SELECT content FROM blocks WHERE id = 'title'").pluck().get(), "Original");
    assert.equal(database.prepare("SELECT value FROM page_attrs WHERE attr_id = 'custom'").pluck().get(), "000123");
    assert.equal(database.prepare("SELECT last_modified_at FROM workspace_meta").pluck().get(), timestamp);
    assert.equal(database.prepare("SELECT strict FROM pragma_table_list WHERE name = 'blocks'").pluck().get(), 1);
    assert.equal(database.prepare("SELECT count(*) FROM block_uses").pluck().get(), 2);
    assert.deepEqual(database.pragma("foreign_key_check"), []);
    assert.throws(() => database.exec("DELETE FROM attrs WHERE id = 'deleted'"), /cannot be deleted/);
    assert.throws(() => database.exec("INSERT INTO feed_sources (id, name, url) VALUES ('bad', 'blocked', 'new')"), /fixture rule/);
    database.exec("UPDATE pages SET children = '[]'");
    assert.equal(database.prepare("SELECT count(*) FROM block_uses").pluck().get(), 1);
    const backups = readdirSync(join(workspace, "backups"));
    assert.equal(backups.length, 1);
    const backup = new Database(join(workspace, "backups", backups[0]), { readonly: true });
    assert.equal(backup.pragma("user_version", { simple: true }), 4);
    assert.equal(backup.prepare("SELECT count(*) FROM feed_items").pluck().get(), 1);
    backup.close();
    cli(root, "migrate", "--workspace", workspace);
    assert.deepEqual(readdirSync(join(workspace, "backups")), backups);
    const fresh = join(root, "fresh");
    cli(root, "init", "--workspace", fresh);
    assert.match(cli(root, "status", "--workspace", fresh), new RegExp(`Stored version: ${nextVersion}`));
    rejected(root, "init", "--workspace", fresh);
    database.close();
});

test("failed rebuilds roll back data and versions and restore foreign key enforcement", () => {
    const database = new Database(":memory:");
    try {
        database.pragma("foreign_keys = ON");
        const first = { from: 0, to: 1, up(db: Database.Database) {
            db.exec("CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (id TEXT REFERENCES parent(id) ON DELETE CASCADE); INSERT INTO parent VALUES ('saved'); INSERT INTO child VALUES ('saved');");
        } };
        runMigrations(database, [first]);
        const broken = { from: 1, to: 2, foreignKeysOff: true, up(db: Database.Database) {
            db.exec("DROP TABLE parent; CREATE TABLE parent (id TEXT PRIMARY KEY);");
        } };
        assert.throws(() => runMigrations(database, [first, broken]), /foreign key check/);
        assert.equal(database.pragma("user_version", { simple: true }), 1);
        assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
        assert.equal(database.prepare("SELECT id FROM parent").pluck().get(), "saved");
        assert.equal(database.prepare("SELECT id FROM child").pluck().get(), "saved");
        assert.throws(() => database.transaction(() => runMigrations(database, [first, broken]))(), /outside a transaction/);
    }
    finally {
        database.close();
    }
});

test("custom SQL must be filled in and synchronized before migration", async t => {
    const root = fixture(t);
    cli(root, "generate", "--custom", "--name", "seed_attribute");
    assert.match(rejected(root, "check"), /placeholder/);
    // The application's direct migration path must also refuse an unfinished
    // custom migration; it does not run the repository CLI check on startup.
    const { generatedMigrations } = await import(pathToFileURL(join(root, "main/storage/migrations/generated/index.ts")).href);
    const pending = new Database(":memory:");
    try {
        assert.throws(() => runMigrations(pending, [v1, v2, v3, v4, ...generatedMigrations]), /custom migration is incomplete/);
        assert.equal(pending.pragma("user_version", { simple: true }), 0);
        assert.deepEqual(pending.prepare("SELECT name FROM sqlite_master").all(), []);
    }
    finally {
        pending.close();
    }
    const path = join(root, `main/storage/migrations/generated/${nextPrefix}_seed_attribute.sql`);
    const sql = readFileSync(path, "utf8").replace("-- Add the data migration or table rebuild here before applying.", "INSERT INTO attrs (id, type) VALUES ('fixture:seeded', 'string');");
    writeFileSync(path, sql);
    assert.match(rejected(root, "check"), /Embedded migrations differ/);
    assert.match(cli(root, "generate"), /refreshed embedded migrations/);
    cli(root, "check");
    const workspace = join(root, "custom");
    cli(root, "init", "--workspace", workspace);
    const database = new Database(join(workspace, "workspace.sqlite"), { readonly: true });
    try {
        assert.equal(database.prepare("SELECT type FROM attrs WHERE id = 'fixture:seeded'").pluck().get(), "string");
    }
    finally {
        database.close();
    }
    writeFileSync(path, `COMMIT;\n--> statement-breakpoint\n${sql}`);
    assert.match(rejected(root, "check"), /transaction boundaries/);
});