import { pageHistory, workspaceHistory } from "./support/history";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { type BrowserWindow } from "electron";
import ts from "typescript";
import * as session from "../main/session";
import * as records from "../main/knowledge/records";
import * as attributes from "../main/knowledge/attributes";
import * as edits from "../main/knowledge/edits";
import * as history from "../main/knowledge/history";
import * as papers from "../main/knowledge/papers";
import * as purge from "../main/knowledge/purge";
import * as timers from "../main/knowledge/timers";
import * as commit from "../main/knowledge/commit";
import * as events from "../main/knowledge/events";
import * as feed from "../main/feed/service";
import { registerIPCs } from "../main/register";
import { pagesChannels, attributesChannels, historyChannels, papersChannels, timersChannels, workspaceChannels, settingsChannels, startupChannels, feedChannels } from "../shared/ipc";
import { type CommitResult, type PageRecord } from "../shared/types/content";
import { type AnnotationInput } from "../shared/types/papers";
import { type FeedEntry } from "../shared/types/feed";
import { type FeedResult } from "../main/feed/parser";
import { payload } from "../shared/content/blocks";
import { knownCoordinatePdf } from "./fixtures/pdf-text";
import { annotate, saveFeed } from "./support/session";
import { hasFailure } from "./failures";

function folder(): string {
    return mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "service-"));
}
function open(t: TestContext, options: session.SessionOptions = {}): ReturnType<typeof session.open> {
    const result = session.open(folder(), "create", options);
    t.after(() => session.close());
    return result;
}
function result(url: string, entries: FeedEntry[] = []): FeedResult {
    return { title: "A", url, entries, etag: null, lastModified: null };
}
function entry(id: string, pdfURL: string | null = null): FeedEntry {
    return { externalId: id, title: id, url: null, pdfURL, authors: "", summary: "", content: "", fullContent: false, publishedAt: null };
}
function edit(page: PageRecord, text: string): CommitResult {
    const block = page.blocks[page.children[0]];
    return edits.commitEdit({ pageId: page.id, batch: 0, blocks: [{ ...block, payload: payload("paragraph", text) }] }, pageHistory(page.id));
}
function confirm(action: (token?: string) => CommitResult): CommitResult {
    const preview = action();
    return preview.status === "confirmation" ? action(preview.preview.token) : preview;
}
function erase(ids: string[] | null): void {
    const preview = purge.purge(ids);
    if (preview.status === "confirmation") assert.equal(purge.purge(ids, preview.token).status, "deleted");
}
function selection(fileId: string): AnnotationInput {
    return { fileId, pageNumber: 1, rectangles: [{ x: 50, y: 690, width: 70, height: 30 }], quote: "", context: "", extractorVersion: "" };
}
function files(root: string): { pdf: string; text: string } {
    const pdf = join(root, "A.pdf"), text = join(root, "A.txt");
    writeFileSync(pdf, knownCoordinatePdf());
    writeFileSync(text, "A");
    return { pdf, text };
}

test("opening B drops A history, cached queries, timers and database connection", async t => {
    let now = Date.UTC(2026, 10, 15);
    const a = open(t, { clock: () => now, timeZone: () => "UTC" });
    const first = edits.create(workspaceHistory, "A", { schedule_start: now / 1000 + 60 });
    edit(first, "A");
    timers.set(first.id, "schedule_start", 0, true);
    assert.equal(history.state(pageHistory(first.id)).canUndo, true);
    session.close();
    assert.equal(a.database.open, false);
    assert.equal(a.lock.connection.open, false);
    const b = open(t, { clock: () => now, timeZone: () => "UTC" });
    const second = edits.create(workspaceHistory, "B", { schedule_start: now / 1000 + 60 });
    timers.set(second.id, "schedule_start", 0, true);
    assert.deepEqual(history.state(pageHistory(first.id)), { canUndo: false, canRedo: false });
    assert.deepEqual(records.list().items.map(page => page.id), [second.id]);
    assert.throws(() => records.get(first.id), hasFailure("page-unavailable"));
    now += 60000;
    await timers.check();
    assert.deepEqual(timers.notices().map(notice => notice.pageId), [second.id]);
    assert.equal(b.database.open, true);
});

