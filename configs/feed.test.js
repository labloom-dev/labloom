import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import ts from "typescript";
import Database from "better-sqlite3";

// Compile the tested modules with the existing compiler; no test framework is needed.
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "dist"), { recursive: true });
const output = mkdtempSync(join(root, "dist", "feed-tests-"));
after(() => rmSync(output, { recursive: true, force: true }));
writeFileSync(join(output, "package.json"), "{\"type\":\"commonjs\"}");
const program = ts.createProgram(["main/feed/service.ts", "main/storage/workspace.ts"].map(file => join(root, file)), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
    noEmitOnError: true,
    rootDir: root,
    outDir: output
});
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n"
}));
program.emit();
const require = createRequire(import.meta.url);
const { FeedService } = require(join(output, "main/feed/service.js"));
const { parseFeed, fetchFeed } = require(join(output, "main/feed/parser.js"));
const { arxivURL, feedURL } = require(join(output, "shared/utils/feed.js"));
const { createWorkspace, openWorkspace } = require(join(output, "main/storage/workspace.js"));
const { createWorkspaceDatabase } = require(join(output, "main/storage/database.js"));
const { createWorkspaceSchema } = require(join(output, "main/storage/schema.js"));

function memoryDatabase() {
    const database = new Database(":memory:");
    database.pragma("foreign_keys = ON");
    createWorkspaceSchema(database);
    return database;
}

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel><title>Research</title><link>https://example.org</link><description>Updates</description>
    <item><guid isPermaLink="false">paper-1-v1</guid><title>Agents &amp; tools</title>
    <link>/papers/1</link><dc:creator>Alice</dc:creator><pubDate>Wed, 07 Oct 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Tool use &amp; evaluation.</p>]]></description></item></channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>arXiv</title>
    <entry><id>http://arxiv.org/abs/2610.00001v1</id><title>Language\n models</title>
    <author><name>Alice</name></author><author><name>Bob</name></author>
    <published>2026-10-07T10:00:00Z</published><link rel="alternate" href="https://arxiv.org/abs/2610.00001v1"/>
    <summary type="html">&lt;p&gt;A &amp;amp; B&lt;/p&gt;</summary></entry>
    <entry><id>http://arxiv.org/abs/2610.00001v2</id><title>Language models, revised</title>
    <link rel="alternate" href="javascript:alert(1)"/><summary>Updated.</summary></entry></feed>`;

test("arXiv category and phrase queries produce usable feed addresses", () => {
    assert.equal(arxivURL("cs.AI, cs.LG cs.AI", ""), "https://rss.arxiv.org/atom/cs.AI+cs.LG");
    const url = new URL(arxivURL("cs.AI, cs.LG", "large language model"));
    assert.equal(url.searchParams.get("search_query"), "(cat:cs.AI OR cat:cs.LG) AND (ti:\"large language model\" OR abs:\"large language model\")");
    assert.equal(url.searchParams.get("max_results"), "10");
    assert.equal(url.searchParams.get("sortBy"), "submittedDate");
    assert.match(arxivURL("", "reasoning"), /search_query=/);
    assert.throws(() => arxivURL("", ""));
    assert.throws(() => arxivURL("cs.AI OR all:test", ""));
    assert.throws(() => arxivURL("cs.AI", "test\" OR all:anything"));
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "https://user:secret@example.org", "invalid"]) {
        assert.throws(() => feedURL(url));
    }
});

test("RSS and Atom retain identities, all authors, summaries and safe links", async () => {
    const [entry] = await parseFeed(rss, "https://example.org/feed.xml");
    assert.equal(entry.externalId, "paper-1-v1");
    assert.equal(entry.url, "https://example.org/papers/1");
    assert.equal(entry.summary, "Tool use & evaluation.");
    assert.equal(entry.authors, "Alice");
    assert.equal(entry.publishedAt, Date.UTC(2026, 9, 7, 10));
    const entries = await parseFeed(atom, "https://rss.arxiv.org/atom/cs.AI");
    assert.equal(entries[0].title, "Language models");
    assert.equal(entries[0].authors, "Alice, Bob");
    assert.equal(entries[0].summary, "A & B");
    assert.notEqual(entries[0].externalId, entries[1].externalId);
    assert.equal(entries[1].url, null);
    assert.equal(entries[1].publishedAt, null);
    const [announcement] = await parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <entry><id>oai:arXiv.org:2610.00001v1</id><title>Daily announcement</title>
        <dc:creator>Alice</dc:creator><dc:creator>Bob</dc:creator><summary>Research update.</summary></entry></feed>`, "https://rss.arxiv.org/atom/cs.AI");
    assert.equal(announcement.authors, "Alice, Bob");
    assert.equal(announcement.externalId, "oai:arXiv.org:2610.00001v1");
});

