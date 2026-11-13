import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { AppStorage } from "../main/storage/app";
import { defaultAppearance } from "../shared/types/appearance";

function fixture(t: TestContext): AppStorage {
    const base = resolve(".local");
    mkdirSync(base, { recursive: true });
    const root = mkdtempSync(join(base, "appearance-tests-"));
    t.after(() => {
        const path = relative(base, resolve(root));
        if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) throw new Error("Unsafe fixture cleanup path.");
        rmSync(root, { recursive: true, force: true });
    });
    return new AppStorage(root);
}

test("appearance persists across app restarts and workspace choices without losing unrelated config", t => {
    const storage = fixture(t);
    const first = { id: "one", name: "One", path: join(storage.root, "one") };
    const second = { id: "two", name: "Two", path: join(storage.root, "two") };
    writeFileSync(storage.configPath, JSON.stringify({ version: 1, lastWorkspace: first, custom: { preserved: true } }));
    storage.load();
    assert.deepEqual(storage.getAppearance(), defaultAppearance);
    const appearance = { theme: "system", readingSize: 18, motion: false, timeZone: "Asia/Shanghai", language: "en" } as const;
    storage.saveAppearance({ ...appearance, lastWorkspace: null, injected: true });
    storage.remember(second);
    const reopened = new AppStorage(storage.root);
    assert.deepEqual(reopened.load().lastWorkspace, second);
    assert.deepEqual(reopened.getAppearance(), appearance);
    const config = JSON.parse(readFileSync(storage.configPath, "utf8"));
    assert.deepEqual(config.custom, { preserved: true });
    assert.deepEqual(config.appearance, appearance);
    const returned = reopened.getAppearance();
    returned.theme = "light";
    assert.equal(reopened.getAppearance().theme, "system");
});

test("invalid settings cannot overwrite config, and malformed stored appearance uses defaults", t => {
    const storage = fixture(t);
    const contents = JSON.stringify({ version: 1, lastWorkspace: null, appearance: { theme: "invalid" } });
    writeFileSync(storage.configPath, contents);
    storage.load();
    assert.deepEqual(storage.getAppearance(), defaultAppearance);
    for (const value of [null, [], {}, { ...defaultAppearance, theme: "bad" }, { ...defaultAppearance, readingSize: "18" }, { ...defaultAppearance, motion: 1 },
        ...["", null, "+08:00", "Mars/Base"].map(timeZone => ({ ...defaultAppearance, timeZone })), { ...defaultAppearance, language: "fr" }]) {
        assert.throws(() => storage.saveAppearance(value), hasFailure("preferences-invalid"));
    }
    assert.equal(readFileSync(storage.configPath, "utf8"), contents);
});

test("failed atomic saves retain in-memory preferences and can be retried", t => {
    const storage = fixture(t);
    storage.load();
    storage.saveAppearance(defaultAppearance);
    const backup = join(storage.root, "saved.json");
    renameSync(storage.configPath, backup);
    mkdirSync(storage.configPath);
    assert.throws(() => storage.saveAppearance({ ...defaultAppearance, theme: "dark" }));
    assert.deepEqual(storage.getAppearance(), defaultAppearance);
    assert.equal(readdirSync(storage.root).some(name => name.endsWith(".tmp")), false);
    rmdirSync(storage.configPath);
    renameSync(backup, storage.configPath);
    storage.saveAppearance({ ...defaultAppearance, theme: "dark" });
    assert.equal(JSON.parse(readFileSync(storage.configPath, "utf8")).appearance.theme, "dark");
});

test("preferences cannot replace an unreadable or newer app configuration", t => {
    const storage = fixture(t);
    const contents = JSON.stringify({ version: 2, lastWorkspace: null, appearance: defaultAppearance });
    writeFileSync(storage.configPath, contents);
    assert.throws(() => storage.load(), hasFailure("config-newer-version"));
    assert.throws(() => storage.saveAppearance(defaultAppearance), hasFailure("config-not-loaded"));
    assert.equal(readFileSync(storage.configPath, "utf8"), contents);
});