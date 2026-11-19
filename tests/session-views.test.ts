import assert from "node:assert/strict";
import test from "node:test";
import { type CommitResult, type KnowledgeChange } from "../shared/types/content";
import { WriteReceipts, trackWrite } from "../renderer/components/Knowledge/write-tracker";
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
        changed: () => [], pending: () => false,
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
    const offParent = views.add(view({ changed: change => change.pages.filter(id => id === "paper"), ready: () => ready.push("paper") }));
    const offPopup = views.add(view({ changed: change => [...change.pages.filter(id => id === "annotation"), "shared"], ready: () => ready.push("annotation") }));
    assert.equal(views.size, 2);
    assert.deepEqual(views.changed({ pages: ["paper", "annotation"], blocks: [] }), ["paper", "annotation", "shared"]);
    views.ready();
    assert.deepEqual(ready, ["paper", "annotation"]);
    offPopup();
    assert.equal(views.size, 1);
    assert.deepEqual(views.changed({ pages: ["paper", "annotation"], blocks: [] }), ["paper"]);
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
    views.add(view({ pending: () => true, flush: async () => {
        saved.push("paper"); return true;
    } }));
    views.add(view({ pending: () => true, flush: async () => {
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
    visits.register("destination", view({ changed: change => change.pages.filter(id => id === "annotation") }));
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
    await views.read();
    const off = views.add(view({ changed: change => change.blocks, read: async (_ids, initial) => {
 popupReads.push(initial);
} }));
    await views.read();
    views.changed({ pages: [], blocks: ["annotation-block"] });
    await views.read();
    await views.read();
    assert.deepEqual(parentReads, [true]);
    assert.deepEqual(popupReads, [true, false]);
    assert.equal(parentState.editor, originalEditor);
    assert.equal(parentState.typed, "kept parent text");
    off();
    await views.read();
    assert.equal(parentReads.filter(Boolean).length, 1);
    assert.equal(popupReads.length, 2);
});

test("a failed initial annotation read retries initialization without reinitializing the parent", async () => {
    const views = new SessionViews(), parentReads: boolean[] = [], popupReads: boolean[] = [];
    views.add(view({ read: async (_ids, initial) => {
 parentReads.push(initial);
} }));
    await views.read();
    let fail = true;
    views.add(view({ read: async (_ids, initial) => {
        popupReads.push(initial);
        if (fail) throw new Error("annotation read failed");
    } }));
    await assert.rejects(views.read(), /annotation read failed/);
    fail = false;
    await views.read();
    assert.deepEqual(parentReads, [true]);
    assert.deepEqual(popupReads, [true, true]);
});

test("closing an annotation while its initial read is pending never resurrects the closed view", async () => {
    const views = new SessionViews(), reading = latch(), started = latch();
    const off = views.add(view({ read: async () => {
 started.release(); await reading.wait;
} }));
    const opening = views.read();
    await started.wait;
    off();
    assert.equal(views.size, 0);
    reading.release();
    await opening;
    assert.equal(views.size, 0);
});
for (const order of ["notification first", "reply first"]) {
    test("only the originating page buffer skips its save when delivery is " + order, async () => {
        const visits = new TabVisits(() => {}, error => {
            throw error;
        });
        const buffers = ["A", "B", "C"].map(() => ({ receipts: new WriteReceipts(), reads: [] as string[][] }));
        for (const [tab, members] of [["left", buffers.slice(0, 2)], ["right", buffers.slice(2)]] as const) {
            const views = new SessionViews();
            for (const buffer of members) views.add(view({
                changed: change => buffer.receipts.take(change.writeId) ? [] : change.pages,
                read: async (ids, initial) => {
                    if (!initial) buffer.reads.push(ids);
                }
            }));
            visits.register(tab, views);
            await visits.settled(tab);
        }
        visits.focus("left");
        const reply = latch();
        let writeId = "";
        const save = buffers[0].receipts.submit(async id => {
            writeId = id;
            await reply.wait;
            return { status: "saved", batch: 1, changed: { pages: ["page"], blocks: [] } };
        });
        const change: KnowledgeChange = { writeId, pages: ["page"], blocks: [] };
        if (order === "notification first") visits.changed(change);
        reply.release(); await save;
        if (order === "reply first") visits.changed(change);
        await visits.settled("left");
        visits.focus("right"); await visits.settled("right");
        assert.deepEqual(buffers.map(buffer => buffer.reads), [[], [["page"]], [["page"]]]);
    });
}
test("cancelled previews and failed requests leave no outstanding receipt", async () => {
    const receipts = new WriteReceipts();
    let id = "";
    await receipts.submit(async value => {
        id = value;
        return { status: "confirmation", preview: { token: "A", recycled: [], direct: [], causes: [], deletedBlocks: [] } };
    });
    assert.equal(receipts.take(id), false);
    await assert.rejects(receipts.submit(async (value): Promise<CommitResult> => {
        id = value;
        throw new Error("failed");
    }));
    assert.equal(receipts.take(id), false);
});
test("entering a clean tab waits for a workspace write even when there is no outgoing tab", async () => {
    const locks = new Set<string>(), writes = latch();
    const visits = new TabVisits((id, locked) => {
        if (locked) locks.add(id); else locks.delete(id);
    }, error => {
        throw error;
    });
    visits.register("A", view());
    await visits.settled("A");
    const write = trackWrite(writes.wait);
    visits.focus("A");
    assert.ok(locks.has("A"));
    writes.release(); await write;
    await visits.settled("A");
    assert.equal(locks.size, 0);
});

test("refocusing during an initial read keeps the editor locked through a newer workspace write", async () => {
    const reading = latch(), began = latch(), writing = latch(), oldReadDone = latch(), locks: boolean[] = [];
    const visits = new TabVisits((_id, locked) => locks.push(locked), error => {
        throw error;
    });
    visits.register("page", view({ read: async () => {
        began.release();
        await reading.wait;
    }, ready: oldReadDone.release }));
    await began.wait;
    const write = trackWrite(writing.wait);
    visits.focus("page");
    const settled = visits.settled("page");
    reading.release();
    await oldReadDone.wait;
    assert.ok(!locks.includes(false));
    writing.release();
    await write;
    assert.equal(await settled, true);
    assert.equal(locks.at(-1), false);
});