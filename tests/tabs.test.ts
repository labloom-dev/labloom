import assert from "node:assert/strict";
import test from "node:test";
import { validate, version } from "uuid";
import { getGroupID, getTabID } from "../renderer/components/Tab/ids";
import { TabVisits, type TabView } from "../renderer/components/Tab/visits";

function latch(): { wait: Promise<void>; release: () => void } {
    let release!: () => void;
    const wait = new Promise<void>(resolve => {
 release = resolve;
});
    return { wait, release };
}
type TestPage = (id: string, visible: string[], options?: Partial<TabView>) => Promise<string[][]>;
function harness(): { visits: TabVisits; locks: Set<string>; errors: unknown[]; page: TestPage } {
    const locks = new Set<string>(), errors: unknown[] = [];
    const visits = new TabVisits((id, on) => {
        if (on) locks.add(id); else locks.delete(id);
    }, problem => errors.push(problem));
    async function page(id: string, visible: string[], options: Partial<TabView> = {}): Promise<string[][]> {
        const reads: string[][] = [];
        visits.register(id, {
            intersection: change => [...change.pages, ...change.blocks].filter(object => visible.includes(object)),
            read: async (ids, initial) => {
 if (!initial) reads.push(ids);
},
            pending: () => undefined, flush: async () => true, ...options
        });
        assert.equal(await visits.settled(id), true);
        return reads;
    }
    return { visits, locks, errors, page };
}

test("new tab and group IDs are distinct bare UUIDs, and legacy identities stay opaque", async () => {
    const ids = Array.from({ length: 50 }, () => [getTabID(), getGroupID()]).flat();
    assert.equal(new Set(ids).size, 100);
    assert.ok(ids.every(id => validate(id) && version(id) === 4));
    const { visits, page } = harness();
    const legacy = "tab-" + getTabID(), reads = await page(legacy, ["A"]);
    visits.focus(legacy);
    visits.changed({ sourceTab: legacy, pages: ["A"], blocks: [] });
    visits.changed({ sourceTab: ids[0], pages: ["A"], blocks: ["other"] });
    await visits.settled(legacy);
    assert.deepEqual(reads, [["A"]]);
});

test("leaving flushes immediately; an entering pane waits for the acknowledgement and reads only its intersection", async () => {
    const { visits, locks, page } = harness(), ack = latch(), reading = latch(), started = latch();
    let saves = 0;
    await page("left", ["A", "X"], { pending: () => ({ pages: ["A"], blocks: ["X"] }),
        flush: async () => {
 saves++; await ack.wait; return true;
} });
    const reads: string[][] = [];
    await page("right", ["B", "X"], { read: async (ids, initial) => {
        if (initial) return;
        reads.push(ids);
        started.release();
        await reading.wait;
    } });
    visits.focus("left");
    visits.focus("right");
    assert.equal(saves, 1);
    assert.ok(locks.has("right"));
    visits.changed({ sourceTab: "left", pages: ["A"], blocks: ["X", "other"] });
    await Promise.resolve();
    assert.deepEqual(reads, []);
    ack.release();
    await started.wait;
    visits.changed({ sourceTab: "elsewhere", pages: ["B"], blocks: ["X", "other"] });
    reading.release();
    assert.ok(await visits.settled("right"));
    assert.deepEqual(reads, [["X"], ["B", "X"]]);
    assert.ok(!locks.has("right"));
});

test("clean and unrelated switches take no read lock; blur flushes and return coalesces intervening broadcasts", async () => {
    const { visits, locks, page } = harness(), done = latch();
    let saves = 0;
    const reads = await page("one", ["A"], { pending: () => ({ pages: ["A"], blocks: [] }), flush: async () => {
        saves++; await done.wait; return true;
    } });
    await page("two", ["B"]);
    visits.focus("one");
    visits.focus("two");
    assert.equal(saves, 1);
    assert.equal(locks.size, 0);
    done.release();
    visits.focus(null);
    visits.changed({ sourceTab: "two", pages: ["A"], blocks: [] });
    visits.changed({ sourceTab: "two", pages: ["A"], blocks: [] });
    assert.deepEqual(reads, []);
    visits.focus("one");
    await visits.settled("one");
    assert.deepEqual(reads, [["A"]]);
    visits.focus(null);
    assert.equal(saves, 2);
});

test("rapid visits commit the middle tab's buffered input before the next tab reads", async () => {
    const { visits, page } = harness(), wait = latch(), order: string[] = [];
    await page("a", ["X"], { pending: () => "unknown", flush: async () => {
        await wait.wait;
        visits.changed({ sourceTab: "a", pages: [], blocks: ["X"] });
        return true;
    } });
    await page("b", ["X"], { pending: () => "unknown", ready: () => order.push("apply keys"), flush: async () => {
        order.push("save b");
        visits.changed({ sourceTab: "b", pages: [], blocks: ["X"] });
        return true;
    } });
    await page("c", ["X"], { read: async (_ids, initial) => {
 if (!initial) order.push("read c");
} });
    order.length = 0;
    visits.focus("a"); visits.focus("b"); visits.focus("c");
    wait.release();
    await visits.settled("c");
    assert.deepEqual(order, ["apply keys", "save b", "read c"]);
});

test("failed reads retain the exact invalidations and stay read-only until a successful visit", async () => {
    const { visits, locks, errors, page } = harness(), reads: string[][] = [];
    let fail = true;
    await page("a", ["X"], { read: async (ids, initial) => {
        if (initial) return;
        reads.push(ids);
        if (fail) throw new Error("read failed");
    } });
    visits.focus("a");
    visits.changed({ sourceTab: "b", pages: [], blocks: ["X"] });
    assert.equal(await visits.settled("a"), false);
    assert.ok(locks.has("a"));
    assert.equal(errors.length, 1);
    fail = false;
    visits.focus(null); visits.focus("a");
    assert.ok(await visits.settled("a"));
    assert.ok(!locks.has("a"));
    assert.deepEqual(reads, [["X"], ["X"]]);
});

test("a failed departure protects the destination while the author can return and correct the unsaved change", async () => {
    const { visits, locks, page } = harness();
    let valid = false;
    await page("a", ["X"], { pending: () => ({ pages: [], blocks: ["X"] }), flush: async () => valid });
    await page("b", ["X"]);
    visits.focus("a"); visits.focus("b");
    assert.equal(await visits.settled("b"), false);
    assert.ok(locks.has("b"));
    visits.focus("a");
    assert.ok(await visits.settled("a"));
    assert.ok(!locks.has("a"));
    valid = true;
    visits.focus("b");
    assert.ok(await visits.settled("b"));
    assert.ok(!locks.has("b"));
});