import assert from "node:assert/strict";
import test from "node:test";
import { SessionViews, sessionKey } from "../renderer/components/Knowledge/session-views";
import { TabVisits, type TabView } from "../renderer/components/Tab/visits";

function latch(): { wait: Promise<void>; release: () => void } {
    let release!: () => void;
    const wait = new Promise<void>(resolve => {
 release = resolve;
});
    return { wait, release };
}

function view(options: Partial<TabView> = {}): TabView {
    return {
        intersection: () => [], pending: () => undefined,
        read: async () => {}, flush: async () => true, ...options
    };
}

test("page identity includes both tab and page, even when their strings contain separators", () => {
    const identities = [
        sessionKey("tab", "paper"), sessionKey("tab", "annotation"),
        sessionKey("other-tab", "paper"), sessionKey("a:b", "c"), sessionKey("a", "b:c"),
        sessionKey("a\",\"b", "c"), sessionKey("a", "b\",\"c")
    ];
    assert.equal(new Set(identities).size, identities.length);
    assert.equal(sessionKey("tab", "paper"), sessionKey("tab", "paper"));
});

test("parent and annotation views coexist within one tab and detach independently", async () => {
    const views = new SessionViews(), ready: string[] = [];
    const offParent = views.add(view({ intersection: change => change.pages.filter(id => id === "paper"), ready: () => ready.push("paper") }));
    const offPopup = views.add(view({ intersection: change => [...change.pages.filter(id => id === "annotation"), "shared"], ready: () => ready.push("annotation") }));
    assert.equal(views.size, 2);
    assert.deepEqual(views.intersection({ pages: ["paper", "annotation"], blocks: [] }), ["paper", "annotation", "shared"]);
    views.ready();
    assert.deepEqual(ready, ["paper", "annotation"]);
    offPopup();
    assert.equal(views.size, 1);
    assert.deepEqual(views.intersection({ pages: ["paper", "annotation"], blocks: [] }), ["paper"]);
    offParent();
    assert.equal(views.size, 0);
});

test("page flushes wait in registration order and append to one tab's undo sequence", async () => {
    const views = new SessionViews(), parentAck = latch(), popupAck = latch(), popupStarted = latch();
    const events: string[] = [], history: string[] = [];
    views.add(view({ flush: async () => {
        events.push("paper start");
        await parentAck.wait;
        history.push("paper edit");
        events.push("paper saved");
        return true;
    } }));
    views.add(view({ flush: async () => {
        events.push("annotation start");
        popupStarted.release();
        await popupAck.wait;
        history.push("annotation edit");
        events.push("annotation saved");
        return true;
    } }));
    const saving = views.flush();
    assert.deepEqual(events, ["paper start"]);
    parentAck.release();
    await popupStarted.wait;
    assert.deepEqual(events, ["paper start", "paper saved", "annotation start"]);
    popupAck.release();
    assert.equal(await saving, true);
    assert.deepEqual(history, ["paper edit", "annotation edit"]);
    assert.equal(history.pop(), "annotation edit", "the tab's next undo is the annotation edit");
});

test("a page save failure stops later flushes and blocks entering another affected tab", async () => {
    const views = new SessionViews(), saved: string[] = [], locks = new Set<string>(), errors: unknown[] = [];
    let valid = false;
    views.add(view({ pending: () => ({ pages: ["paper"], blocks: [] }), flush: async () => {
        saved.push("paper"); return true;
    } }));
    views.add(view({ pending: () => ({ pages: ["annotation"], blocks: [] }), flush: async () => {
        saved.push("annotation"); return valid;
    } }));
    views.add(view({ flush: async () => {
 saved.push("later page"); return true;
} }));
    assert.equal(await views.flush(), false);
    assert.deepEqual(saved, ["paper", "annotation"]);
    const visits = new TabVisits((id, on) => {
 if (on) locks.add(id); else locks.delete(id);
}, error => errors.push(error));
    visits.register("paper-tab", views);
    visits.register("destination", view({ intersection: change => change.pages.filter(id => id === "annotation") }));
    assert.equal(await visits.settled("paper-tab"), true);
    assert.equal(await visits.settled("destination"), true);
    visits.focus("paper-tab");
    visits.focus("destination");
    assert.equal(await visits.settled("destination"), false);
    assert.ok(locks.has("destination"));
    assert.equal(errors.length, 1);
    assert.ok(!saved.includes("later page"));
    valid = true;
    visits.focus("paper-tab");
    visits.focus("destination");
    assert.equal(await visits.settled("destination"), true);
    assert.ok(saved.includes("later page"));
});

test("adding an annotation initializes it once without rebuilding the already open parent", async () => {
    const views = new SessionViews(), parentReads: boolean[] = [], popupReads: boolean[] = [];
    const parentState = { editor: {}, typed: "kept parent text" }, originalEditor = parentState.editor;
    views.add(view({ read: async (_ids, initial) => {
        parentReads.push(initial);
        if (initial) parentState.editor = originalEditor;
    } }));
    await views.read([], true);
    const off = views.add(view({ read: async (_ids, initial) => {
 popupReads.push(initial);
} }));
    await views.read([], true);
    await views.read(["annotation-block"], false);
    await views.read([], true);
    assert.deepEqual(parentReads, [true, false, false, false]);
    assert.deepEqual(popupReads, [true, false, false]);
    assert.equal(parentState.editor, originalEditor);
    assert.equal(parentState.typed, "kept parent text");
    off();
    await views.read([], true);
    assert.equal(parentReads.filter(Boolean).length, 1);
    assert.equal(popupReads.length, 3);
});

test("a failed initial annotation read retries initialization without reinitializing the parent", async () => {
    const views = new SessionViews(), parentReads: boolean[] = [], popupReads: boolean[] = [];
    views.add(view({ read: async (_ids, initial) => {
 parentReads.push(initial);
} }));
    await views.read([], true);
    let fail = true;
    views.add(view({ read: async (_ids, initial) => {
        popupReads.push(initial);
        if (fail) throw new Error("annotation read failed");
    } }));
    await assert.rejects(views.read([], true), /annotation read failed/);
    fail = false;
    await views.read([], true);
    assert.deepEqual(parentReads, [true, false, false]);
    assert.deepEqual(popupReads, [true, true]);
});

test("closing an annotation while its initial read is pending never resurrects the closed view", async () => {
    const views = new SessionViews(), reading = latch(), started = latch();
    const off = views.add(view({ read: async () => {
 started.release(); await reading.wait;
} }));
    const opening = views.read([], true);
    await started.wait;
    off();
    assert.equal(views.size, 0);
    reading.release();
    await opening;
    assert.equal(views.size, 0);
});