test("every public service operation rejects a closed session before validating arguments", async t => {
    open(t);
    const page = edits.create(workspaceHistory);
    session.close();
    const operations: (() => unknown)[] = [
        () => session.getDatabase(), () => session.getNative(), () => session.getPath(), () => session.getInfo(),
        () => records.get(page.id), () => records.list(), () => records.listUpdates({}, []), () => records.readObjects(page.id, []),
        () => records.header(""), () => records.readBatch([]), () => records.sharedUses([]), () => records.backlinks(page.id),
        () => records.resolve({ kind: "page", id: page.id }), () => attributes.definitions(), () => attributes.definition("tags"),
        () => edits.create(workspaceHistory), () => edits.commitEdit({} as never, workspaceHistory), () => edits.syncBlocks("", []),
        () => edits.trash([], workspaceHistory), () => edits.restore([], workspaceHistory), () => edits.setDefinition("", null),
        () => history.state(pageHistory(page.id)), () => history.apply(pageHistory(page.id), "undo"),
        () => papers.files([]), () => papers.state(page.id), () => papers.read(""), () => papers.get(page.id),
        () => papers.resources(page.id), () => papers.prepareAnnotation(page.id, ""),
        () => papers.unlockPDF("", ""), () => papers.importFile(""), () => papers.position("", "", {} as never),
        () => purge.purge(null), () => timers.settings(""), () => timers.notices(), () => timers.check(),
        () => timers.set("", "", -1, false), () => timers.read("", "", -1), () => timers.recalculateAll(),
        () => feed.getState({}), () => feed.getItem(""), () => feed.saveSource({} as never), () => feed.setSourceStatus("", "pause"),
        () => feed.setRead("", false), () => feed.markAllRead(), () => feed.setPosition("", -1), () => feed.setKeywords([]),
        () => feed.importItem(""), () => feed.fetchPDF(""), () => feed.refresh(), () => feed.itemURL("")
    ];
    for (const operation of operations) await assert.rejects(Promise.resolve().then(operation), hasFailure("workspace-not-ready"));
});

for (const failed of [false, true]) {
    test(`a source save returning after A closes is discarded without an error: ${failed ? "failure" : "success"}`, async t => {
        let resolveRequest!: (result: FeedResult) => void, rejectRequest!: (reason: Error) => void;
        open(t, {
            loadFeed: () => new Promise((resolve, reject) => {
                resolveRequest = resolve; rejectRequest = reject;
            })
        });
        const pending = saveFeed({ name: "A", url: "https://example.org/a" });
        session.close();
        open(t);
        if (failed) rejectRequest(new Error("old request"));
        else resolveRequest(result("https://example.org/a", [entry("old")]));
        assert.equal(await pending, "");
        assert.equal(records.list().total, 0);
        assert.equal(feed.getState({}).total, 0);
    });
}

test("closing cancels queued refreshes and ignores in-flight successes and failures", async t => {
    let delayed = false;
    let calls = 0;
    const releases: ((value: FeedResult) => void)[] = [];
    const failures: ((reason: Error) => void)[] = [];
    const signals: AbortSignal[] = [];
    open(t, {
        loadFeed: request => {
            calls++;
            if (!delayed) return Promise.resolve(result(request.url));
            signals.push(request.signal!);
            return new Promise((resolve, reject) => {
                releases.push(resolve); failures.push(reject);
            });
        }
    });
    for (let i = 0; i < 6; i++) await saveFeed({ name: String(i), url: "https://example.org/" + i });
    delayed = true;
    const pending = feed.refresh();
    assert.equal(releases.length, 4);
    session.close();
    assert.ok(signals.every(signal => signal.aborted));
    open(t);
    releases[0](result("https://example.org/0", [entry("old")]));
    failures[1](new Error("old failure"));
    releases[2](result("https://example.org/2"));
    releases[3](result("https://example.org/3"));
    await assert.doesNotReject(pending);
    assert.equal(calls, 10);
    assert.equal(feed.getState({}).total, 0);
    assert.equal(records.list().total, 0);
});

