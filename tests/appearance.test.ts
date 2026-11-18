import { pageHistory } from "./support/history";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as settings from "../main/settings/store";
import * as effects from "../main/settings/effects";
import * as workspaceSettings from "../main/workspace-settings";
import * as startup from "../main/startup/startup";
import * as session from "../main/session";
import * as records from "../main/knowledge/records";
import * as edits from "../main/knowledge/edits";
import * as timers from "../main/knowledge/timers";
import * as history from "../main/knowledge/history";
import * as commit from "../main/knowledge/commit";
import * as events from "../main/knowledge/events";
import { defaultSettings, minWindowHeight, minWindowWidth } from "../shared/settings/defaults";
import { dayToSeconds } from "../shared/content/time";
import { hasFailure } from "./failures";

function folder(): string {
    return mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "settings-"));
}
function fixture(t: TestContext): string {
    const root = folder();
    settings.initialize(root);
    t.after(async () => {
        await settings.flush(settings.get().settingsRevision);
    });
    return root;
}
function stored(root: string): typeof defaultSettings {
    return JSON.parse(readFileSync(join(root, "settings.json"), "utf8"));
}

test("settings snapshots are frozen, merge groups, flush durably and leave config.json untouched", async t => {
    const root = fixture(t), legacy = "{\"version\":1,\"lastWorkspace\":{\"id\":\"ignored\"}}";
    writeFileSync(join(root, "config.json"), legacy);
    const first = settings.get();
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.settings.appearance), true);
    assert.equal(Reflect.set(first.settings.layout, "width", 400), false);
    const patches = [
        { history: { limit: 3 } }, { appearance: { theme: "dark" } }, { appearance: { readingSize: 18, motion: false } },
        { window: { width: 950, height: 730, maximized: true } }, { layout: { width: 310, collapsed: true } },
        { lastWorkspace: { id: "one", name: "One", path: join(root, "one") } }
    ];
    for (const patch of patches) assert.equal(settings.update(patch).success, true);
    assert.equal(first.settings.appearance.theme, defaultSettings.appearance.theme);
    const snapshot = settings.get();
    assert.equal(snapshot.dirty, true);
    assert.equal((await settings.flush(snapshot.settingsRevision)).success, true);
    assert.deepEqual(stored(root), snapshot.settings);
    assert.equal(settings.get().savedRevision, snapshot.settingsRevision);
    assert.equal(settings.get().dirty, false);
    settings.initialize(root);
    assert.deepEqual(settings.get().settings, snapshot.settings);
    assert.equal(readFileSync(join(root, "config.json"), "utf8"), legacy);
    assert.equal(existsSync(join(root, "sessions")), false);
});

test("existing settings without a history limit retain their layout and default to unlimited", () => {
    const root = folder(), { history: _history, ...legacy } = defaultSettings;
    const value = { ...legacy, layout: { width: 311, collapsed: true } };
    writeFileSync(join(root, "settings.json"), JSON.stringify(value));
    assert.equal(settings.initialize(root).notice, undefined);
    assert.deepEqual(settings.get().settings, { ...value, history: { limit: null } });
});

test("five rapid changes write once within 600ms of the final theme update", async t => {
    const root = fixture(t), saved: number[] = [];
    let previous = settings.get().savedRevision, completed = 0;
    t.after(settings.subscribe(snapshot => {
        if (snapshot.savedRevision !== previous) {
            previous = snapshot.savedRevision; saved.push(previous); completed = performance.now();
        }
    }));
    for (let i = 0; i < 5; i++) {
        assert.equal(settings.update({ appearance: { readingSize: [14, 16, 18, 14, 16][i], theme: i % 2 ? "light" : "dark" } }).success, true);
        if (i < 4) await delay(25);
    }
    const start = performance.now();
    await delay(600);
    assert.equal(stored(root).appearance.theme, "dark");
    assert.ok(completed - start <= 600);
    assert.equal(saved.length, 1);
});

test("continuous updates reach the five-second maximum save delay", async t => {
    const root = fixture(t);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    settings.update({ layout: { width: 200 } });
    for (let i = 1; i <= 12; i++) {
        t.mock.timers.tick(400);
        settings.update({ layout: { width: 200 + i } });
    }
    assert.equal(existsSync(join(root, "settings.json")), false);
    t.mock.timers.tick(200);
    assert.equal(settings.get().saving, true);
    for (let i = 0; i < 50 && settings.get().saving; i++) await new Promise(resolve => setImmediate(resolve));
    await settings.flush(settings.get().settingsRevision);
    assert.equal(stored(root).layout.width, 212);
});

