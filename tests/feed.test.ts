import { hasFailure } from "./failures";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { type FeedResult } from "../main/feed/parser";
import { FeedService, type FeedLibrary } from "../main/feed/service";
import { PaperService } from "../main/knowledge/papers";
import { KnowledgeService } from "../main/knowledge/service";
import { createWorkspaceDatabase } from "../main/storage/database";
import { initializeBuiltinAttrs } from "../main/storage/builtin-attrs";
import { createWorkspaceSchema } from "../main/storage/schema";
import { PurgeService } from "../main/knowledge/purge";
import { EditHistory } from "../main/knowledge/history";
import { payload } from "../shared/content/blocks";
import { createWorkspace } from "../main/storage/workspace";
import { importFeedPDF } from "../main/feed/pdf";
import { knownCoordinatePdf } from "./fixtures/pdf-text";
import { type FeedEntry } from "../shared/types/feed";

function entry(values: Partial<FeedEntry>): FeedEntry {
    return { externalId: null, title: "Untitled", url: null, pdfURL: null, authors: "", summary: "", content: "", fullContent: false, publishedAt: null, ...values };
}

test("feed pages own settings and timers while refresh preserves item state and timestamp units", async t => {
    const database = new Database(":memory:"); t.after(() => database.close()); database.pragma("foreign_keys = ON");
    createWorkspaceSchema(database); const db = createWorkspaceDatabase(database); initializeBuiltinAttrs(db);
    database.prepare("INSERT INTO workspace_meta(id,name,created_at,last_modified_at) VALUES ('workspace','A',0,0)").run();
    const now = Date.UTC(2026, 10, 1), published = Date.UTC(2026, 9, 7), knowledge = new KnowledgeService(db, () => "UTC", () => now);
    const source = knowledge.create("feed", "Saved feed", { feed_url: "https://example.org/feed", feed_last_refreshed: now / 1000, feed_last_added: 2, feed_error: "Network unavailable" });
    const never = knowledge.create("feed", "Never fetched", { feed_url: "https://example.org/never" });
    const insert = database.prepare("INSERT INTO feed_items(id,source_id,external_id,title,url,authors,summary,published_at,is_read) VALUES (?,?,?,?,?,'Author','Summary',?,?)");
    insert.run("read", source.id, "guid-1", "Read article", "https://example.org/1?utm_source=rss", published, 1);
    insert.run("unread", source.id, "guid-2", "Unread article", null, null, 0);
    assert.deepEqual(knowledge.get(source.id).children, []);
    assert.equal(database.prepare("SELECT count(*) FROM timers").pluck().get(), 2);
    const requested: string[] = [];
    const service = new FeedService(db, async request => {
        requested.push(request.url);
        return { entries: request.url.endsWith("/never") ? [] : [entry({ externalId: "guid-1", title: "Read article", url: "https://example.org/1", content: "<p>Body</p>", fullContent: true, publishedAt: published }), entry({ externalId: "guid-3", title: "New article" })], title: "", url: request.url, etag: "v1", lastModified: null };
    }, undefined, () => now);
    const modified = knowledge.get(source.id).attributes.modified_at;
    await service.refreshDue(); assert.deepEqual(requested.sort(), [source.attributes.feed_url, never.attributes.feed_url].sort());
    const state = service.getState({}); assert.deepEqual([state.total, state.unreadCount], [3, 2]);
    assert.deepEqual(state.sources.map(row => [row.name, row.lastAdded, row.error]), [["Never fetched", 0, null], ["Saved feed", 1, null]]);
    assert.deepEqual([service.getItem("read").isRead, service.getItem("read").content], [true, "<p>Body</p>"]);
    assert.equal(knowledge.get(source.id).attributes.feed_etag, "v1");
    assert.equal(knowledge.get(source.id).attributes.feed_last_refreshed, now / 1000);
    assert.equal(knowledge.get(source.id).attributes.modified_at, modified);
    assert.equal(knowledge.list({ kind: "feed" }).total, 2);
    assert.equal(knowledge.list({ keyword: "Saved feed" }).total, 1);
    assert.throws(() => knowledge.commitEdit({ pageId: source.id, tabId: "feed", batch: 0, blocks: [], attributes: { feed_refresh: { every: 5, unit: "minute" } } }), hasFailure("feed-invalid-interval"));
    assert.throws(() => knowledge.commitEdit({ pageId: source.id, tabId: "feed", batch: 0, blocks: [], pageChildren: [source.titleBlockId] }), hasFailure("feed-body-forbidden"));
    assert.deepEqual(database.pragma("foreign_key_check"), []);
});

