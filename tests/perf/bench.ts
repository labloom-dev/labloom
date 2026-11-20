import * as history from "../../main/knowledge/history";
import * as settings from "../../main/settings/store";
import { pageHistory } from "../support/history";
import { session, type Knowledge } from "../support/session";
import { fixture, seedLargePage, type SeedPage } from "./fixture";
import assert from "node:assert/strict";
import { cpus, platform, release } from "node:os";
import { payload } from "../../shared/content/blocks";
import { type CommitResult } from "../../shared/types/content";

const samples = 20;
let exceeded = false;
type Sample = () => void;

function measure(label: string, limit: number, prepare: (round: number) => Sample): void {
    const times: number[] = [];
    for (let round = 0; round <= samples; round++) {
        const operation = prepare(round);
        const start = performance.now();
        operation();
        const elapsed = performance.now() - start;
        if (round) times.push(elapsed);
    }
    times.sort((a, b) => a - b);
    const percentile = (p: number): number => times[Math.ceil(p * times.length) - 1];
    const p95 = percentile(0.95);
    console.log(label, "P50", percentile(0.5).toFixed(2), "P95", p95.toFixed(2), "ms | limit", limit, p95 <= limit ? "PASS" : "FAIL");
    if (p95 > limit) exceeded = true;
}

function prepareText(service: Knowledge, pageId: string, round: number) {
    const page = service.get(pageId), block = page.blocks[page.children[0]];
    const value = { ...block, payload: payload("paragraph", "Edited " + round) };
    return (token?: string): CommitResult => service.commitEdit({ pageId, batch: round, blocks: [value] }, pageHistory(pageId), token);
}

function prepareDeletion(service: Knowledge, pageId: string) {
    const page = service.get(pageId), blockId = page.children[0];
    return (token?: string): CommitResult => service.deleteBlock({ pageId, blockId }, pageHistory(pageId), token);
}

function confirmed(operation: (token?: string) => CommitResult, recycled: number): Sample {
    const preview = operation();
    assert.equal(preview.status, "confirmation");
    assert.equal(preview.preview.recycled.length, recycled);
    return () => assert.equal(operation(preview.preview.token).status, "saved");
}

function workspaceScale(): void {
    const { sql, service, makePage } = fixture();
    try {
        const groups: SeedPage[] = [];
        const target = sql.transaction(() => {
            let last = "";
            for (let i = 0; i < 10000; i++) {
                const page = makePage(10, "Research notes", i % 100 === 0);
                if (i < 10 * (samples + 1)) groups.push(page);
                last = page.id;
            }
            return last;
        })();
        service.rebuildLinks();
        measure("A | read ordinary page", 10, () => () => assert.equal(service.get(target).children.length, 9));
        measure("A | first page of list", 20, () => () => assert.equal(service.list({ limit: 30 }).items.length, 30));
        measure("A | keyword, 100 matching pages", 1000, () => () => {
            const result = service.searchPages("quasar", 0, 30);
            assert.ok(result.items.every(page => page.match.field === "body" && page.match.snippet === "quasar"));
            assert.equal(result.items.length, 30);
            assert.equal(result.total, 100);
        });
        measure("A | edit one block", 30, round => {
            const edit = prepareText(service, target, round);
            return () => assert.equal(edit().status, "saved");
        });
        // Keep ten positions in ten distinct pages for each deletion sample.
        const replace = sql.prepare("UPDATE pages SET children = ? WHERE id = ?");
        sql.transaction(() => {
            for (let i = 0; i < groups.length; i++) {
                if (i % 10 === 0) continue;
                const group = groups[i], sharedId = groups[i - i % 10].children[0];
                replace.run(JSON.stringify([sharedId, ...group.children.slice(1)]), group.id);
            }
        })();
        const uses = sql.prepare("SELECT count(*) FROM sync_refs WHERE block_id = ?").pluck();
        measure("A | confirm delete at ten positions", 100, round => {
            const first = groups[round * 10];
            assert.equal(uses.get(first.children[0]), 10);
            return confirmed(prepareDeletion(service, first.id), 0);
        });
    }
    finally {
        session.close();
    }
}

function largePage(): void {
    const data = fixture();
    const { sql, service } = data;
    try {
        const large = seedLargePage(data);
        measure("B | read 10000-block page", 300, () => () => assert.equal(service.get(large.id).children.length, 9999));
        measure("B | edit one block", 30, round => {
            const edit = prepareText(service, large.id, round);
            return () => assert.equal(edit().status, "saved");
        });
    }
    finally {
        session.close();
    }
}