test("invalid settings patches cannot change memory or disk", async t => {
    const root = fixture(t);
    await settings.flush(0);
    const before = settings.get(), bytes = readFileSync(join(root, "settings.json"));
    for (const patch of [null, [], {}, { version: 2 }, { appearance: {} }, { layout: { width: 169 } },
        ...[0, -1, 1.5, "3", Infinity].map(limit => ({ history: { limit } })),
        { window: { width: minWindowWidth - 1 } }, { window: { height: minWindowHeight - 1 } },
        { appearance: { readingSize: "18" } }, { appearance: { motion: 1 } }, { appearance: { language: "fr" } },
        ...["", null, "+08:00", "Mars/Base"].map(timeZone => ({ appearance: { timeZone } })),
        { layout: { collapsed: "true" } }, { lastWorkspace: { id: "a", name: "A", path: "relative" } }]) {
        const result = settings.update(patch);
        assert.equal(result.success, false, JSON.stringify(patch));
        assert.equal(result.snapshot, before);
    }
    assert.deepEqual(readFileSync(join(root, "settings.json")), bytes);
    assert.equal((await settings.flush(999)).success, false);
});

test("write failures retain accepted settings, report errors, clean temporary files and recover", async t => {
    const root = fixture(t), path = join(root, "settings.json");
    mkdirSync(path);
    settings.update({ appearance: { theme: "dark" } });
    const result = await settings.flush(settings.get().settingsRevision);
    assert.equal(result.success, false);
    assert.ok(settings.get().error);
    assert.equal(settings.get().settings.appearance.theme, "dark");
    assert.equal(settings.get().dirty, true);
    assert.equal(settings.get().saving, false);
    assert.equal(readdirSync(root).some(name => name.endsWith(".tmp")), false);
    rmdirSync(path);
    settings.update({ layout: { width: 300 } });
    assert.equal((await settings.flush(settings.get().settingsRevision)).success, true);
    assert.equal(stored(root).appearance.theme, "dark");
    assert.equal(stored(root).layout.width, 300);
    assert.equal(settings.get().error, null);
});

test("newer and unreadable settings are rejected without replacing their files", t => {
    const root = folder(), path = join(root, "settings.json"), text = JSON.stringify({ ...defaultSettings, version: 2 });
    writeFileSync(path, text);
    startup.initialize(root);
    const state = startup.restore();
    assert.equal(state.status, "needs-workspace");
    if (state.status !== "needs-workspace") throw new Error("Expected startup page");
    assert.equal(state.error?.kind, "config-newer-version");
    assert.equal(state.canChoose, false);
    assert.equal(settings.update({ appearance: { theme: "dark" } }).success, false);
    assert.equal(readFileSync(path, "utf8"), text);
    const unreadable = folder(); mkdirSync(join(unreadable, "settings.json"));
    assert.throws(() => settings.initialize(unreadable));
    assert.equal(settings.update({ layout: { width: 200 } }).success, false);
    t.after(() => startup.close());
});

test("invalid settings are backed up intact and startup reports the backup path", () => {
    const root = folder(), text = "{\"version\":1,\"appearance\":{\"theme\":\"bad\"}}";
    writeFileSync(join(root, "settings.json"), text);
    startup.initialize(root);
    const state = startup.restore();
    assert.equal(state.status, "needs-workspace");
    if (state.status !== "needs-workspace") throw new Error("Expected startup page");
    assert.equal(state.notice?.kind, "config-backup");
    assert.ok(state.notice?.path.includes("settings.invalid-"));
    assert.equal(readFileSync(state.notice!.path, "utf8"), text);
    assert.deepEqual(settings.get().settings, defaultSettings);
    startup.close();
});

test("timezone subscriptions recalculate date reminders and notify the workspace without changing page timestamps", async t => {
    fixture(t); effects.initialize(); t.after(() => effects.release());
    settings.update({ appearance: { timeZone: "UTC" } });
    session.open(folder(), "create"); t.after(() => session.close());
    const page = edits.create("event", "A", { schedule_date: dayToSeconds("2027-01-01") });
    timers.set(page.id, "schedule_date", 0, true);
    const sql = session.getNative(), due = (): number => sql.prepare("SELECT due_at FROM timers WHERE page_id=?").pluck().get(page.id) as number;
    const before = due(), modified = records.get(page.id).attributes.modified_at;
    const observed: events.Event[] = []; t.after(events.subscribe(event => observed.push(event)));
    settings.update({ appearance: { timeZone: "Asia/Shanghai", language: "en" } });
    assert.equal(due(), before - 8 * 3600);
    assert.ok(observed.some(event => event.type === "knowledge" && event.change.notices));
    assert.equal(records.get(page.id).attributes.modified_at, modified);
});

