import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { FeedService, type FeedLibrary } from "../main/feed/service";
import { PaperService } from "../main/knowledge/papers";
import { KnowledgeService } from "../main/knowledge/service";
import { createWorkspaceDatabase } from "../main/storage/database";
import { generatedMigrations } from "../main/storage/migrations/generated";
import { runMigrations } from "../main/storage/migrations/runner";
import { v1 } from "../main/storage/migrations/v1";
import { v2 } from "../main/storage/migrations/v2";
import { v3 } from "../main/storage/migrations/v3";
import { v4 } from "../main/storage/migrations/v4";
import { createWorkspace } from "../main/storage/workspace";
import { importFeedPDF } from "../main/feed/pdf";
import { knownCoordinatePdf } from "./fixtures/pdf-text";
import { type FeedEntry } from "../shared/types/feed";

function entry(values: Partial<FeedEntry>): FeedEntry {
    return { externalId: null, title: "Untitled", url: null, pdfURL: null, authors: "", summary: "", content: "", fullContent: false, publishedAt: null, ...values };
}

test("upgrading to subscription status keeps sources, items and read state, and stops deleting history with a source", async t => {
    const database = new Database(":memory:");
    t.after(() => database.close());
    database.pragma("foreign_keys = ON");
    const migrations = [v1, v2, v3, v4, ...generatedMigrations];
    runMigrations(database, migrations.filter(migration => migration.to <= 14));
    const refreshed = Date.UTC(2026, 10, 1), published = Date.UTC(2026, 9, 7);
    database.prepare("INSERT INTO feed_sources (id, name, url, last_refreshed, last_added, error) VALUES ('source', 'Saved feed', 'https://example.org/feed', ?, 2, 'Network unavailable')").run(refreshed);
    database.prepare("INSERT INTO feed_sources (id, name, url) VALUES ('never', 'Never fetched', 'https://example.org/never')").run();
    const insert = database.prepare("INSERT INTO feed_items (id, source_id, external_id, title, url, authors, summary, published_at, is_read) VALUES (?, 'source', ?, ?, ?, 'Author', 'Summary', ?, ?)");
    insert.run("read", "guid-1", "Read article", "https://example.org/1?utm_source=rss", published, 1);
    insert.run("unread", "guid-2", "Unread article", null, null, 0);

    runMigrations(database, migrations);
    assert.deepEqual(database.pragma("foreign_key_check"), []);
    assert.deepEqual(database.prepare("SELECT * FROM feed_sources ORDER BY id DESC").all(), [{
        id: "source", name: "Saved feed", url: "https://example.org/feed", subscription_status: "enabled", auto_refresh: 1, interval_minutes: 60,
        last_refreshed: refreshed, last_added: 2, error: "Network unavailable", last_checked: refreshed, next_refresh: null, failures: 0, etag: null, last_modified: null
    }, {
        id: "never", name: "Never fetched", url: "https://example.org/never", subscription_status: "enabled", auto_refresh: 1, interval_minutes: 60,
        last_refreshed: null, last_added: 0, error: null, last_checked: null, next_refresh: null, failures: 0, etag: null, last_modified: null
    }]);
    assert.deepEqual(database.prepare("SELECT * FROM feed_items WHERE id = 'read'").get(), {
        id: "read", source_id: "source", external_id: "guid-1", title: "Read article", url: "https://example.org/1?utm_source=rss", normalized_url: null,
        content_fingerprint: null, authors: "Author", summary: "Summary", raw_content: "", has_full_content: 0, published_at: published,
        pdf_url: null, origin_snapshot: null, is_read: 1, reading_position: null, paper_id: null
    });
    // A source can no longer take its items with it, and its settings are validated.
    assert.throws(() => database.exec("DELETE FROM feed_sources WHERE id = 'source'"), /FOREIGN KEY/);
    assert.throws(() => database.exec("UPDATE feed_sources SET interval_minutes = 5"), /feed_sources_interval/);
    assert.throws(() => database.exec("UPDATE feed_sources SET subscription_status = 'deleted'"), /feed_sources_status/);
    assert.equal(database.prepare("SELECT count(*) FROM feed_items").pluck().get(), 2);

    // Sources that existed before the upgrade are due at once, and their items are recognised and completed.
    const requested: string[] = [];
    const service = new FeedService(createWorkspaceDatabase(database), async request => {
        requested.push(request.url);
        return {
            entries: request.url.endsWith("/never") ? [] : [
                entry({ externalId: "guid-1", title: "Read article", url: "https://example.org/1", content: "<p>Body</p>", fullContent: true, publishedAt: published }),
                entry({ externalId: "guid-3", title: "New article" })
            ],
            title: "", url: request.url, etag: "\"v1\"", lastModified: null
        };
    });
    await service.refreshDue();
    assert.deepEqual(requested.sort(), ["https://example.org/feed", "https://example.org/never"]);
    const state = service.getState({});
    assert.deepEqual([state.total, state.unreadCount], [3, 2]);
    assert.deepEqual(state.sources.map(source => [source.name, source.lastAdded, source.error]), [["Never fetched", 0, null], ["Saved feed", 1, null]]);
    const saved = service.getItem("read");
    assert.deepEqual([saved.isRead, saved.content, saved.fullContent], [true, "<p>Body</p>", true]);
    assert.deepEqual(database.prepare("SELECT normalized_url, etag FROM feed_items JOIN feed_sources ON feed_sources.id = source_id WHERE feed_items.id = 'read'").get(),
        { normalized_url: "https://example.org/1", etag: "\"v1\"" });
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
    assert.throws(() => service.importItem(item.id), /重新入库/);
    const replacement = service.importItem(item.id, true);
    assert.notEqual(replacement, pageId);
    assert.deepEqual([service.getItem(item.id).paperState, knowledge.get(replacement).title], ["saved", "Language models"]);
    // A link to a page that is not a paper, or no longer exists, is reported as missing.
    workspace.database.prepare("UPDATE feed_items SET paper_id = ? WHERE id = ?").run(randomUUID(), item.id);
    assert.equal(service.getItem(item.id).paperState, "missing");
    workspace.database.prepare("UPDATE feed_items SET paper_id = ? WHERE id = ?").run(knowledge.create("editable", "Note").id, item.id);
    assert.equal(service.getItem(item.id).paperState, "missing");
});

test("a downloaded PDF attaches to the committed reference and reuses identical stored bytes without merging pages", async t => {
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
    assert.equal(downloadedFiles[0].id, originalFiles[0].id);
    assert.deepEqual(Buffer.from(papers.read(downloadedFiles[0].id)), Buffer.from(data));
    assert.equal(workspace.database.prepare("SELECT count(*) FROM attachments").pluck().get(), 1);
    assert.equal(knowledge.list({ kind: "paper" }).total, 2);
    assert.equal(service.getItem(item.id).paperId, pageId);
    await service.fetchPDF(item.id);
    assert.equal(requests, 1);
});