test("a PDF download cannot attach to B after its original session closes", async t => {
    let release!: (response: Response) => void, signal: AbortSignal | undefined;
    open(t, {
        loadFeed: request => Promise.resolve(result(request.url, [entry("A", "https://example.org/a.pdf")])),
        fetchAttachment: async (_input, init) => {
            signal = init?.signal ?? undefined; return new Promise(resolve => release = resolve);
        }
    });
    await saveFeed({ name: "A", url: "https://example.org/a" });
    const id = feed.getState({}).items[0].id;
    feed.importItem(id);
    const pending = feed.fetchPDF(id);
    await Promise.resolve();
    session.close();
    assert.equal(signal?.aborted, true);
    open(t);
    release(new Response(knownCoordinatePdf()));
    await assert.doesNotReject(pending);
    assert.deepEqual(papers.files(), []);
    assert.equal(feed.getState({}).total, 0);
});

test("all write paths publish after committing, including direct paper and subscription calls", async t => {
    let now = Date.UTC(2026, 10, 15);
    const workspace = open(t, {
        clock: () => now, timeZone: () => "UTC",
        loadFeed: request => Promise.resolve(result(request.url, [entry("A", "https://example.org/a.pdf")])),
        fetchAttachment: async () => new Response(knownCoordinatePdf())
    });
    const paths = files(workspace.info.path), observed: events.Event[] = [];
    t.after(events.subscribe(event => {
        assert.equal(session.getNative().inTransaction, false);
        observed.push(event);
    }));
    const check = async (name: string, action: () => unknown, feedChange?: boolean): Promise<void> => {
        const start = observed.length;
        await action();
        assert.ok(observed.slice(start).some(event => event.type === "knowledge"), name);
        if (feedChange !== undefined) assert.equal(observed.slice(start).some(event => event.type === "feed"), feedChange, name + " feed event");
    };
    const page = edits.create(workspaceHistory, "A", { schedule_start: now / 1000 + 60 });
    await check("create", () => edits.create(workspaceHistory, "B"));
    await check("edit", () => edit(page, "A"));
    await check("undo", () => history.apply(pageHistory(page.id), "undo"));
    await check("redo", () => history.apply(pageHistory(page.id), "redo"));
    await check("place", () => edits.place({ position: { pageId: page.id, containerId: page.id, index: 0, blockId: page.children[0] }, action: "duplicate" }, pageHistory(page.id)));
    const definition = { id: "custom:" + randomUUID(), name: "A", type: "files" as const, metadata: {} };
    await check("definition", () => edits.setDefinition(definition.id, definition));
    await check("files", () => papers.attachFiles([paths.text], page.id, definition.id, pageHistory(page.id)));
    await check("deleteBlock", () => confirm(token => edits.deleteBlock({ pageId: page.id, blockId: page.children[0] }, pageHistory(page.id), token)));
    await check("trash", () => confirm(token => edits.trash([page.id], workspaceHistory, token)));
    await check("restore", () => edits.restore([page.id], workspaceHistory));
    let paperId = "";
    await check("import PDF", () => {
        paperId = papers.importFile(paths.pdf).pageId;
    });
    await check("add PDF", () => papers.importFile(paths.pdf, paperId, pageHistory(paperId)));
    const fileId = (await papers.resources(paperId)).files[0].id;
    let annotation = "";
    await check("highlight", async () => {
        annotation = await annotate(paperId, selection(fileId), pageHistory(paperId));
    });
    await check("color", () => papers.changeAnnotation(annotation, "green", pageHistory(paperId)));
    await check("reading position", () => papers.position(paperId, fileId, { page: 1, rotation: 0, left: 0, top: 0, scale: 1 }));
    await check("delete highlight", () => confirm(token => papers.deleteAnnotation(annotation, pageHistory(paperId), token)));
    await check("restore highlight", () => edits.restore([annotation], workspaceHistory));
    edits.cacheAttributes(annotation, { annotation_extractor: "old" });
    await check("source-text cache", () => papers.get(annotation));
    await check("reminder setting", () => timers.set(page.id, "schedule_start", 0, true));
    now += 60000;
    await check("reminder dispatch", () => timers.check());
    assert.ok(observed.some(event => event.type === "reminder"));
    await check("read notice", () => timers.read(page.id, "schedule_start", 0));
    await check("time-zone recalculation", () => timers.recalculateAll());
    confirm(token => edits.trash([page.id], workspaceHistory, token));
    await check("purge unrelated page", () => erase([page.id]), false);
    const recycled = edits.create(workspaceHistory);
    confirm(token => edits.trash([recycled.id], workspaceHistory, token));
    await check("empty recycle bin without sources", () => erase(null), false);
    let source = "";
    await check("save source", async () => {
        source = await saveFeed({ name: "A", url: "https://example.org/feed" });
    }, true);
    await check("edit source", () => saveFeed({ id: source, name: "B", url: "https://example.org/feed" }), true);
    await check("source status", () => feed.setSourceStatus(source, "pause"), true);
    feed.setSourceStatus(source, "resume");
    await check("refresh results", () => feed.refresh(source), true);
    const item = feed.getState({}).items[0];
    await check("read item", () => feed.setRead(item.id, false), true);
    await check("mark all read", () => feed.markAllRead(source), true);
    await check("item progress", () => feed.setPosition(item.id, 0.5), true);
    await check("keywords", () => feed.setKeywords(["A"]), true);
    let imported = "";
    await check("import item", () => {
        imported = feed.importItem(item.id).pageId;
    }, true);
    const creation = observed.filter(event => event.type === "knowledge" && event.change.kinds?.[imported] === "paper");
    assert.ok(creation.length > 0, "subscription import uses the same page-kind expansion");
    const beforeDownload = observed.length;
    const file = await feed.fetchPDF(item.id);
    assert.equal(papers.hasPDF(imported), false);
    assert.ok(observed.slice(beforeDownload).some(event => event.type === "feed"));
    assert.ok(observed.slice(beforeDownload).every(event => event.type !== "knowledge"));
    assert.ok(file);
    await check("attach downloaded PDF", () => papers.attachFile(file.pageId, "paper_files", file.fileId, workspaceHistory));
    assert.equal(papers.hasPDF(imported), true);
    await check("trash source", () => confirm(token => edits.trash([source], workspaceHistory, token)), true);
    await check("purge source", () => erase([source]), true);
});