test("a subscription item becomes a paper page in the library and stays linked to it", async t => {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "feed-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    const knowledge = new KnowledgeService(workspace.db), papers = new PaperService(knowledge, workspace.info.path);
    const announced: string[] = [];
    const library: FeedLibrary = {
        createPaper: paper => papers.createReference(paper),
        paperState: id => papers.state(id),
        announce: id => announced.push(id)
    };
    const published = Date.UTC(2026, 9, 7, 10);
    const service = new FeedService(workspace.db, async request => ({
        entries: [
            entry({ externalId: "http://arxiv.org/abs/2610.00001v1", title: "Language models", url: "https://arxiv.org/abs/2610.00001v1", authors: "Alice, Bob", summary: "We study models.", publishedAt: published }),
            entry({ externalId: "bare", title: "No link or date" })
        ],
        title: "", url: request.url, etag: null, lastModified: null
    }), library);
    const source = await service.saveSource({ name: "arXiv cs.AI", url: "https://rss.arxiv.org/atom/cs.AI" });
    const [item, bare] = service.getState({}).items;

    const pageId = service.importItem(item.id);
    assert.deepEqual(announced, [pageId]);
    const page = knowledge.get(pageId);
    assert.deepEqual([page.kind, page.title, page.attributes.deleted], ["paper", "Language models", false]);
    assert.deepEqual([page.attributes.paper_authors, page.attributes.paper_url, page.attributes.paper_abstract, page.attributes.paper_year],
        ["Alice, Bob", "https://arxiv.org/abs/2610.00001v1", "We study models.", "2026-10-07"]);
    assert.deepEqual(page.attributes.source_snapshot, {
        kind: "feed", itemId: item.id, sourceId: source, sourceName: "arXiv cs.AI", feedURL: "https://rss.arxiv.org/atom/cs.AI",
        externalId: "http://arxiv.org/abs/2610.00001v1", url: "https://arxiv.org/abs/2610.00001v1"
    });
    assert.ok(knowledge.list({ kind: "paper" }).items.some(row => row.id === pageId));
    assert.equal(papers.state(pageId), "saved");
    assert.equal(service.importItem(item.id), pageId);
    assert.equal(knowledge.list({ kind: "paper" }).total, 1);

    // An item without a link or date still makes a valid paper.
    const second = knowledge.get(service.importItem(bare.id));
    assert.deepEqual([second.title, second.attributes.paper_url, second.attributes.paper_year, second.attributes.paper_authors], ["No link or date", "", "", ""]);

    // A paper in the recycle bin is reported, and only replaced when the reader asks.
    const removal = knowledge.trash([pageId], "feed-test");
    if (removal.status === "confirmation") knowledge.trash([pageId], "feed-test", removal.preview.token);
    assert.equal(service.getItem(item.id).paperState, "recycled");
    assert.throws(() => service.importItem(item.id), hasFailure("feed-reimport-confirmation"));
    const replacement = service.importItem(item.id, true);
    assert.notEqual(replacement, pageId);
    assert.deepEqual([service.getItem(item.id).paperState, knowledge.get(replacement).title], ["saved", "Language models"]);
    // A link to a page that is not a paper, or no longer exists, is reported as missing.
    workspace.database.prepare("UPDATE feed_items SET paper_id = ? WHERE id = ?").run(randomUUID(), item.id);
    assert.equal(service.getItem(item.id).paperState, "missing");
    workspace.database.prepare("UPDATE feed_items SET paper_id = ? WHERE id = ?").run(knowledge.create("editable", "Note").id, item.id);
    assert.equal(service.getItem(item.id).paperState, "missing");
});

