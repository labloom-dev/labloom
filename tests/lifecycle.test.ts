import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { type BrowserWindow } from "electron";
import * as lifecycle from "../main/lifecycle";
import * as settings from "../main/settings/store";
import * as session from "../main/session";
import * as feed from "../main/feed/service";
import * as records from "../main/knowledge/records";
import { type FeedResult } from "../main/feed/parser";
import { registerAppIPCs } from "../main/app/ipc";
import { appChannels, beforeQuit } from "../shared/ipc";

async function until(check: () => boolean): Promise<void> {
    const deadline = performance.now() + 2000;
    while (!check() && performance.now() < deadline) await new Promise(resolve => setImmediate(resolve));
    assert.ok(check(), "operation completed");
}
type LifecycleFixture = {
    root: string; workspace: ReturnType<typeof session.open>; contents: EventEmitter;
    state: { expectSaved: boolean; quit: number; closed: number; dialogs: number; response: number; destroyed: boolean; loading: boolean; contentsDestroyed: boolean; minimized: boolean; shown: number; focused: number; restored: number; hidden: number };
    sent: { channel: string; id: string }[]; close(): void; quit(): void; reply(block: unknown, id?: string): void;
};
function fixture(t: TestContext, platform: NodeJS.Platform = "win32", options: session.SessionOptions = {}, startEditor = true): LifecycleFixture {
    const root = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "lifecycle-"));
    settings.initialize(root);
    mkdirSync(root + "-workspace");
    const workspace = session.open(root + "-workspace", "create", options);
    const app = new EventEmitter(), window = new EventEmitter(), contents = new EventEmitter(), ipc = new EventEmitter();
    const state = { expectSaved: true, quit: 0, closed: 0, dialogs: 0, response: 0, destroyed: false, loading: false, contentsDestroyed: false, minimized: false, shown: 0, focused: 0, restored: 0, hidden: 0 };
    const sent: { channel: string; id: string }[] = [], order: string[] = [], frame = {};
    const event = (): { prevented: boolean; preventDefault(): void } => ({
        prevented: false, preventDefault() {
            this.prevented = true;
        }
    });
    const close = (): void => {
        const e = event(); window.emit("close", e);
        if (!e.prevented) {
            state.destroyed = true; state.closed++; window.emit("closed");
        }
    };
    Object.assign(contents, {
        mainFrame: frame, ipc, isDestroyed: () => state.contentsDestroyed, isLoadingMainFrame: () => state.loading,
        send: (channel: string, id: string) => sent.push({ channel, id }), focus: () => state.focused++
    });
    Object.assign(window, {
        webContents: contents, isDestroyed: () => state.destroyed, isMinimized: () => state.minimized,
        restore: () => {
            state.minimized = false; state.restored++;
        }, show: () => state.shown++, focus: () => state.focused++,
        hide: () => state.hidden++, close
    });
    const quit = (): void => {
        const e = event(); app.emit("before-quit", e);
        if (!e.prevented) {
            assert.equal(workspace.database.open, false, "database closes before actual quit");
            assert.equal(workspace.lock.connection.open, false, "workspace lock closes before actual quit");
            if (state.expectSaved) {
                assert.equal(JSON.parse(readFileSync(join(root, "settings.json"), "utf8")).layout.width, settings.get().settings.layout.width, "settings land before actual quit");
            }
            order.push("quit"); state.quit++;
        }
    };
    Object.assign(app, { quit });
    lifecycle.initialize({
        app: app as unknown as NonNullable<Parameters<typeof lifecycle.initialize>[0]>["app"], platform,
        dialog: {
            showMessageBox: async () => {
                state.dialogs++; return { response: state.response, checkboxChecked: false };
            }
        } as unknown as NonNullable<Parameters<typeof lifecycle.initialize>[0]>["dialog"]
    });
    lifecycle.registerWindowLifecycle(window as unknown as BrowserWindow);
    registerAppIPCs(window as unknown as BrowserWindow);
    if (startEditor) ipc.emit(appChannels.editorStarted, { senderFrame: frame });
    const reply = (block: unknown, id = sent.at(-1)?.id): void => {
        ipc.emit(appChannels.beforeQuitResult, { senderFrame: frame }, id, block);
    };
    t.after(async () => {
        session.close(); await settings.flush(settings.get().settingsRevision);
    });
    return { root, workspace, contents, state, sent, close, quit, reply };
}

test("closing before the editor starts skips the renderer handshake", async t => {
    const f = fixture(t, "win32", {}, false);
    f.close(); await until(() => f.state.quit === 1);
    assert.deepEqual(f.sent, []);
});

test("close and quit share one save request and persist settings before closing the database", async t => {
    const f = fixture(t);
    settings.update({ layout: { width: 330 } });
    f.close(); f.close(); f.quit();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].channel, beforeQuit);
    assert.equal(f.workspace.database.open, true);
    f.reply(false);
    await until(() => f.state.quit === 1);
    assert.equal(f.state.dialogs, 0);
});

test("wrong ids are ignored and malformed or blocking answers retain focus and the session", async t => {
    const f = fixture(t);
    for (const value of [undefined, null, true, 0, "false", {}]) {
        f.state.minimized = true; f.close();
        f.reply(false, "wrong");
        await delay(0);
        assert.equal(f.state.quit, 0);
        f.reply(value);
        if (value !== true) {
            await delay(0);
            assert.equal(f.state.minimized, true);
            f.reply(true);
        }
        await until(() => !f.state.minimized);
        await delay(0);
        assert.equal(f.workspace.database.open, true);
    }
    assert.equal(f.state.restored, 6);
    assert.ok(f.state.focused >= 6);
    f.close(); f.reply(false); await until(() => f.state.quit === 1);
});