test("one shared-block change expands summaries for both pages and reaches every subscriber", t => {
    open(t);
    const a = edits.create(workspaceHistory), b = edits.create(workspaceHistory);
    edits.commitEdit({ pageId: b.id, batch: 0, blocks: [], pageChildren: [a.children[0]] }, pageHistory(b.id));
    const first: events.Event[] = [], second: events.Event[] = [];
    t.after(events.subscribe(event => first.push(event)));
    t.after(events.subscribe(event => second.push(event)));
    edit(a, "shared");
    const event = first.find(event => event.type === "knowledge");
    assert.equal(event?.type, "knowledge");
    if (event?.type !== "knowledge") return;
    assert.deepEqual(new Set(event.change.summaryPages), new Set([a.id, b.id]));
    assert.equal(event.change.kinds?.[a.id], "editable");
    assert.equal(event.change.kinds?.[b.id], "editable");
    assert.deepEqual(second, first);
});

test("create rules apply to service calls and rolled-back writes publish no events or history", t => {
    open(t);
    assert.throws(() => edits.create(workspaceHistory, "", { modified_at: 0 }), hasFailure("page-create-readonly"));
    const page = edits.createPage(), changed: events.Event[] = [];
    t.after(events.subscribe(event => changed.push(event)));
    assert.throws(() => commit.run({}, () => {
        edit(page, "rollback"); throw new Error("rollback");
    }), /rollback/);
    assert.equal(changed.length, 0);
    assert.equal(history.state(pageHistory(page.id)).canUndo, false);
    assert.equal(records.get(page.id).blocks[page.children[0]].payload.inline.length, 0);
});