test("workspace settings merge, survive reopen and stay out of page timestamps and undo", t => {
    const opened = session.open(folder(), "create"); t.after(() => session.close());
    const page = edits.create(), modified = records.get(page.id).attributes.modified_at;
    const tabs = { groups: [{ id: "a", tabs: [], activeTabId: null }], focusedGroupId: "a", layout: { type: "group" as const, groupId: "a" } };
    commit.run({ sourceTab: "a", history: false }, () => {
        workspaceSettings.saveTabs(tabs);
        workspaceSettings.update({ feedKeywords: ["  Large   Models ", "large models", "AI"] });
    });
    const expected = { tabs, feedKeywords: ["Large Models", "AI"] };
    assert.deepEqual(workspaceSettings.get(), expected);
    assert.deepEqual(JSON.parse(opened.database.prepare("SELECT settings FROM workspace_meta").pluck().get() as string), expected);
    assert.equal(history.state(pageHistory(page.id)).canUndo, false);
    assert.equal(records.get(page.id).attributes.modified_at, modified);
    assert.throws(() => commit.run({ sourceTab: "a" }, () => {
        workspaceSettings.update({ feedKeywords: ["rollback"] }); throw new Error("rollback");
    }), /rollback/);
    assert.deepEqual(workspaceSettings.get(), expected);
    session.close(); session.open(opened.info.path, "open");
    assert.deepEqual(workspaceSettings.get(), expected);
    assert.throws(() => workspaceSettings.saveTabs({ groups: [] }), hasFailure("tabs-invalid-layout"));
    const feedKeywords = Array.from({ length: 100 }, (_, index) => String(index).padStart(200, "a"));
    workspaceSettings.update({ feedKeywords });
    session.close(); session.open(opened.info.path, "open");
    assert.deepEqual(workspaceSettings.get().feedKeywords, feedKeywords);
});

test("invalid workspace tab layout falls back independently of valid keywords and logs the problem", t => {
    const opened = session.open(folder(), "create"); t.after(() => session.close());
    opened.database.prepare("UPDATE workspace_meta SET settings=?").run(JSON.stringify({ tabs: { groups: "bad" }, feedKeywords: ["AI"] }));
    session.close();
    const warnings = t.mock.method(console, "warn", () => { });
    session.open(opened.info.path, "open");
    assert.deepEqual(workspaceSettings.get(), { tabs: null, feedKeywords: ["AI"] });
    assert.ok(warnings.mock.callCount() > 0);
});

test("retrying workspace restore keeps accepted settings that have not reached disk yet", async t => {
    const root = folder(), workspace = session.open(folder(), "create");
    workspace.database.exec("ALTER TABLE blocks ADD COLUMN obsolete TEXT");
    session.close();
    writeFileSync(join(root, "settings.json"), JSON.stringify({ ...defaultSettings, lastWorkspace: workspace.info }));
    startup.initialize(root);
    t.after(() => startup.close());
    assert.equal(startup.restore().status, "needs-workspace");
    settings.update({ appearance: { theme: "dark" } });
    const revision = settings.get().settingsRevision;
    startup.restore();
    assert.equal(settings.get().settings.appearance.theme, "dark");
    assert.equal(settings.get().settingsRevision, revision);
    assert.equal((await settings.flush(revision)).success, true);
    assert.equal(stored(root).appearance.theme, "dark");
});

test("workspace keywords are read only from feedKeywords", t => {
    const opened = session.open(folder(), "create");
    t.after(() => session.close());
    const warnings = t.mock.method(console, "warn", () => {});
    const cases = [
        { value: { feed: { keywords: ["old"] } }, expected: [] },
        { value: { feedKeywords: [" AI ", "ai"], feed: { keywords: ["old"] } }, expected: ["AI"] },
        { value: { feedKeywords: null, feed: { keywords: ["old"] } }, expected: [] }
    ];
    for (const { value, expected } of cases) {
        session.getNative().prepare("UPDATE workspace_meta SET settings=?").run(JSON.stringify(value));
        session.close(); session.open(opened.info.path, "open");
        assert.deepEqual(workspaceSettings.get().feedKeywords, expected);
    }
    assert.equal(warnings.mock.callCount(), 1);
});