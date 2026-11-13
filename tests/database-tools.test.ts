import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { createBaseline } from "../main/storage/migrations/runner";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const localRoot = join(projectRoot, ".local");

function fixture(t: TestContext): string {
    mkdirSync(localRoot, { recursive: true });
    const root = mkdtempSync(join(localRoot, "database-tools-"));
    t.after(() => {
        const target = realpathSync(root);
        const path = relative(realpathSync(localRoot), target);
        if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) throw new Error("Unsafe fixture cleanup path.");
        rmSync(target, { recursive: true, force: true });
    });
    for (const path of ["scripts", "main/storage", "shared", "locales"]) cpSync(join(projectRoot, path), join(root, path), { recursive: true });
    writeFileSync(join(root, "package.json"), "{\"type\":\"module\"}");
    return root;
}

function cli(root: string, args: string[], status = 0): string {
    const result = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/database.mjs"), ...args], {
        cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, status, result.stdout + result.stderr);
    return result.stdout + result.stderr;
}

function savedFiles(directory: string): Record<string, Buffer> {
    return Object.fromEntries(readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile()).map(entry => {
            const path = join(entry.parentPath, entry.name);
            return [relative(directory, path), readFileSync(path)];
        }));
}

test("repository checking accepts one baseline, rejects migration flags, and generation is stable", t => {
    const root = fixture(t), directory = join(root, "main/storage/migrations/generated");
    const before = savedFiles(directory);
    assert.deepEqual(Object.keys(before).sort(), ["baseline.sql", "index.ts"]);
    assert.match(cli(root, ["check"]), /No database was connected/);
    assert.match(cli(root, ["generate"]), /no files written/);
    assert.deepEqual(savedFiles(directory), before);
    for (const args of [
        ["check", "--remote", "missing.json"], ["check", "--workspace", "missing"], ["check", "--help", "--help"],
        ["check", "unexpected"], ["generate", "--name", "next"], ["generate", "--custom"], ["migrate"],
        ["init"], ["status"], ["init", "--workspace", "a", "--workspace", "b"]
    ]) cli(root, args, 1);
    writeFileSync(join(directory, "0002_unexpected.sql"), "SELECT 1;");
    assert.match(cli(root, ["check"], 1), /only baseline.sql and index.ts/);
});

test("generation replaces the baseline after definition changes and old workspaces are rejected untouched", async t => {
    const root = fixture(t), directory = join(root, "main/storage/migrations/generated"), old = join(root, "old");
    cli(root, ["init", "--workspace", old]);
    writeFileSync(join(old, "attachments", "keep.txt"), "Keep this attachment");
    const before = savedFiles(old);
    const source = join(root, "main/storage/tables.ts");
    const original = readFileSync(source, "utf8");
    const changed = original.replace("content: text(\"content\"),", "content: text(\"content\").default(\"\"),");
    assert.notEqual(changed, original);
    writeFileSync(source, changed);
    assert.match(cli(root, ["check"], 1), /definitions and baseline SQL differ/);
    cli(root, ["generate"]);
    cli(root, ["check"]);
    const rules = join(root, "main/storage/rules.sql");
    writeFileSync(rules, readFileSync(rules, "utf8") + "\n--> statement-breakpoint\nCREATE TRIGGER fixture_feed_name BEFORE INSERT ON workspace_meta\nWHEN NEW.name = 'blocked' BEGIN SELECT RAISE(ABORT, 'fixture rule'); END;");
    assert.match(cli(root, ["check"], 1), /definitions and baseline SQL differ/);
    cli(root, ["generate"]);
    cli(root, ["check"]);
    assert.deepEqual(readdirSync(directory).sort(), ["baseline.sql", "index.ts"]);
    const sql = readFileSync(join(directory, "baseline.sql"), "utf8");
    assert.match(sql, /CREATE TABLE `blocks`[\s\S]*?`content` text DEFAULT ''[\s\S]*?\) STRICT;/);
    assert.doesNotMatch(sql, /\b(?:DROP|ALTER) TABLE|__new_|PRAGMA foreign_keys/);
    const generated = savedFiles(directory);
    assert.match(cli(root, ["generate"]), /no files written/);
    assert.deepEqual(savedFiles(directory), generated);
    const { openWorkspace } = await import(pathToFileURL(join(root, "main/storage/workspace.ts")).href);
    assert.throws(() => openWorkspace(old), { message: "workspace-incompatible" });
    assert.deepEqual(savedFiles(old), before);
    assert.equal(existsSync(join(old, "backups")), false);
    const fresh = join(root, "fresh");
    cli(root, ["init", "--workspace", fresh]);
    const workspace = openWorkspace(fresh);
    try {
        assert.equal(workspace.database.prepare("SELECT strict FROM pragma_table_list WHERE name='blocks'").pluck().get(), 1);
        assert.throws(() => workspace.database.exec("INSERT INTO workspace_meta(id,name,created_at,last_modified_at) VALUES ('bad','blocked',0,0)"), /fixture rule/);
        assert.deepEqual(workspace.database.pragma("foreign_key_check"), []);
    }
    finally {
        workspace.database.close();
    }
    assert.match(cli(root, ["status", "--workspace", fresh]), /Stored version: 1/);
    cli(root, ["init", "--workspace", fresh], 1);
});

test("checking detects SQL, runtime, and STRICT option drift independently", t => {
    const root = fixture(t), directory = join(root, "main/storage/migrations/generated");
    for (const [name, error] of [["baseline.sql", /definitions and baseline SQL differ/], ["index.ts", /Embedded baseline differs/]] as const) {
        const path = join(directory, name);
        writeFileSync(path, readFileSync(path, "utf8") + "\n-- drift");
        assert.match(cli(root, ["check"], 1), error);
        cli(root, ["generate"]);
        cli(root, ["check"]);
    }
    const options = join(root, "main/storage/table-options.json");
    writeFileSync(options, "{\"strictTables\":[]}");
    assert.match(cli(root, ["check"], 1), /definitions and baseline SQL differ/);
    cli(root, ["generate"]);
    cli(root, ["check"]);
    assert.doesNotMatch(readFileSync(join(directory, "baseline.sql"), "utf8"), /\) STRICT;/);
    writeFileSync(options, "{\"strictTables\":[\"missing\"]}");
    assert.match(cli(root, ["generate"], 1), /must list existing tables/);
});

test("baseline initialization requires an empty database and preserves an existing database", () => {
    const database = new Database(":memory:");
    try {
        database.pragma("foreign_keys = ON");
        createBaseline(database);
        const before = database.serialize();
        assert.throws(() => createBaseline(database), /requires an empty database/);
        assert.deepEqual(database.serialize(), before);
        assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
        assert.deepEqual(database.pragma("foreign_key_check"), []);
    }
    finally {
        database.close();
    }
});