test("closing and reopening owns one fifteen-second scheduler and handles only the current workspace", async t => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    let now = Date.UTC(2026, 10, 15);
    const notices: string[] = [];
    t.after(events.subscribe(event => {
        if (event.type === "reminder") notices.push(event.notice.title);
    }));
    const intervals = t.mock.method(globalThis, "setInterval");
    open(t, { clock: () => now, timeZone: () => "UTC" });
    const a = edits.create(workspaceHistory, "A", { schedule_start: now / 1000 + 15 });
    timers.set(a.id, "schedule_start", 0, true);
    session.close();
    open(t, { clock: () => now, timeZone: () => "UTC" });
    const b = edits.create(workspaceHistory, "B", { schedule_start: now / 1000 + 15 });
    timers.set(b.id, "schedule_start", 0, true);
    assert.equal(intervals.mock.callCount(), 2);
    assert.ok(intervals.mock.calls.every(call => call.arguments[1] === 15000));
    now += 15000;
    t.mock.timers.tick(15000);
    await Promise.resolve();
    assert.deepEqual(notices, ["B"]);
    session.close();
    now += 15000;
    t.mock.timers.tick(15000);
    await Promise.resolve();
    assert.deepEqual(notices, ["B"]);
});

test("IPC can register again for a recreated window without replacing the workspace session", async t => {
    open(t);
    const page = edits.create(workspaceHistory, "A");
    const create = (): { window: BrowserWindow; handlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>; frame: object } => {
        const window = new EventEmitter(), frame = {}, handlers = new Map();
        Object.assign(window, { webContents: Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false, ipc: { handle: (name: string, handler: unknown) => handlers.set(name, handler), on: () => { } } }) });
        return { window: window as unknown as BrowserWindow, handlers, frame };
    };
    const a = create();
    registerIPCs(a.window, () => { });
    assert.deepEqual(new Set(a.handlers.keys()), new Set([pagesChannels, attributesChannels, historyChannels, papersChannels, timersChannels, workspaceChannels, settingsChannels, startupChannels, feedChannels].flatMap(group => Object.values(group))));
    a.window.webContents.emit("destroyed");
    a.window.emit("closed");
    const b = create();
    registerIPCs(b.window, () => { });
    t.after(() => b.window.webContents.emit("destroyed"));
    assert.deepEqual(await b.handlers.get(pagesChannels.get)!({ senderFrame: b.frame }, page.id), { ok: true, value: records.get(page.id) });
    assert.deepEqual(await b.handlers.get(feedChannels.getState)!({ senderFrame: b.frame }, {}), { ok: true, value: feed.getState({}) });
});