test("a downloaded PDF attaches to its committed paper as independent bytes, and refetching creates another attachment", async t => {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "feed-pdf-")));
    t.after(() => {
 if (workspace.database.open) workspace.database.close();
});
    const knowledge = new KnowledgeService(workspace.db), papers = new PaperService(knowledge, workspace.info.path);
    const data = knownCoordinatePdf(), original = join(workspace.info.path, "original.pdf");
    writeFileSync(original, data);
    const existingPage = papers.importFile(original).pageId;
    let requests = 0;
    const server = createServer((_request, response) => {
 requests++; response.end(data);
});
    t.after(() => {
 server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve()));
});
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const pdfURL = `http://127.0.0.1:${address.port}/paper.pdf`;
    const library: FeedLibrary = {
        createPaper: paper => papers.createReference(paper), paperState: id => papers.state(id),
        hasPDF: id => papers.hasPDF(id),
        importPDF: (id, url) => importFeedPDF(url, path => {
 papers.importFile(path, id);
}),
        announce: () => {}
    };
    const service = new FeedService(workspace.db, async request => ({
        entries: [entry({ externalId: "download", title: "Subscribed paper", pdfURL })],
        title: "", url: request.url, etag: null, lastModified: null
    }), library);
    await service.saveSource({ name: "Downloads", url: `http://127.0.0.1:${address.port}/feed` });
    const [item] = service.getState({}).items;
    const pageId = service.importItem(item.id);
    assert.notEqual(pageId, existingPage);
    assert.equal(workspace.database.inTransaction, false);
    assert.equal(knowledge.get(pageId).title, "Subscribed paper");
    assert.equal(papers.hasPDF(pageId), false);
    assert.equal(service.getItem(item.id).pdfStatus, "downloading");
    await service.fetchPDF(item.id);
    assert.equal(service.getItem(item.id).pdfStatus, "saved");
    const originalFiles = (await papers.resources(existingPage)).files;
    const downloadedFiles = (await papers.resources(pageId)).files;
    assert.equal(downloadedFiles.length, 1);
    assert.notEqual(downloadedFiles[0].id, originalFiles[0].id);
    assert.deepEqual(Buffer.from(papers.read(downloadedFiles[0].id)), Buffer.from(data));
    assert.equal(workspace.database.prepare("SELECT count(*) FROM attachments").pluck().get(), 2);
    assert.equal(knowledge.list({ kind: "paper" }).total, 2);
    assert.equal(service.getItem(item.id).paperId, pageId);
    await service.fetchPDF(item.id);
    assert.equal(requests, 1);
    assert.deepEqual(knowledge.get(pageId).attributes.paper_files, [downloadedFiles[0].id]);
    assert.equal(knowledge.commitEdit({ pageId, tabId: "remove-feed-pdf", batch: 0, blocks: [], attributes: { paper_files: [] } }).status, "saved");
    assert.equal(papers.hasPDF(pageId), false);
    assert.notEqual(service.getItem(item.id).pdfStatus, "saved");
    await service.fetchPDF(item.id);
    assert.equal(requests, 2);
    assert.equal(service.getItem(item.id).pdfStatus, "saved");
    const replacement = (await papers.resources(pageId)).files[0];
    assert.notEqual(replacement.id, downloadedFiles[0].id);
    assert.notEqual(replacement.id, originalFiles[0].id);
    assert.deepEqual(knowledge.get(pageId).attributes.paper_files, [replacement.id]);
});