test("invalid feeds and arXiv error responses fail without creating entries", async () => {
    await assert.rejects(parseFeed("<html>not a feed</html>", "https://example.org"));
    await assert.rejects(parseFeed("<!DOCTYPE rss [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><rss/>", "https://example.org"));
    await assert.rejects(parseFeed("<feed xmlns=\"http://www.w3.org/2005/Atom\"><entry><id>http://arxiv.org/api/errors#incorrect_id_format</id><summary>Invalid query</summary></entry></feed>", "https://export.arxiv.org"), /Invalid query/);
    assert.deepEqual(await parseFeed("<feed xmlns=\"http://www.w3.org/2005/Atom\"><title>Empty</title></feed>", "https://example.org"), []);
});

test("fetching handles HTTP errors and oversized responses", async () => {
    const entries = await fetchFeed("https://example.org/feed", async () => new Response(rss));
    assert.equal(entries.length, 1);
    await assert.rejects(fetchFeed("https://example.org/feed", async () => new Response("limited", { status: 429 })), /频繁/);
    await assert.rejects(fetchFeed("https://example.org/feed", async () => new Response("x".repeat(10 * 1024 * 1024 + 1))), /10 MB/);
});

test("blog feeds import the latest ten unique entries and retain older saved articles", async () => {
    const database = memoryDatabase();
    let latest = 12;
    const load = () => fetchFeed("https://openai.com/news/rss.xml", async () => {
        const items = Array.from({ length: latest }, (_, i) => `<item><guid>blog-${i + 1}</guid><title>Post ${i + 1}</title>
            <pubDate>${new Date(Date.UTC(2026, 9, i + 1)).toUTCString()}</pubDate></item>`);
        return new Response(`<rss version="2.0"><channel><title>Blog</title>${items.join("")}${items.at(-1)}
            <item><guid>undated</guid><title>No date</title></item></channel></rss>`);
    });
    const service = new FeedService(createWorkspaceDatabase(database), load);
    try {
        const entries = await load();
        assert.equal(entries.length, 10);
        assert.equal(entries[0].externalId, "blog-12");
        assert.equal(entries.at(-1).externalId, "blog-3");
        const id = await service.saveSource({ name: "Blog", url: "https://openai.com/news/rss.xml" });
        const oldest = service.getState({}).items.at(-1);
        service.setRead(oldest.id, true);
        latest = 13;
        await service.refresh(id);
        const state = service.getState({});
        assert.equal(state.total, 11);
        assert.equal(state.sources[0].lastAdded, 1);
        assert.equal(state.items.find(item => item.id === oldest.id).isRead, true);
    }
    finally {
        database.close();
    }
});

test("Anthropic pages provide safe article links, summaries and dates across data chunks", async () => {
    for (const section of ["news", "engineering"]) {
        const post = (slug, date, summary = "A summary with \"quotes\", ] brackets and 中文。") => ({
            _type: section === "news" ? "post" : "engineeringArticle",
            title: `  Article\n ${slug}  `,
            slug: { current: slug },
            publishedOn: date,
            summary
        });
        const posts = Array.from({ length: 12 }, (_, i) => post(`post-${i + 1}`, `2026-10-${String(i + 1).padStart(2, "0")}`));
        const data = `1:I["module"]\n2:T3,abc3:${JSON.stringify(["$", "component", null, { sections: [
            { items: [post("post-1", "2026-10-01"), {
                _type: "featuredGridLink", title: "Latest announcement", date: "2026-10-13", url: "/announcement", summary: "Featured summary."
            }, {
                _type: "featuredGridLink", title: "Unsafe link", date: "2026-10-14", url: "javascript:alert(1)"
            }] },
            { [section === "news" ? "posts" : "articles"]: [...posts, post("post-12", "2026-10-12", null), post("../invalid", "2026-10-15")] }
        ] }])}\n`;
        const split = Math.floor(data.length / 2);
        const html = `<!DOCTYPE html><html>${[data.slice(0, split), data.slice(split)].map(chunk =>
            `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`).join("")}</html>`;
        const url = `https://www.anthropic.com/${section}/`;
        const entries = await fetchFeed(url, async (_url, init) => {
            assert.equal(init.headers.Accept, "text/html");
            return new Response(html);
        });
        assert.equal(entries.length, 10);
        assert.equal(new Set(entries.map(entry => entry.externalId)).size, 10);
        assert.equal(entries[0].title, section === "news" ? "Latest announcement" : "Article post-12");
        assert.equal(entries[0].url, section === "news" ? "https://www.anthropic.com/announcement" : `${url}post-12`);
        assert.equal(entries[0].publishedAt, Date.UTC(2026, 9, section === "news" ? 13 : 12));
        assert.equal(entries.find(entry => entry.title === "Article post-12").summary, "A summary with \"quotes\", ] brackets and 中文。");
    }
    await assert.rejects(fetchFeed("https://www.anthropic.com/news", async () => new Response("<!DOCTYPE html><h1>Unavailable</h1>")), /未找到 Anthropic 文章/);
    await assert.rejects(fetchFeed("https://www.anthropic.com/news/article", async () => new Response("<!DOCTYPE html><h1>Article</h1>")), /XML/);
});