for (const response of [0, 1]) {
    test("unanswered save prompts after fifteen seconds; response " + response, async t => {
        const f = fixture(t); f.state.response = response;
        t.mock.timers.enable({ apis: ["setTimeout"] });
        f.close(); t.mock.timers.tick(14999); assert.equal(f.state.dialogs, 0);
        t.mock.timers.tick(1); assert.equal(f.state.dialogs, 1);
        if (response === 1) await until(() => f.state.quit === 1);
        else {
            await until(() => f.state.shown > 0);
            assert.equal(f.state.quit, 0); assert.equal(f.workspace.database.open, true);
        }
    });
}

for (const interrupted of ["navigation", "crash", "destroyed", "loading"]) {
    test("renderer " + interrupted + " blocks exit", async t => {
        const f = fixture(t);
        if (interrupted === "loading") f.state.loading = true;
        f.close();
        if (interrupted === "navigation") f.contents.emit("did-start-navigation", {}, "about:blank", false, true);
        if (interrupted === "crash") f.contents.emit("render-process-gone");
        if (interrupted === "destroyed") {
            f.state.contentsDestroyed = true; f.contents.emit("destroyed");
        }
        await until(() => f.state.shown > 0);
        assert.equal(f.state.quit, 0); assert.equal(f.workspace.database.open, true);
    });
}

for (const platform of ["win32", "darwin"] as const) {
    test("settings save failure is logged and still closes the session and exits: " + platform, async t => {
        const f = fixture(t, platform), path = join(f.root, "settings.json");
        f.state.expectSaved = false;
        const errors = t.mock.method(console, "error", () => {});
        mkdirSync(path); settings.update({ layout: { width: 350 } });
        if (platform === "darwin") f.quit();
        else f.close();
        f.reply(false);
        await until(() => f.state.quit === 1);
        assert.ok(settings.get().error);
        assert.equal(settings.get().settings.layout.width, 350);
        assert.equal(f.workspace.database.open, false);
        assert.equal(f.workspace.lock.connection.open, false);
        assert.equal(f.state.shown, 0);
        assert.ok(errors.mock.calls.some(call => call.arguments[0] === "Could not save settings before exit"));
        rmdirSync(path);
    });
}

test("macOS settings save failure still closes the window and retains the Dock session", async t => {
    const f = fixture(t, "darwin"), path = join(f.root, "settings.json");
    const errors = t.mock.method(console, "error", () => {});
    mkdirSync(path); settings.update({ layout: { width: 350 } });
    f.close(); f.reply(false);
    await until(() => f.state.closed === 1);
    assert.ok(settings.get().error);
    assert.equal(f.state.quit, 0);
    assert.equal(f.workspace.database.open, true);
    assert.equal(f.workspace.lock.connection.open, true);
    assert.equal(f.state.shown, 0);
    assert.ok(errors.mock.calls.some(call => call.arguments[0] === "Could not save settings before exit"));
    rmdirSync(path);
    f.quit(); await until(() => f.state.quit === 1);
});

test("macOS window close destroys the window but retains the session; Cmd+Q later closes it", async t => {
    const f = fixture(t, "darwin");
    settings.update({ layout: { width: 320 } });
    f.close(); f.reply(false);
    await until(() => f.state.closed === 1);
    assert.equal(f.state.quit, 0); assert.equal(f.workspace.database.open, true);
    assert.equal(f.workspace.lock.connection.open, true);
    assert.equal(JSON.parse(readFileSync(join(f.root, "settings.json"), "utf8")).layout.width, 320);
    f.quit(); await until(() => f.state.quit === 1);
});

test("an application quit arriving during a macOS close promotes the same request to full exit", async t => {
    const f = fixture(t, "darwin");
    f.close(); f.quit(); f.reply(false);
    await until(() => f.state.quit === 1);
    assert.equal(f.sent.length, 1); assert.equal(f.state.closed, 0);
});

test("startup with no ready editor closes without a renderer save request", async t => {
    const f = fixture(t);
    session.close(); f.close();
    await until(() => f.state.quit === 1);
    assert.equal(f.sent.length, 0);
});

test("accepted exit aborts in-flight feed refresh and a later reopen has intact data", async t => {
    let slow = false, release!: (value: FeedResult) => void, signal: AbortSignal | undefined;
    const f = fixture(t, "win32", {
        loadFeed: request => {
            signal = request.signal;
            return slow ? new Promise(resolve => release = resolve) : Promise.resolve({ title: "A", url: request.url, entries: [], etag: null, lastModified: null });
        }
    });
    const id = await feed.saveSource({ name: "A", url: "https://example.org/feed" });
    slow = true; const pending = feed.refresh(id);
    f.close(); f.reply(false); await until(() => f.state.quit === 1);
    assert.equal(signal?.aborted, true);
    release({ title: "late", url: "https://example.org/feed", entries: [], etag: null, lastModified: null });
    await assert.doesNotReject(pending);
    session.open(f.workspace.info.path, "open", { loadFeed: async request => ({ title: "A", url: request.url, entries: [], etag: null, lastModified: null }) });
    assert.equal(records.get(id).kind, "feed");
    assert.deepEqual(session.getNative().pragma("integrity_check"), [{ integrity_check: "ok" }]);
});