function historyScale(): void {
    const { sql, service, makePage } = fixture();
    try {
        settings.initialize(session.getPath());
        const pages = sql.transaction(() => Array.from({ length: 100 }, (_, index) => makePage(index === 0 ? 10000 : 2, "History")))();
        const edits = pages.map(page => {
            const block = service.readObjects(page.id, [page.children[0]]).blocks[0], source = pageHistory(page.id);
            return (round: number): CommitResult => service.commitEdit({ pageId: page.id, batch: round,
                blocks: [{ ...block, payload: payload("paragraph", "History " + round) }] }, source);
        });
        for (let i = 0; i < 10000; i++) assert.equal(edits[i % 100](i).status, "saved");
        const source = pageHistory(pages[0].id);
        measure("History | edit one block on a 10000-block page with 10000 records", 30, round =>
            () => assert.equal(edits[0](10000 + round).status, "saved"));
        measure("History | undo one block on the same page", 30, () =>
            () => assert.equal(history.apply(source, "undo").status, "saved"));
        const start = performance.now();
        const result = settings.update({ history: { limit: 100 } });
        const elapsed = performance.now() - start;
        assert.ok(result.success);
        console.log("History | trim to 100 records", elapsed.toFixed(2), "ms | limit 50", elapsed <= 50 ? "PASS" : "FAIL");
        if (elapsed > 50) exceeded = true;
        // Count retained records by redoing to the end and undoing to the start of each page.
        let retained = 0;
        for (const page of pages) {
            const tree = pageHistory(page.id);
            while (history.state(tree).canRedo) history.apply(tree, "redo");
            while (history.state(tree).canUndo) {
                history.apply(tree, "undo"); retained++;
            }
        }
        assert.equal(retained, 100);
    }
    finally {
        session.close();
    }
}

function retentionGraph(): void {
    const { sql, service, makePage, attr } = fixture();
    try {
        const size = 24;
        const rewrite = sql.prepare("UPDATE blocks SET type = ?, content = ? WHERE id = ?");
        measure("Graph | confirm removal of last retaining edge to 24 pages", 100, round => {
            const root = sql.transaction(() => {
                const root = makePage(2, "Root");
                const nodes = Array.from({ length: size }, () => makePage(2, "Dependent", false, false));
                const first = { kind: "page", id: nodes[0].id };
                rewrite.run("paragraph", JSON.stringify({ ...payload("paragraph"), inline: [{ type: "inlineReference", attrs: { target: first, label: "Entry" } }] }), root.children[0]);
                for (let i = 0; i < nodes.length; i++) {
                    const target = { kind: "page", id: nodes[(i + 1) % size].id };
                    const source = nodes[i];
                    if (i % 3 === 0) rewrite.run("blocked_reference", JSON.stringify({ ...payload("blocked_reference"), target }), source.children[0]);
                    if (i % 3 === 1) rewrite.run("paragraph", JSON.stringify({ ...payload("paragraph"), inline: [{ type: "inlineReference", attrs: { target, label: "Next" } }] }), source.children[0]);
                    if (i % 3 === 2) attr.run(JSON.stringify([target.id]), source.id, "links");
                }
                return root;
            })();
            service.rebuildLinks();
            return confirmed(prepareText(service, root.id, round), size);
        });
    }
    finally {
        session.close();
    }
}

function probes(): void {
    const { sql, service, makePage } = fixture();
    try {
        const a = makePage(2, "Alpha"), b = makePage(2, "Beta");
        sql.prepare("UPDATE pages SET children = ? WHERE id = ?").run(JSON.stringify([a.children[0]]), b.id);
        service.rebuildLinks();
        confirmed(prepareDeletion(service, a.id), 0)();
        console.log("Probe | remaining positions after deleting a synced block:", sql.prepare("SELECT count(*) FROM sync_refs WHERE block_id = ?").pluck().get(a.children[0]));
        for (const keyword of ["tags", "true", "2026", "modified"]) console.log("Probe | search", keyword, "matched", service.list({ keyword }).total, "of 2 pages");
    }
    finally {
        session.close();
    }
}

console.log(platform(), release(), cpus()[0].model, "Electron", process.versions.electron);
console.log("Warm database | 1 warm-up +", samples, "samples per measurement | nearest-rank percentiles | timings exclude fixture creation and the confirmation dialog/preview.");
workspaceScale();
largePage();
historyScale();
retentionGraph();
probes();
if (exceeded) process.exitCode = 1;