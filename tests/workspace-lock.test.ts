import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { createWorkspace, openWorkspace, closeWorkspace, type OpenWorkspace } from "../main/storage/workspace";
import * as locks from "../main/storage/workspace-lock";
import * as session from "../main/session";
import { hasFailure } from "./failures";

function directory(): string {
    return mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "workspace-lock-"));
}
function fresh(t: TestContext): OpenWorkspace {
    const workspace = createWorkspace(directory());
    t.after(() => closeWorkspace(workspace));
    return workspace;
}
function lockFiles(root: string): string[] {
    return readdirSync(root).filter(file => file.startsWith("workspace.lock")).sort();
}

test("workspace exclusion uses only a separate lock connection and keeps the main database normal", t => {
    const workspace = fresh(t), path = workspace.info.path;
    assert.equal(workspace.database.pragma("locking_mode", { simple: true }), "normal");
    assert.equal(workspace.database.pragma("journal_mode", { simple: true }), "delete");
    assert.equal(workspace.lock.connection.pragma("locking_mode", { simple: true }), "exclusive");
    assert.equal(workspace.lock.connection.pragma("journal_mode", { simple: true }), "memory");
    assert.deepEqual(lockFiles(path), ["workspace.lock"]);
    const reader = new Database(join(path, "workspace.sqlite"), { readonly: true, timeout: 0 });
    try {
        assert.equal(reader.prepare("SELECT id FROM workspace_meta").pluck().get(), workspace.info.id);
    }
    finally {
        reader.close();
    }
    assert.throws(() => openWorkspace(path), hasFailure("workspace-in-use"));
    assert.equal(workspace.database.open, true);
    closeWorkspace(workspace);
    assert.deepEqual(lockFiles(path), ["workspace.lock"]);
    const mainPath = join(path, "workspace.sqlite"), mainBytes = readFileSync(mainPath), modified = statSync(mainPath).mtimeMs;
    const reopened = openWorkspace(path);
    closeWorkspace(reopened);
    assert.deepEqual(readFileSync(mainPath), mainBytes);
    assert.equal(statSync(mainPath).mtimeMs, modified);
    assert.deepEqual(lockFiles(path), ["workspace.lock"]);
});

test("the file remains after closing and is reused without inspecting its schema or version", t => {
    const workspace = fresh(t), root = workspace.info.path, path = join(root, "workspace.lock");
    closeWorkspace(workspace);
    const previous = new Database(path);
    previous.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('preserved')");
    previous.pragma("user_version = 999");
    previous.close();
    const identity = statSync(path).ino;
    const reopened = openWorkspace(root);
    closeWorkspace(reopened);
    assert.equal(statSync(path).ino, identity);
    const inspect = new Database(path, { readonly: true });
    try {
        assert.equal(inspect.prepare("SELECT value FROM unrelated").pluck().get(), "preserved");
    }
    finally {
        inspect.close();
    }
    assert.deepEqual(lockFiles(root), ["workspace.lock"]);
});

test("workspace file existence is checked before acquiring a lock", () => {
    const empty = directory();
    assert.throws(() => openWorkspace(empty), hasFailure("workspace-not-workspace"));
    assert.deepEqual(readdirSync(empty), []);
    const lock = locks.acquire(empty);
    try {
        assert.throws(() => openWorkspace(empty), hasFailure("workspace-not-workspace"));
    }
    finally {
        locks.release(lock);
    }
});

test("failed validation removes only a lock file created by that opening attempt", () => {
    const root = directory(), path = join(root, "workspace.sqlite"), bytes = Buffer.from("not a workspace");
    writeFileSync(path, bytes);
    assert.throws(() => openWorkspace(root));
    assert.deepEqual(readdirSync(root), ["workspace.sqlite"]);
    assert.deepEqual(readFileSync(path), bytes);
    const existing = locks.acquire(root);
    locks.release(existing);
    assert.throws(() => openWorkspace(root));
    assert.deepEqual(lockFiles(root), ["workspace.lock"]);
    assert.deepEqual(readFileSync(path), bytes);
});

test("workspace lock is acquired before read-only schema validation", () => {
    const root = directory();
    writeFileSync(join(root, "workspace.sqlite"), "not a workspace");
    const held = locks.acquire(root);
    try {
        assert.throws(() => openWorkspace(root), hasFailure("workspace-in-use"));
    }
    finally {
        locks.release(held);
    }
    assert.throws(() => openWorkspace(root), error => !hasFailure("workspace-in-use")(error));
});

test("creation checks emptiness before creating a lock or database", () => {
    const root = directory();
    writeFileSync(join(root, "keep.txt"), "keep");
    assert.throws(() => createWorkspace(root), hasFailure("workspace-folder-not-empty"));
    assert.deepEqual(readdirSync(root), ["keep.txt"]);
});

test("session initialization failure releases and removes a newly created lock", t => {
    const workspace = fresh(t), root = workspace.info.path, path = join(root, "workspace.lock");
    closeWorkspace(workspace);
    unlinkSync(path);
    const options = Object.defineProperty({}, "timeZone", { enumerable: true, get() {
        throw new Error("injected startup failure");
    } });
    assert.throws(() => session.open(root, "open", options), /injected startup failure/);
    assert.equal(session.ready(), false);
    assert.equal(existsSync(path), false);
    const retry = session.open(root, "open");
    session.close();
    assert.equal(retry.database.open, false);
    assert.equal(retry.lock.connection.open, false);
    assert.deepEqual(lockFiles(root), ["workspace.lock"]);
});

test("an acquisition race preserves a newly created file held by the winning connection", t => {
    const root = directory(), path = join(root, "workspace.lock"), pragma = Database.prototype.pragma;
    let peer: Database.Database | undefined;
    const intercepted = t.mock.method(Database.prototype, "pragma", function (this: Database.Database, ...args: Parameters<Database.Database["pragma"]>): unknown {
        if (this.name === path && !peer) {
            peer = new Database(path, { timeout: 0 });
            pragma.call(peer, "journal_mode = MEMORY");
            pragma.call(peer, "locking_mode = EXCLUSIVE");
            pragma.call(peer, "user_version = 1");
        }
        return pragma.apply(this, args);
    });
    try {
        assert.throws(() => locks.acquire(root), hasFailure("workspace-in-use"));
        assert.equal(existsSync(path), true);
        assert.equal(peer?.open, true);
        assert.throws(() => locks.acquire(root), hasFailure("workspace-in-use"));
    }
    finally {
        intercepted.mock.restore();
        peer?.close();
    }
    const retry = locks.acquire(root);
    locks.release(retry);
    assert.deepEqual(lockFiles(root), ["workspace.lock"]);
});

for (const [code, preserved] of [["SQLITE_LOCKED", true], ["SQLITE_IOERR", false]] as const) {
    test("new lock file cleanup after acquisition failure: " + code, t => {
        const root = directory(), path = join(root, "workspace.lock"), pragma = Database.prototype.pragma;
        const failure = Object.assign(new Error("injected lock failure"), { code });
        const intercepted = t.mock.method(Database.prototype, "pragma", function (this: Database.Database, ...args: Parameters<Database.Database["pragma"]>): unknown {
            if (this.name === path) throw failure;
            return pragma.apply(this, args);
        });
        try {
            assert.throws(() => locks.acquire(root), preserved ? hasFailure("workspace-in-use") : error => error === failure);
            assert.equal(existsSync(path), preserved);
        }
        finally {
            intercepted.mock.restore();
        }
        const retry = locks.acquire(root);
        locks.release(retry);
    });
}