test("feed settings, recycling and restoration maintain a single timer and enforce URL and body constraints", async t => {
    const ws = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "feed-page-"))); t.after(() => ws.database.close());
    const clock = { now: Date.UTC(2026, 10, 13) }, knowledge = new KnowledgeService(ws.db, () => "UTC", () => clock.now), history = new EditHistory(knowledge);
    const feed = new FeedService(ws.db, async request => ({ title: "", url: request.url, entries: [], etag: null, lastModified: null }), undefined, () => clock.now);
    const id = await feed.saveSource({ name: "A", url: "https://example.org/feed" });
    const count = (): unknown => ws.database.prepare("SELECT count(*) FROM timers WHERE page_id=?").pluck().get(id);
    assert.equal(knowledge.header(id).kind, "feed"); assert.deepEqual(knowledge.get(id).children, []); assert.equal(count(), 1);
    feed.setSourceStatus(id, "pause"); assert.equal(count(), 0);
    feed.setSourceStatus(id, "resume"); assert.equal(count(), 1);
    assert.equal(knowledge.commitEdit({ pageId: id, tabId: "settings", batch: 0, blocks: [], attributes: { feed_refresh: null } }).status, "saved"); assert.equal(count(), 0);
    assert.equal(history.apply("settings", "undo").status, "saved"); assert.equal(count(), 1);
    const page = knowledge.get(id), child = { id: randomUUID(), type: "paragraph" as const, payload: payload("paragraph", "Forbidden"), children: [] };
    assert.throws(() => knowledge.commitEdit({ pageId: id, tabId: "settings", batch: 0, blocks: [child], pageChildren: [child.id] }), hasFailure("feed-body-forbidden"));
    assert.throws(() => knowledge.commitEdit({ pageId: id, tabId: "settings", batch: 0, blocks: [{ ...page.blocks[page.titleBlockId], children: [child.id] }] }), hasFailure("feed-body-forbidden"));
    assert.throws(() => knowledge.place({ position: { pageId: id, containerId: id, index: 0, blockId: page.titleBlockId }, action: "insert", tabId: "settings" }), hasFailure("feed-body-forbidden"));
    const preview = knowledge.trash([id], "trash"); if (preview.status === "confirmation") knowledge.trash([id], "trash", preview.preview.token);
    assert.equal(count(), 0); assert.equal(feed.getState({}).sources.length, 0);
    await assert.rejects(feed.saveSource({ name: "B", url: "https://example.org/feed" }), hasFailure("feed-duplicate"));
    knowledge.restore([id], "restore"); assert.equal(count(), 1);
    const title = knowledge.get(id).blocks[page.titleBlockId];
    knowledge.commitEdit({ pageId: id, tabId: "rename", batch: 0, blocks: [{ ...title, payload: payload("title", "B") }] });
    assert.equal(feed.getState({}).sources[0].name, "B");
    assert.ok(knowledge.list({ keyword: "B", kind: "feed" }).items.some(page => page.id === id));
});

test("permanently deleting a source cascades its entries without deleting imported paper pages", async t => {
    const ws = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "feed-purge-"))); t.after(() => ws.database.close());
    const knowledge = new KnowledgeService(ws.db), history = new EditHistory(knowledge), papers = new PaperService(knowledge, ws.info.path);
    const feed = new FeedService(ws.db, async request => ({ title: "", url: request.url, entries: [entry({ externalId: "A", title: "A" })], etag: null, lastModified: null }), { createPaper: paper => papers.createReference(paper), paperState: id => papers.state(id), announce: () => {} });
    const source = await feed.saveSource({ name: "A", url: "https://example.org/feed" }), paper = feed.importItem(feed.getState({}).items[0].id);
    const removal = knowledge.trash([source], "trash"); if (removal.status === "confirmation") knowledge.trash([source], "trash", removal.preview.token);
    const purge = new PurgeService(knowledge, history, ws.info.path), preview = purge.purge([source], "purge");
    if (preview.status !== "confirmation") throw new Error("Expected confirmation");
    assert.equal(purge.purge([source], "purge", preview.token).status, "deleted");
    assert.equal(ws.database.prepare("SELECT count(*) FROM feed_items").pluck().get(), 0);
    assert.equal(knowledge.get(paper).kind, "paper"); assert.equal(papers.state(paper), "saved");
    assert.deepEqual(ws.database.pragma("foreign_key_check"), []);
});

test("separate services over the same workspace share one in-flight source request", async t => {
    const ws = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "feed-windows-"))); t.after(() => ws.database.close());
    const clock = { now: Date.UTC(2026, 10, 13) }; let slow = false, calls = 0, release!: () => void;
    const load = async (request: { url: string }): Promise<FeedResult> => {
 calls++; if (slow) await new Promise<void>(resolve => release = resolve); return { title: "", url: request.url, entries: [], etag: null, lastModified: null };
};
    const first = new FeedService(ws.db, load, undefined, () => clock.now), id = await first.saveSource({ name: "A", url: "https://example.org/feed" }), second = new FeedService(ws.db, load, undefined, () => clock.now);
    slow = true; clock.now += 3600000;
    const a = first.refreshDue(); await Promise.resolve(); const b = second.refresh(id);
    assert.equal(calls, 2); release(); await Promise.all([a, b]);
    assert.equal(calls, 2); assert.equal(second.getState({}).sources[0].refreshing, false);
    assert.equal(ws.database.prepare("SELECT due_at FROM timers WHERE page_id=?").pluck().get(id), Math.floor(clock.now / 1000) + 3600);
});