test("arXiv requests are serialized and spaced at least three seconds apart", async () => {
    const calls = [];
    let active = 0;
    const fetcher = async () => {
        assert.equal(active++, 0);
        calls.push(Date.now());
        await new Promise(resolve => setTimeout(resolve, 10));
        active--;
        return new Response(atom);
    };
    await Promise.all([
        fetchFeed("https://rss.arxiv.org/atom/cs.AI", fetcher),
        fetchFeed("https://export.arxiv.org/api/query?search_query=cat:cs.LG", fetcher)
    ]);
    assert.ok(calls[1] - calls[0] >= 3000);
});

test("entries and read state survive refreshes and reopening the workspace", async () => {
    const folder = mkdtempSync(join(output, "workspace-"));
    const workspace = createWorkspace(folder);
    const entries = await parseFeed(atom, "https://rss.arxiv.org/atom/cs.AI");
    const service = new FeedService(workspace.db, async () => entries);
    const id = await service.saveSource({ name: "arXiv", url: "https://rss.arxiv.org/atom/cs.AI" });
    let state = service.getState({ sourceId: id });
    assert.equal(state.total, 2);
    assert.equal(state.sources[0].lastAdded, 2);
    const item = state.items.find(item => item.url);
    service.setRead(item.id, true);
    await service.refresh(id);
    state = service.getState({});
    assert.equal(state.total, 2);
    assert.equal(state.sources[0].lastAdded, 0);
    assert.equal(state.sources[0].unreadCount, 1);
    assert.equal(service.getState({ unreadOnly: true }).total, 1);
    assert.equal(service.getState({ keyword: "LANGUAGE" }).total, 2);
    assert.equal(service.itemURL(item.id), item.url);
    assert.throws(() => service.getState({ offset: -1 }));
    workspace.database.close();
    const reopened = openWorkspace(folder);
    try {
        const restored = new FeedService(reopened.db, async () => entries);
        assert.equal(restored.getState({}).items.find(saved => saved.id === item.id).isRead, true);
        await restored.saveSource({ id, name: "Renamed", url: "https://rss.arxiv.org/atom/cs.AI" });
        assert.equal(restored.getState({}).sources[0].name, "Renamed");
        restored.removeSource(id);
        assert.equal(restored.getState({}).total, 0);
    }
    finally {
        reopened.database.close();
    }
});

test("failed refresh preserves saved data and does not block other sources", async () => {
    const database = memoryDatabase();
    database.pragma("foreign_keys = ON");
    let failing = false;
    const entries = await parseFeed(rss, "https://example.org/feed");
    const service = new FeedService(createWorkspaceDatabase(database), async url => {
        if (failing && url.endsWith("/bad")) throw new Error("Network unavailable");
        return entries;
    });
    try {
        const bad = await service.saveSource({ name: "A", url: "https://example.org/bad" });
        await service.saveSource({ name: "B", url: "https://example.org/good" });
        failing = true;
        await service.refresh();
        const state = service.getState({});
        assert.equal(state.total, 2);
        assert.equal(state.sources[0].error, "Network unavailable");
        assert.equal(state.sources[1].error, null);
        assert.ok(state.sources[0].lastRefreshed);
        await assert.rejects(service.saveSource({ id: bad, name: "Broken edit", url: "https://other.example/bad" }));
        assert.equal(service.getState({}).sources[0].name, "A");
        await assert.rejects(service.saveSource({ name: "Duplicate", url: "https://example.org/good" }), /已经添加/);
    }
    finally {
        database.close();
    }
});

test("concurrent refreshes share a request and results are paginated", async () => {
    const database = memoryDatabase();
    const [entry] = await parseFeed(rss, "https://example.org/feed");
    let calls = 0;
    const service = new FeedService(createWorkspaceDatabase(database), async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return Array.from({ length: 55 }, (_, i) => ({ ...entry, externalId: `paper-${i}` }));
    });
    try {
        const id = await service.saveSource({ name: "Research", url: "https://example.org/feed" });
        await Promise.all([service.refresh(id), service.refresh(id)]);
        assert.equal(calls, 2);
        assert.equal(service.getState({}).items.length, 50);
        assert.equal(service.getState({ offset: 50 }).items.length, 5);
        assert.equal(service.getState({}).total, 55);
    }
    finally {
        database.close();
    }
});