test("service architecture has no singleton classes, connection WeakMaps, Electron imports or runtime dependency cycles", () => {
    const root = process.cwd(), main = join(root, "main");
    const sources = readdirSync(main, { recursive: true }).filter((file): file is string => typeof file === "string" && file.endsWith(".ts"));
    const graph = new Map<string, string[]>();
    const banned = new Set(["KnowledgeRecords", "KnowledgeService", "EditHistory", "AttributeService", "TimerService", "PaperService", "PurgeService", "FeedService", "Startup", "AppStorage"]);
    for (const file of sources.concat(readdirSync(join(root, "shared"), { recursive: true }).filter((file): file is string => typeof file === "string" && file.endsWith(".ts")).map(file => "../shared/" + file))) {
        const absolute = resolve(main, file), source = ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true), dependencies: string[] = [];
        function visit(node: ts.Node): void {
            if (ts.isClassDeclaration(node)) {
                assert.ok(!banned.has(node.name?.text ?? ""), file);
                if (node.heritageClauses?.length) assert.ok(node.heritageClauses.every(clause => clause.types.every(type => ["Error", "LabloomError"].includes(type.expression.getText(source)))), file);
            }
            if (ts.isNewExpression(node)) assert.notEqual(node.expression.getText(source), "WeakMap", file);
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                const imported = node.moduleSpecifier.text;
                if (/^(knowledge|feed|startup)\//.test(file.replaceAll("\\", "/")) && !file.endsWith("ipc.ts")) assert.notEqual(imported, "electron", file);
                if (file.replaceAll("\\", "/").startsWith("storage/") && imported.startsWith(".")) {
                    const target = relative(root, resolve(dirname(absolute), imported)).replaceAll("\\", "/");
                    assert.ok(target.startsWith("main/storage/") || target.startsWith("shared/"), file + " imports " + imported);
                }
                const valueImport = !node.importClause?.isTypeOnly && (!node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings) || node.importClause.namedBindings.elements.some(element => !element.isTypeOnly));
                if (valueImport && imported.startsWith(".")) dependencies.push(resolve(dirname(absolute), imported) + ".ts");
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
        graph.set(absolute, dependencies);
    }
    function walk(file: string, active = new Set<string>(), done = new Set<string>()): void {
        assert.ok(!active.has(file), "runtime cycle: " + [...active, file].join(" -> "));
        if (done.has(file)) return;
        active.add(file);
        for (const dependency of graph.get(file) ?? []) walk(dependency, active, done);
        active.delete(file);
        done.add(file);
    }
    for (const file of graph.keys()) walk(file);
    for (const file of sources.filter(file => /[/\\]ipc\.ts$/.test(file))) {
        const text = readFileSync(join(main, file), "utf8");
        assert.ok(!/\b(SELECT|INSERT INTO|UPDATE \w+ SET|WITH RECURSIVE)\b/.test(text), file + " contains SQL");
    }
});
test("annotation parsing returning after close leaves B unchanged and reports no stale error", async t => {
    const a = open(t), paths = files(a.info.path), paper = papers.importFile(paths.pdf).pageId;
    const file = (await papers.resources(paper)).files[0].id;
    const pending = annotate(paper, selection(file), pageHistory(paper));
    session.close();
    open(t);
    assert.equal(await pending, "");
    assert.equal(records.list().total, 0);
    assert.deepEqual(papers.files(), []);
});

test("overview lists unfinished pages by date and falls back to modification time", t => {
    const workspace = session.open(folder(), "create");
    t.after(() => session.close());
    const a = edits.createPage("editable", "A", { task_status: "todo" });
    const b = edits.createPage("paper", "B", { task_status: "doing", schedule_date: 86400 });
    const c = edits.createPage("editable", "C", { task_status: "todo", schedule_date: 0 });
    const d = edits.createPage("editable", "D", { task_status: "done", schedule_date: 0 });
    const e = edits.createPage("editable", "E", { task_status: "todo", schedule_date: 0 });
    const value = workspace.database.prepare("UPDATE page_attrs SET value=? WHERE attr_id=? AND page_id=?");
    value.run(1n, "deleted", e.id);
    value.run(3n, "modified_at", a.id);
    value.run(2n, "modified_at", b.id);
    value.run(1n, "modified_at", c.id);
    const query = { status: "task_status", date: "schedule_date", recent: [d.id, d.titleBlockId, e.id, a.id] };
    const result = records.overviewIndex(query);
    assert.deepEqual(result.taskIds, [c.id, b.id, a.id]);
    assert.deepEqual(result.tasks.map(row => row.date), [0, 86400, null]);
    assert.deepEqual(result.recent.map(row => row.id), [d.id, a.id]);
    assert.deepEqual(records.overviewRows([b.id, e.id, c.id], query.date).map(row => row.id), [b.id, c.id]);
    assert.deepEqual(records.overviewIndex({ ...query, date: "task_status" }).taskIds, [a.id, b.id, c.id]);
    assert.equal(records.overviewIndex({ ...query, status: "schedule_date" }).missingStatus, true);
});