import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { runInNewContext } from "node:vm";
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
const program = ts.createProgram(["main/feed/ipc.ts", "main/feed/pdf.ts", "main/storage/workspace.ts"].map(file => join(root, file)), {
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
const { importFeedPDF } = require(join(output, "main/feed/pdf.js"));
const { parseFeed, parseJSONFeed, fetchFeed, discoverFeeds, retryAfter, FeedError } = require(join(output, "main/feed/parser.js"));
const { arxivURL, feedURL, normalizeURL } = require(join(output, "shared/utils/feed.js"));
const { createWorkspace, openWorkspace } = require(join(output, "main/storage/workspace.js"));
const { createWorkspaceDatabase } = require(join(output, "main/storage/database.js"));
const { createWorkspaceSchema } = require(join(output, "main/storage/schema.js"));

function memoryDatabase() {
    const database = new Database(":memory:");
    database.pragma("foreign_keys = ON");
    createWorkspaceSchema(database);
    database.exec("INSERT INTO workspace_meta (id, name, created_at, last_modified_at) VALUES ('workspace', 'Fixture', 0, 0)");
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

/** A FeedService over a fresh in-memory workspace, with a controllable clock. */
function fixture(t, load, library) {
    const database = memoryDatabase();
    t.after(() => database.close());
    const clock = { now: Date.UTC(2026, 10, 1) };
    const service = new FeedService(createWorkspaceDatabase(database), load, library, () => clock.now);
    return { database, service, clock };
}

/** The result a loader returns for these entries. */
function fetched(entries, extra = {}) {
    return { entries, title: "", url: "", etag: null, lastModified: null, ...extra };
}

function loaderOf(entries) {
    return async request => fetched(typeof entries === "function" ? await entries(request) : entries, { url: request.url });
}

function entry(values) {
    return { externalId: null, title: "Untitled", url: null, pdfURL: null, authors: "", summary: "", content: "", fullContent: false, publishedAt: null, ...values };
}

const minute = 60000;

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

test("article addresses compare equal across scheme, tracking parameters, fragments and trailing slashes", () => {
    const key = normalizeURL("https://example.org/posts/1?b=2&a=1");
    for (const variant of [
        "http://example.org/posts/1/?a=1&b=2",
        "https://example.org:443/posts/1?a=1&b=2&utm_source=rss&utm_medium=feed#comments",
        "https://EXAMPLE.org/posts/1?fbclid=x&b=2&a=1"
    ]) assert.equal(normalizeURL(variant), key);
    assert.notEqual(normalizeURL("https://example.org/posts/2?a=1&b=2"), key);
    assert.notEqual(normalizeURL("https://example.org/posts/1?a=1&b=3"), key);
    assert.equal(normalizeURL("https://example.org/"), "https://example.org/");
    for (const invalid of [null, "", "not a url", "javascript:alert(1)", "ftp://example.org/file"]) assert.equal(normalizeURL(invalid), null);
});

test("RSS and Atom retain identities, all authors, summaries and safe links", async () => {
    const { title, entries: [item] } = await parseFeed(rss, "https://example.org/feed.xml");
    assert.equal(title, "Research");
    assert.equal(item.externalId, "paper-1-v1");
    assert.equal(item.url, "https://example.org/papers/1");
    assert.equal(item.summary, "Tool use & evaluation.");
    assert.equal(item.authors, "Alice");
    assert.equal(item.publishedAt, Date.UTC(2026, 9, 7, 10));
    const { entries } = await parseFeed(atom, "https://rss.arxiv.org/atom/cs.AI");
    assert.equal(entries[0].title, "Language models");
    assert.equal(entries[0].authors, "Alice, Bob");
    assert.equal(entries[0].summary, "A & B");
    assert.notEqual(entries[0].externalId, entries[1].externalId);
    assert.equal(entries[1].url, null);
    assert.equal(entries[1].publishedAt, null);
    const { entries: [announcement] } = await parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <entry><id>oai:arXiv.org:2610.00001v1</id><title>Daily announcement</title>
        <dc:creator>Alice</dc:creator><dc:creator>Bob</dc:creator><summary>Research update.</summary></entry></feed>`, "https://rss.arxiv.org/atom/cs.AI");
    assert.equal(announcement.authors, "Alice, Bob");
    assert.equal(announcement.externalId, "oai:arXiv.org:2610.00001v1");
});

test("articles keep their markup, excerpts are told apart from full text, and missing fields are filled", async () => {
    const { entries: [full, excerpt, bare] } = await parseFeed(`<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel><title> Lab   notes </title>
        <item><guid>full</guid><title>Full</title><description>Short teaser.</description>
            <content:encoded><![CDATA[<h2>Method</h2><p>Body with <a href="/more">a link</a> and <img src="/figure.png" alt="Figure 1"></p><script>alert(1)</script>]]></content:encoded></item>
        <item><guid>excerpt</guid><title>Excerpt</title><description><![CDATA[<p>Only an <b>excerpt</b>.</p>]]></description></item>
        <item><description>A note that was published without any title or identifier at all, long enough to be cut where the list would cut it.</description></item>
        </channel></rss>`, "https://example.org/feed");
    assert.equal(full.fullContent, true);
    assert.match(full.content, /<h2>Method<\/h2>/);
    // The markup is saved as received; scripts are removed when it is displayed.
    assert.match(full.content, /<script>/);
    assert.equal(full.summary, "Short teaser.");
    assert.equal(excerpt.fullContent, false);
    assert.equal(excerpt.content, "<p>Only an <b>excerpt</b>.</p>");
    assert.equal(excerpt.summary, "Only an excerpt.");
    assert.equal(bare.externalId, null);
    assert.equal(bare.content, "");
    assert.equal(bare.title, "A note that was published without any title or identifier at all, long enough to…");
    const { entries: [article, brief] } = await parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom">
        <entry><id>a</id><title>Article</title><summary>The abstract.</summary><content type="html">&lt;p&gt;The whole &lt;em&gt;article&lt;/em&gt;.&lt;/p&gt;</content></entry>
        <entry><id>b</id><title>Brief</title><summary type="html">&lt;p&gt;Just the abstract.&lt;/p&gt;</summary></entry></feed>`, "https://example.org/atom");
    assert.equal(article.fullContent, true);
    assert.equal(article.content, "<p>The whole <em>article</em>.</p>");
    assert.equal(article.summary, "The abstract.");
    assert.equal(brief.fullContent, false);
    assert.equal(brief.summary, "Just the abstract.");
});

test("JSON Feed items are read with their identifiers, authors, content and external links", () => {
    const { title, entries } = parseJSONFeed(JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        title: "Notes",
        items: [
            { id: 42, url: "/posts/42", title: "First", content_html: "<p>Hello <b>there</b></p>", date_published: "2026-10-07T10:00:00Z", authors: [{ name: "Alice" }, { name: "Bob" }] },
            { id: "link", external_url: "https://other.example/page", content_text: "Plain words.", author: { name: "Carol" } },
            { url: "javascript:alert(1)", summary: "Only a summary." },
            null
        ]
    }), "https://example.org/feed.json");
    assert.equal(title, "Notes");
    assert.equal(entries.length, 3);
    assert.deepEqual(entries[0], {
        externalId: "42", title: "First", url: "https://example.org/posts/42", pdfURL: null, authors: "Alice, Bob", summary: "Hello there",
        content: "<p>Hello <b>there</b></p>", fullContent: true, publishedAt: Date.UTC(2026, 9, 7, 10)
    });
    assert.equal(entries[1].url, "https://other.example/page");
    assert.equal(entries[1].authors, "Carol");
    assert.equal(entries[1].title, "Plain words.");
    assert.equal(entries[1].fullContent, true);
    assert.deepEqual([entries[2].externalId, entries[2].url, entries[2].fullContent], [null, null, false]);
    assert.throws(() => parseJSONFeed("{\"items\":[]}", "https://example.org"), /订阅格式/);
    assert.throws(() => parseJSONFeed("{", "https://example.org"), /JSON Feed/);
});

test("invalid feeds and arXiv error responses fail without creating entries", async () => {
    await assert.rejects(parseFeed("<html>not a feed</html>", "https://example.org"), /不是有效的 RSS 或 Atom/);
    await assert.rejects(parseFeed("<!DOCTYPE rss [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><rss/>", "https://example.org"));
    await assert.rejects(parseFeed("<feed xmlns=\"http://www.w3.org/2005/Atom\"><entry><id>http://arxiv.org/api/errors#incorrect_id_format</id><summary>Invalid query</summary></entry></feed>", "https://export.arxiv.org"), /Invalid query/);
    assert.deepEqual((await parseFeed("<feed xmlns=\"http://www.w3.org/2005/Atom\"><title>Empty</title></feed>", "https://example.org")).entries, []);
});

test("a document type is rejected before the root element and accepted as article content", async () => {
    await assert.rejects(parseFeed("<?xml version=\"1.0\"?>\n<!-- header -->\n<!doctype rss SYSTEM \"feed.dtd\"><rss version=\"2.0\"><channel/></rss>", "https://example.org"), /XML 声明/);
    // Some sites publish each post as a whole HTML document.
    const { entries: [post] } = await parseFeed(`<?xml version="1.0"?><!-- not a <!DOCTYPE declaration -->
        <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Blog</title>
        <item><guid>1</guid><title>Post</title><description>Teaser</description>
        <content:encoded><![CDATA[<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN"><html><body><p>Hello &lt;!ENTITY&gt; world.</p></body></html>]]></content:encoded>
        </item></channel></rss>`, "https://example.org/feed");
    assert.equal(post.fullContent, true);
    assert.match(post.content, /^<!DOCTYPE html/);
    assert.equal(post.summary, "Teaser");
});

test("fetching classifies HTTP and network failures and rejects oversized responses", async () => {
    const { entries } = await fetchFeed({ url: "https://example.org/feed" }, async () => new Response(rss));
    assert.equal(entries.length, 1);
    const failure = async respond => fetchFeed({ url: "https://example.org/feed" }, respond).then(() => assert.fail("expected a failure"), error => error);
    const limited = await failure(async () => new Response("limited", { status: 429, headers: { "Retry-After": "120" } }));
    assert.ok(limited instanceof FeedError);
    assert.match(limited.message, /频繁/);
    assert.deepEqual([limited.retryable, limited.retryAfter], [true, 120000]);
    const down = await failure(async () => new Response("", { status: 503 }));
    assert.deepEqual([down.retryable, down.retryAfter], [true, undefined]);
    for (const status of [401, 403, 404, 410]) assert.equal((await failure(async () => new Response("", { status }))).retryable, false);
    const offline = await failure(async () => {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND example.org"), { code: "ENOTFOUND" }) });
    });
    assert.deepEqual([offline.retryable, /无法连接/.test(offline.message)], [true, true]);
    const certificate = await failure(async () => {
        throw new Error("net::ERR_CERT_AUTHORITY_INVALID");
    });
    assert.deepEqual([certificate.retryable, /证书/.test(certificate.message)], [false, true]);
    const slow = await failure(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
    });
    assert.deepEqual([slow.retryable, /超时/.test(slow.message)], [true, true]);
    const unreachable = await failure(async () => {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("Connect Timeout Error (timeout: 10000ms)"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
    });
    assert.deepEqual([unreachable.retryable, /超时/.test(unreachable.message)], [true, true]);
    assert.ok(unreachable.cause instanceof TypeError, "the underlying error is kept for the log");
    // A TLS failure that is not about the certificate may pass, so it is retried.
    const handshake = await failure(async () => {
        throw new Error("net::ERR_SSL_PROTOCOL_ERROR");
    });
    assert.deepEqual([handshake.retryable, /无法连接/.test(handshake.message)], [true, true]);
    const large = await failure(async () => new Response("x".repeat(10 * 1024 * 1024 + 1)));
    assert.match(large.message, /10 MB/);
    assert.equal(large.retryable, false);
    assert.equal(retryAfter("30"), 30000);
    assert.equal(retryAfter("Wed, 07 Oct 2026 10:01:00 GMT", Date.UTC(2026, 9, 7, 10)), 60000);
    assert.equal(retryAfter("Wed, 07 Oct 2026 09:00:00 GMT", Date.UTC(2026, 9, 7, 10)), 0);
    assert.equal(retryAfter("999999999"), 24 * 60 * 60 * 1000);
    for (const unusable of [null, "", "soon"]) assert.equal(retryAfter(unusable), undefined);
});

test("validators are replayed verbatim and an unchanged source is not parsed again", async () => {
    const seen = [];
    const fetcher = async (_url, init) => {
        seen.push(init.headers);
        return init.headers["If-None-Match"] === "W/\"v1\""
            ? new Response(null, { status: 304 })
            : new Response(rss, { headers: { ETag: "W/\"v1\"", "Last-Modified": "Wed, 07 Oct 2026 10:00:00 GMT" } });
    };
    const first = await fetchFeed({ url: "https://example.org/feed" }, fetcher);
    assert.deepEqual([first.etag, first.lastModified, first.entries.length], ["W/\"v1\"", "Wed, 07 Oct 2026 10:00:00 GMT", 1]);
    assert.equal(seen[0]["If-None-Match"], undefined);
    assert.equal(seen[0]["If-Modified-Since"], undefined);
    const second = await fetchFeed({ url: "https://example.org/feed", etag: first.etag, lastModified: first.lastModified }, fetcher);
    assert.equal(seen[1]["If-None-Match"], "W/\"v1\"");
    assert.equal(seen[1]["If-Modified-Since"], "Wed, 07 Oct 2026 10:00:00 GMT");
    assert.equal(second.entries, null);
    // A 304 without validators of its own keeps the ones that were sent.
    assert.deepEqual([second.etag, second.lastModified], [first.etag, first.lastModified]);
});

test("feeds are decoded with the encoding they declare", async () => {
    const text = "<rss version=\"2.0\"><channel><title>研究动态</title><item><guid>1</guid><title>大语言模型综述</title></item></channel></rss>";
    const gbk = Buffer.concat([Buffer.from("<?xml version=\"1.0\" encoding=\"GBK\"?>", "latin1"),
        // "研究动态" and "大语言模型综述" in GBK.
        Buffer.from("<rss version=\"2.0\"><channel><title>", "latin1"), Buffer.from("d1d0bebfb6afccac", "hex"),
        Buffer.from("</title><item><guid>1</guid><title>", "latin1"), Buffer.from("b4f3d3efd1d4c4a3d0cdd7dbcaf6", "hex"),
        Buffer.from("</title></item></channel></rss>", "latin1")]);
    const declared = await fetchFeed({ url: "https://example.org/gbk" }, async () => new Response(gbk, { headers: { "Content-Type": "text/xml" } }));
    assert.deepEqual([declared.title, declared.entries[0].title], ["研究动态", "大语言模型综述"]);
    const header = await fetchFeed({ url: "https://example.org/header" }, async () => new Response(gbk.subarray(36), { headers: { "Content-Type": "text/xml; charset=gb2312" } }));
    assert.equal(header.entries[0].title, "大语言模型综述");
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    assert.equal((await fetchFeed({ url: "https://example.org/utf16" }, async () => new Response(utf16))).entries[0].title, "大语言模型综述");
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
    assert.equal((await fetchFeed({ url: "https://example.org/bom" }, async () => new Response(bom))).title, "研究动态");
    // An unknown label falls back to UTF-8 instead of failing the source.
    const unknown = await fetchFeed({ url: "https://example.org/odd" }, async () => new Response(`<?xml version="1.0" encoding="x-unknown"?>${text}`));
    assert.equal(unknown.title, "研究动态");
});

test("a web page leads to the feed it advertises only while a source is being saved", async () => {
    const page = `<!doctype html><html><head><title>Lab</title>
        <link rel="stylesheet" href="/site.css">
        <link rel="alternate" type="text/html" href="/print">
        <link href='/feeds/all.atom?x=1&amp;y=2' type='application/atom+xml' rel='alternate'>
        <link rel="alternate" type="application/rss+xml" href="javascript:alert(1)">
        <LINK REL="Alternate" TYPE="application/rss+xml" HREF="https://feeds.example.net/lab.xml">
        </head><body>Welcome</body></html>`;
    assert.deepEqual(discoverFeeds(page, "https://lab.example/blog/"), ["https://lab.example/feeds/all.atom?x=1&y=2", "https://feeds.example.net/lab.xml"]);
    const requested = [];
    const fetcher = async url => {
        requested.push(url);
        return url.endsWith(".atom?x=1&y=2") ? new Response(atom, { headers: { ETag: "\"feed\"" } }) : new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    };
    const found = await fetchFeed({ url: "https://lab.example/blog/", discover: true }, fetcher);
    assert.deepEqual(requested, ["https://lab.example/blog/", "https://lab.example/feeds/all.atom?x=1&y=2"]);
    assert.equal(found.url, "https://lab.example/feeds/all.atom?x=1&y=2");
    assert.deepEqual([found.title, found.etag, found.entries.length], ["arXiv", "\"feed\"", 2]);
    await assert.rejects(fetchFeed({ url: "https://lab.example/blog/" }, fetcher), /网页/);
    await assert.rejects(fetchFeed({ url: "https://lab.example/", discover: true }, async () => new Response("<!doctype html><html><body>No feeds</body></html>")), /没有提供/);
});

test("blog feeds import the latest ten unique entries and retain older saved articles", async t => {
    let latest = 12;
    const load = request => fetchFeed(request, async () => {
        const items = Array.from({ length: latest }, (_, i) => `<item><guid>blog-${i + 1}</guid><title>Post ${i + 1}</title>
            <pubDate>${new Date(Date.UTC(2026, 9, i + 1)).toUTCString()}</pubDate></item>`);
        return new Response(`<rss version="2.0"><channel><title>Blog</title>${items.join("")}${items.at(-1)}
            <item><guid>undated</guid><title>No date</title></item></channel></rss>`);
    });
    const { service } = fixture(t, load);
    const { entries } = await load({ url: "https://openai.com/news/rss.xml" });
    assert.equal(entries.length, 10);
    assert.equal(entries[0].externalId, "blog-12");
    assert.equal(entries.at(-1).externalId, "blog-3");
    // Without a name, the source takes the feed's own title.
    const id = await service.saveSource({ name: "  ", url: "https://openai.com/news/rss.xml" });
    assert.equal(service.getState({}).sources[0].name, "Blog");
    const oldest = service.getState({}).items.at(-1);
    service.setRead(oldest.id, true);
    latest = 13;
    await service.refresh(id);
    const state = service.getState({});
    assert.equal(state.total, 11);
    assert.equal(state.sources[0].lastAdded, 1);
    assert.equal(state.items.find(item => item.id === oldest.id).isRead, true);
});

test("Anthropic pages provide the section's own articles with safe links, summaries and dates across data chunks", async () => {
    for (const section of ["news", "engineering"]) {
        const kind = section === "news" ? "news" : "research";
        const article = (slug, date, extra = {}) => ({
            _type: "article", _id: `article-${slug}`, title: `  Article\n ${slug}  `, slug: { _type: "slug", current: slug }, articleType: kind, publishedOn: date, ...extra
        });
        const category = section === "news" ? "Announcements" : "Engineering";
        const cards = Array.from({ length: 12 }, (_, i) => article(`post-${i + 1}`, `2026-10-${String(i + 1).padStart(2, "0")}`, { category }));
        const data = `1:I["module"]\n2:T3,abc3:${JSON.stringify(["$", "component", null, { sections: [
            // The page's own list repeats an article in full, without the category its card carries.
            { items: [
                article("post-12", "2026-10-12", { summary: "A summary with \"quotes\", ] brackets and 中文。", linkedUrl: null }),
                article("moved", "2026-10-13", { title: "Latest announcement", linkedUrl: "/announcement", seoDescription: "Featured summary.", category }),
                article("unsafe", "2026-10-14", { title: "Unsafe link", linkedUrl: "javascript:alert(1)", category }),
                article("linked-only", "2026-10-17"),
                { _type: "article", title: "No address", slug: null, articleType: kind, publishedOn: "2026-10-16", category }
            ] },
            { cards: [...cards, article("../invalid", "2026-10-15", { category })] },
            // The site's menus list articles that belong to other pages.
            { menu: [
                { ...article("other-kind", "2026-10-20", { category: "Science" }), articleType: section === "news" ? "research" : "news" },
                { ...article("other-research", "2026-10-21", { category: "Alignment" }), articleType: "research" },
                { ...article("unlisted-research", "2026-10-22"), articleType: "research" },
                { _type: "video", title: "Not an article", slug: { current: "video" }, publishedOn: "2026-10-23" }
            ] }
        ] }])}\n`;
        const split = Math.floor(data.length / 2);
        const html = `<!DOCTYPE html><html><a href="/research/linked-only">Read</a><a href="/research/team/unlisted-research">Team</a>${[data.slice(0, split), data.slice(split)].map(chunk =>
            `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`).join("")}</html>`;
        const url = `https://www.anthropic.com/${section}/`;
        const { entries } = await fetchFeed({ url }, async (_url, init) => {
            assert.equal(init.headers.Accept, "text/html");
            return new Response(html);
        });
        assert.deepEqual(entries.map(entry => entry.title), [
            "Article linked-only", "Latest announcement", ...Array.from({ length: 8 }, (_, i) => `Article post-${12 - i}`)
        ], "the ten newest articles of this page, without menu entries, unsafe links or articles that have no address");
        // Articles are addressed by kind: engineering posts are published under /research.
        assert.equal(entries[0].url, `https://www.anthropic.com/${kind}/linked-only`);
        assert.deepEqual([entries[1].url, entries[1].summary, entries[1].publishedAt], ["https://www.anthropic.com/announcement", "Featured summary.", Date.UTC(2026, 9, 13)]);
        const repeated = entries[2];
        assert.equal(repeated.summary, "A summary with \"quotes\", ] brackets and 中文。", "fields of a repeated article are combined");
        // Identifiers keep their earlier, section-based form so saved items are recognised.
        assert.deepEqual(entries.map(entry => entry.externalId).slice(0, 3), ["linked-only", "moved", "post-12"].map(slug => `https://www.anthropic.com/${section}/${slug}`));
        assert.equal(new Set(entries.map(entry => entry.externalId)).size, 10);
        assert.ok(entries.every(entry => entry.content === "" && entry.fullContent === false));
    }
    await assert.rejects(fetchFeed({ url: "https://www.anthropic.com/news" }, async () => new Response("<!DOCTYPE html><h1>Unavailable</h1>")), /未找到 Anthropic 文章/);
    await assert.rejects(fetchFeed({ url: "https://www.anthropic.com/news/article" }, async () => new Response("<!DOCTYPE html><h1>Article</h1>")), /网页/);
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
        fetchFeed({ url: "https://rss.arxiv.org/atom/cs.AI" }, fetcher),
        fetchFeed({ url: "https://export.arxiv.org/api/query?search_query=cat:cs.LG" }, fetcher)
    ]);
    assert.ok(calls[1] - calls[0] >= 3000);
});

test("entries and read state survive refreshes and reopening the workspace; cancelling keeps the history", async () => {
    const folder = mkdtempSync(join(output, "workspace-"));
    const workspace = createWorkspace(folder);
    const { entries } = await parseFeed(atom, "https://rss.arxiv.org/atom/cs.AI");
    const service = new FeedService(workspace.db, loaderOf(entries));
    const id = await service.saveSource({ name: "arXiv", url: "https://rss.arxiv.org/atom/cs.AI" });
    let state = service.getState({ sourceId: id });
    assert.equal(state.total, 2);
    assert.equal(state.sources[0].lastAdded, 2);
    const item = state.items.find(item => item.url);
    service.setRead(item.id, true);
    service.setPosition(item.id, 0.5);
    service.setKeywords(["language"]);
    await service.refresh(id);
    state = service.getState({});
    assert.equal(state.total, 2);
    assert.equal(state.sources[0].lastAdded, 0);
    assert.equal(state.sources[0].unreadCount, 1);
    assert.equal(state.unreadCount, 1);
    assert.equal(service.getState({ read: "unread" }).total, 1);
    assert.equal(service.getState({ keyword: "LANGUAGE" }).total, 2);
    assert.equal(service.itemURL(item.id), item.url);
    assert.throws(() => service.getState({ offset: -1 }));
    assert.throws(() => service.getState({ read: "some" }));
    workspace.database.close();
    const reopened = openWorkspace(folder);
    try {
        const restored = new FeedService(reopened.db, loaderOf(entries));
        const saved = restored.getItem(item.id);
        assert.deepEqual([saved.isRead, saved.readingPosition, saved.paperState], [true, { progress: 0.5 }, "none"]);
        assert.deepEqual(restored.getState({}).keywords, ["language"]);
        await restored.saveSource({ id, name: "Renamed", url: "https://rss.arxiv.org/atom/cs.AI" });
        assert.equal(restored.getState({}).sources[0].name, "Renamed");
        restored.setSourceStatus(id, "cancel");
        state = restored.getState({});
        assert.deepEqual([state.total, state.unreadCount, state.sources[0].status], [0, 0, "cancelled"]);
        // The history stays readable under the cancelled subscription, with its read state.
        const history = restored.getState({ sourceId: id });
        assert.equal(history.total, 2);
        assert.equal(history.items.find(saved => saved.id === item.id).isRead, true);
        await assert.rejects(restored.refresh(id), /已取消/);
        await assert.rejects(restored.saveSource({ id, name: "Edited", url: "https://rss.arxiv.org/atom/cs.AI" }), /已取消/);
        // Subscribing to the same address again continues the same subscription.
        assert.equal(await restored.saveSource({ name: "Again", url: "https://rss.arxiv.org/atom/cs.AI" }), id);
        state = restored.getState({});
        assert.deepEqual([state.sources.length, state.sources[0].status, state.sources[0].name, state.total], [1, "enabled", "Again", 2]);
        assert.equal(state.items.find(saved => saved.id === item.id).isRead, true);
    }
    finally {
        reopened.database.close();
    }
});

test("failed refresh preserves saved data and does not block other sources", async t => {
    let failing = false;
    const { entries } = await parseFeed(rss, "https://example.org/feed");
    const { service } = fixture(t, async request => {
        if (failing && request.url.endsWith("/bad")) throw new Error("Network unavailable");
        return fetched(entries, { url: request.url });
    });
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
    assert.equal(service.getState({}).sources[0].url, "https://example.org/bad");
    await assert.rejects(service.saveSource({ name: "Duplicate", url: "https://example.org/good" }), /已经添加/);
    await assert.rejects(service.saveSource({ id: bad, name: "A", url: "https://example.org/good" }), /已经添加/);
});

test("temporary failures retry after 30 seconds, 2 minutes and 10 minutes, then wait for the interval", async t => {
    let outcome = "ok";
    let calls = 0;
    const { service, clock } = fixture(t, async request => {
        calls++;
        if (outcome === "down") throw new FeedError("来源暂时不可用", true);
        if (outcome === "limited") throw new FeedError("来源请求过于频繁", true, 45 * minute);
        if (outcome === "gone") throw new FeedError("订阅地址不存在", false);
        if (outcome === "broken") throw new Error("页面结构可能已变化");
        return fetched([entry({ externalId: "1", title: "One" })], { url: request.url });
    });
    const id = await service.saveSource({ name: "Flaky", url: "https://example.org/feed", intervalMinutes: 120 });
    const source = () => service.getState({}).sources[0];
    const start = clock.now;
    assert.deepEqual([source().nextRefresh, source().lastRefreshed, source().lastChecked], [start + 120 * minute, start, start]);
    await service.refreshDue();
    assert.equal(calls, 1, "a source is not fetched before it is due");

    outcome = "down";
    const logged = [], warn = console.warn;
    console.warn = (...args) => logged.push(args);
    t.after(() => console.warn = warn);
    const waits = [];
    for (let attempt = 0; attempt < 5; attempt++) {
        clock.now = source().nextRefresh;
        await service.refreshDue();
        waits.push(source().nextRefresh - clock.now);
    }
    assert.deepEqual(waits, [30000, 2 * minute, 10 * minute, 120 * minute, 120 * minute]);
    console.warn = warn;
    assert.equal(logged.length, 0, "failures without an underlying cause are not logged");
    assert.deepEqual([source().error, source().lastRefreshed, source().lastAdded], ["来源暂时不可用", start, 0]);
    assert.equal(source().lastChecked, clock.now);
    assert.equal(service.getState({}).total, 1, "a failure keeps what was fetched before");

    // The source's own Retry-After outlasts a shorter local delay, and a success starts over.
    outcome = "ok";
    clock.now = source().nextRefresh;
    await service.refreshDue();
    assert.deepEqual([source().error, source().nextRefresh - clock.now], [null, 120 * minute]);
    outcome = "limited";
    clock.now = source().nextRefresh;
    await service.refreshDue();
    assert.equal(source().nextRefresh - clock.now, 45 * minute);

    // Errors that will not fix themselves are not retried early.
    outcome = "ok";
    await service.refresh(id);
    outcome = "gone";
    clock.now = source().nextRefresh;
    await service.refreshDue();
    assert.equal(source().nextRefresh - clock.now, 120 * minute);
    assert.equal(source().error, "订阅地址不存在");

    // Neither is an error from outside the fetch layer, such as a page whose structure changed.
    outcome = "ok";
    await service.refresh(id);
    outcome = "broken";
    clock.now = source().nextRefresh;
    await service.refreshDue();
    assert.deepEqual([source().error, source().nextRefresh - clock.now], ["页面结构可能已变化", 120 * minute]);
});

test("only sources that are due, enabled and automatic are refreshed in the background", async t => {
    const requested = [];
    const { service, clock } = fixture(t, async request => {
        requested.push(new URL(request.url).pathname);
        return fetched([entry({ externalId: request.url, title: request.url })], { url: request.url });
    });
    const quick = await service.saveSource({ name: "Quick", url: "https://example.org/quick", intervalMinutes: 15 });
    const hourly = await service.saveSource({ name: "Hourly", url: "https://example.org/hourly" });
    const manual = await service.saveSource({ name: "Manual", url: "https://example.org/manual", autoRefresh: false });
    const paused = await service.saveSource({ name: "Paused", url: "https://example.org/paused", intervalMinutes: 15 });
    const dropped = await service.saveSource({ name: "Dropped", url: "https://example.org/dropped", intervalMinutes: 15 });
    service.setSourceStatus(paused, "pause");
    service.setSourceStatus(dropped, "cancel");
    const byId = id => service.getState({}).sources.find(source => source.id === id);
    assert.deepEqual([byId(hourly).intervalMinutes, byId(hourly).autoRefresh, byId(manual).autoRefresh], [60, true, false]);
    requested.length = 0;

    clock.now += 14 * minute;
    await service.refreshDue();
    assert.deepEqual(requested, []);
    clock.now += minute;
    await service.refreshDue();
    assert.deepEqual(requested, ["/quick"]);
    clock.now += 45 * minute;
    await service.refreshDue();
    assert.deepEqual(requested.sort(), ["/hourly", "/quick", "/quick"]);

    // A manual refresh covers every enabled source and leaves paused and cancelled ones alone.
    requested.length = 0;
    await service.refresh();
    assert.deepEqual(requested.sort(), ["/hourly", "/manual", "/quick"]);
    await assert.rejects(service.refresh(paused), /已暂停/);

    // Resuming makes a source due at once, so what it missed is fetched on the next check.
    requested.length = 0;
    service.setSourceStatus(paused, "resume");
    assert.deepEqual([byId(paused).status, byId(paused).nextRefresh], ["enabled", null]);
    await service.refreshDue();
    assert.deepEqual(requested, ["/paused"]);

    // A shorter interval takes effect from the last check, not from the next success.
    requested.length = 0;
    await service.saveSource({ id: hourly, name: "Hourly", url: "https://example.org/hourly", intervalMinutes: 30 });
    assert.equal(byId(hourly).nextRefresh, byId(hourly).lastChecked + 30 * minute);
    await assert.rejects(service.saveSource({ id: hourly, name: "Hourly", url: "https://example.org/hourly", intervalMinutes: 5 }), /15 至 1440/);
    assert.deepEqual(requested, [], "changing settings does not fetch again");
});

test("stored validators make refreshes conditional, and an unchanged source keeps its items and schedule", async t => {
    const requests = [];
    let changed = true;
    const { service, clock } = fixture(t, async request => {
        requests.push({ etag: request.etag ?? null, lastModified: request.lastModified ?? null, discover: request.discover ?? false });
        return changed
            ? fetched([entry({ externalId: "1", title: "One" })], { url: request.url, etag: "\"v1\"", lastModified: "Wed, 07 Oct 2026 10:00:00 GMT" })
            : fetched(null, { url: request.url, etag: request.etag, lastModified: request.lastModified });
    });
    const id = await service.saveSource({ name: "Cached", url: "https://example.org/feed" });
    assert.deepEqual(requests[0], { etag: null, lastModified: null, discover: true });
    const [item] = service.getState({}).items;
    service.setRead(item.id, true);
    changed = false;
    clock.now += 60 * minute;
    await service.refreshDue();
    assert.deepEqual(requests[1], { etag: "\"v1\"", lastModified: "Wed, 07 Oct 2026 10:00:00 GMT", discover: false });
    const state = service.getState({});
    const [source] = state.sources;
    assert.deepEqual([state.total, state.items[0].isRead, source.lastAdded, source.error], [1, true, 0, null]);
    assert.deepEqual([source.lastRefreshed, source.nextRefresh], [clock.now, clock.now + 60 * minute]);
    // Changing the address starts over without the old address's validators.
    changed = true;
    await service.saveSource({ id, name: "Cached", url: "https://example.org/moved" });
    assert.deepEqual(requests[2], { etag: null, lastModified: null, discover: true });
});

test("a result that arrives after its source was paused, cancelled or readdressed is discarded", async t => {
    let release;
    let slow = false;
    const { service } = fixture(t, async request => {
        if (slow) await new Promise(resolve => release = resolve);
        return fetched([entry({ externalId: `${request.url}#${slow ? "late" : "first"}`, title: "Entry" })], { url: request.url });
    });
    const id = await service.saveSource({ name: "Slow", url: "https://example.org/a" });
    for (const interrupt of [
        () => service.setSourceStatus(id, "pause"),
        () => service.setSourceStatus(id, "cancel")
    ]) {
        slow = true;
        const refresh = service.refresh(id);
        assert.equal(service.getState({ sourceId: id }).sources[0].refreshing, true);
        interrupt();
        release();
        await refresh;
        const state = service.getState({ sourceId: id });
        assert.deepEqual([state.total, state.sources[0].refreshing, state.sources[0].error], [1, false, null]);
        slow = false;
        service.setSourceStatus(id, "resume");
    }
});

test("concurrent refreshes share a request and results are paginated", async t => {
    const { entries: [template] } = await parseFeed(rss, "https://example.org/feed");
    let calls = 0;
    const { service } = fixture(t, async request => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return fetched(Array.from({ length: 55 }, (_, i) => ({ ...template, externalId: `paper-${i}`, url: `https://example.org/papers/${i}` })), { url: request.url });
    });
    let notices = 0;
    service.onChanged = () => notices++;
    const id = await service.saveSource({ name: "Research", url: "https://example.org/feed" });
    notices = 0;
    await Promise.all([service.refresh(id), service.refresh(id)]);
    assert.equal(calls, 2);
    assert.ok(notices >= 2, "views are told when a refresh starts and when it ends");
    assert.equal(service.getState({}).items.length, 50);
    assert.equal(service.getState({ offset: 50 }).items.length, 5);
    assert.equal(service.getState({}).total, 55);
});

test("a few sources are fetched at a time, and those waiting their turn already count as refreshing", async t => {
    let holding = false, inFlight = 0, most = 0;
    const releases = [], started = [];
    const { service } = fixture(t, async request => {
        if (holding) {
            most = Math.max(most, ++inFlight);
            started.push(new URL(request.url).pathname);
            await new Promise(resolve => releases.push(resolve));
            inFlight--;
        }
        return fetched([entry({ externalId: request.url, title: request.url })], { url: request.url });
    });
    const ids = [];
    for (let i = 0; i < 7; i++) ids.push(await service.saveSource({ name: `Source ${i}`, url: `https://example.org/${i}` }));
    service.setSourceStatus(ids[6], "pause");
    service.setSourceStatus(ids[6], "resume");
    holding = true;
    const all = service.refresh();
    // A second request for one of them, and the automatic check, join the same queue.
    const again = service.refresh(ids[5]);
    const due = service.refreshDue();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.getState({}).sources.filter(source => source.refreshing).length, 7);
    assert.deepEqual([started.length, inFlight], [4, 4]);
    // A source paused while it waits is not fetched when its turn comes.
    service.setSourceStatus(ids[6], "pause");
    while (releases.length) {
        releases.shift()();
        await new Promise(resolve => setImmediate(resolve));
    }
    await Promise.all([all, again, due]);
    assert.equal(most, 4);
    assert.deepEqual(started.sort(), ["/0", "/1", "/2", "/3", "/4", "/5"], "each source was fetched once");
    assert.equal(service.getState({}).sources.filter(source => source.refreshing).length, 0);
    // The queue is free again afterwards.
    holding = false;
    await service.refresh(ids[0]);
    assert.equal(service.getState({}).sources.find(source => source.id === ids[0]).error, null);
});

test("a fetched entry updates the item already saved for it instead of adding another", async t => {
    let entries = [
        entry({ externalId: "guid-1", title: "Draft title", url: "https://example.org/a?utm_source=rss", summary: "Old summary.", publishedAt: Date.UTC(2026, 9, 1) }),
        entry({ title: "No identifier", url: "http://example.org/b/", publishedAt: Date.UTC(2026, 9, 2) }),
        entry({ title: "Neither identifier nor address", authors: "Dana", publishedAt: Date.UTC(2026, 9, 3) })
    ];
    const { service, database } = fixture(t, loaderOf(() => entries));
    const id = await service.saveSource({ name: "Lab", url: "https://example.org/feed" });
    const before = service.getState({ order: "oldest" }).items;
    assert.equal(before.length, 3);
    for (const item of before) {
        service.setRead(item.id, true);
        service.setPosition(item.id, 0.25);
    }
    entries = [
        // The source corrected the title and added the article text.
        entry({ externalId: "guid-1", title: "Final title", url: "https://example.org/a", summary: "New summary.", content: "<p>Body</p>", fullContent: true, publishedAt: Date.UTC(2026, 9, 5) }),
        // The source started sending an identifier for an entry first seen without one.
        entry({ externalId: "guid-2", title: "No identifier, renamed", url: "https://example.org/b?utm_campaign=x", publishedAt: Date.UTC(2026, 9, 2) }),
        entry({ title: "Neither identifier nor address", authors: "Dana", publishedAt: Date.UTC(2026, 9, 3), summary: "Now with a summary." })
    ];
    await service.refresh(id);
    const state = service.getState({ order: "oldest" });
    assert.deepEqual([state.total, state.sources[0].lastAdded, state.unreadCount], [3, 0, 0]);
    assert.deepEqual(state.items.map(item => item.id), before.map(item => item.id));
    assert.deepEqual(state.items.map(item => item.title), ["Final title", "No identifier, renamed", "Neither identifier nor address"]);
    const first = service.getItem(before[0].id);
    assert.deepEqual([first.summary, first.content, first.fullContent, first.url], ["New summary.", "<p>Body</p>", true, "https://example.org/a"]);
    // The date an item was first listed under does not move when the source edits it.
    assert.equal(first.publishedAt, Date.UTC(2026, 9, 1));
    assert.deepEqual(state.items.map(item => service.getItem(item.id).readingPosition), Array(3).fill({ progress: 0.25 }));
    assert.equal(service.getItem(before[2].id).summary, "Now with a summary.");
    const row = database.prepare("SELECT external_id, origin_snapshot FROM feed_items WHERE id = ?").get(before[1].id);
    assert.equal(row.external_id, "guid-2");
    assert.deepEqual(JSON.parse(row.origin_snapshot), { feedURL: "https://example.org/feed", externalId: null });

    // Different identifiers are different items, even at one address or with one title and date.
    entries = [
        entry({ externalId: "guid-3", title: "Final title", url: "https://example.org/a", publishedAt: Date.UTC(2026, 9, 1) }),
        entry({ title: "Weekly digest", url: "https://example.org/digest/1" }),
        entry({ title: "Weekly digest", url: "https://example.org/digest/2" })
    ];
    await service.refresh(id);
    assert.deepEqual([service.getState({}).total, service.getState({}).sources[0].lastAdded], [6, 3]);
    await service.refresh(id);
    assert.deepEqual([service.getState({}).total, service.getState({}).sources[0].lastAdded], [6, 0]);
});

test("items saved before identifiers became optional are recognised after the upgrade", async t => {
    const published = Date.UTC(2026, 9, 7, 10);
    const legacy = entry({ title: "Hashed", authors: "Eve", publishedAt: published });
    const { service, database } = fixture(t, loaderOf(() => [
        entry({ title: "Addressed", url: "https://example.org/x" }),
        legacy
    ]));
    database.exec("INSERT INTO feed_sources (id, name, url) VALUES ('source', 'Old', 'https://example.org/feed')");
    const insert = database.prepare("INSERT INTO feed_items (id, source_id, external_id, title, url, authors, summary, published_at, is_read) VALUES (?, 'source', ?, ?, ?, ?, '', ?, 1)");
    // Earlier versions saved the address, or a hash of title, authors and date, as the identifier.
    insert.run("by-url", "https://example.org/x", "Addressed", "https://example.org/x", "", null);
    const { createHash } = require("node:crypto");
    insert.run("by-hash", createHash("sha256").update(JSON.stringify(["Hashed", "Eve", new Date(published).toISOString()])).digest("hex"), "Hashed", null, "Eve", published);
    await service.refresh("source");
    const state = service.getState({});
    assert.deepEqual([state.total, state.sources[0].lastAdded, state.unreadCount], [2, 0, 0]);
    assert.deepEqual(state.items.map(item => item.id).sort(), ["by-hash", "by-url"]);
});

test("items are filtered by read state and followed keywords, ordered either way, and marked read by source", async t => {
    const day = n => Date.UTC(2026, 9, n);
    const { service } = fixture(t, async request => fetched(request.url.endsWith("/a") ? [
        entry({ externalId: "a1", title: "Diffusion models", summary: "Sampling.", publishedAt: day(1) }),
        entry({ externalId: "a2", title: "Agents", summary: "Planning with LARGE language models.", publishedAt: day(3) }),
        entry({ externalId: "a3", title: "Undated note" })
    ] : [
        entry({ externalId: "b1", title: "Retrieval", summary: "Dense search.", publishedAt: day(2) }),
        entry({ externalId: "b2", title: "A long abstract", summary: "x".repeat(1000), publishedAt: day(4) })
    ], { url: request.url }));
    const a = await service.saveSource({ name: "A", url: "https://example.org/a" });
    const b = await service.saveSource({ name: "B", url: "https://example.org/b" });
    const titles = query => service.getState(query).items.map(item => item.title);
    assert.deepEqual(titles({}), ["A long abstract", "Agents", "Retrieval", "Diffusion models", "Undated note"]);
    // Undated items stay at the end in both directions.
    assert.deepEqual(titles({ order: "oldest" }), ["Diffusion models", "Retrieval", "Agents", "A long abstract", "Undated note"]);
    assert.deepEqual(titles({ sourceId: b, order: "oldest" }), ["Retrieval", "A long abstract"]);
    // Lists carry an excerpt; the reader gets the whole text.
    const long = service.getState({}).items[0];
    assert.equal(long.summary.length, 400);
    assert.equal(service.getItem(long.id).summary.length, 1000);

    assert.deepEqual(titles({ followed: true }), [], "nothing is followed yet");
    assert.deepEqual(service.setKeywords([" diffusion ", "Large  Language", "DIFFUSION", ""]), ["diffusion", "Large Language"]);
    assert.deepEqual(titles({ followed: true }), ["Agents", "Diffusion models"]);
    assert.deepEqual(titles({ followed: true, keyword: "sampling" }), ["Diffusion models"]);
    assert.deepEqual(service.getState({}).keywords, ["diffusion", "Large Language"]);
    assert.throws(() => service.setKeywords(["x".repeat(101)]), /100/);
    assert.throws(() => service.setKeywords(Array.from({ length: 51 }, (_, i) => `k${i}`)), /50/);
    assert.throws(() => service.setKeywords("diffusion"));

    service.setRead(service.getState({}).items[1].id, true);
    assert.deepEqual(titles({ read: "read" }), ["Agents"]);
    assert.deepEqual(titles({ read: "unread", sourceId: a }), ["Diffusion models", "Undated note"]);
    assert.equal(service.getState({}).unreadCount, 4);
    assert.equal(service.markAllRead(a), 2);
    assert.deepEqual(service.getState({}).sources.map(source => source.unreadCount), [0, 2]);
    service.setSourceStatus(b, "cancel");
    assert.equal(service.getState({}).unreadCount, 0, "cancelled subscriptions do not count as unread");
    assert.equal(service.markAllRead(), 0, "and are left out of marking everything read");
    assert.equal(service.getState({ sourceId: b }).sources.find(source => source.id === b).unreadCount, 2);
    assert.equal(service.markAllRead(b), 2);
    assert.throws(() => service.markAllRead("missing"), /不存在/);
    assert.throws(() => service.setPosition(long.id, 1.5), /阅读位置/);
});

test("an item is added to the library once, and a paper that left the library is only replaced on request", async t => {
    const papers = new Map();
    const announced = [];
    const library = {
        createPaper: paper => {
            const id = `paper-${papers.size + 1}`;
            papers.set(id, { paper, state: "saved" });
            return id;
        },
        paperState: id => papers.get(id)?.state ?? "missing",
        announce: id => announced.push(id)
    };
    const { service, database } = fixture(t, loaderOf([
        entry({ externalId: "arXiv:2610.00001", title: "Language models", url: "https://arxiv.org/abs/2610.00001", authors: "Alice, Bob", summary: "A".repeat(5000), publishedAt: Date.UTC(2026, 9, 7, 23, 30) })
    ]), library);
    const source = await service.saveSource({ name: "arXiv", url: "https://rss.arxiv.org/atom/cs.AI" });
    const [item] = service.getState({}).items;
    assert.equal(service.getItem(item.id).paperState, "none");
    const paperId = service.importItem(item.id);
    assert.deepEqual(announced, [paperId]);
    const { paper } = papers.get(paperId);
    assert.deepEqual([paper.title, paper.authors, paper.url, paper.published], ["Language models", "Alice, Bob", "https://arxiv.org/abs/2610.00001", "2026-10-07"]);
    assert.equal(paper.abstract.length, 4001);
    assert.deepEqual(paper.origin, {
        kind: "feed", itemId: item.id, sourceId: source, sourceName: "arXiv", feedURL: "https://rss.arxiv.org/atom/cs.AI",
        externalId: "arXiv:2610.00001", url: "https://arxiv.org/abs/2610.00001"
    });
    assert.deepEqual([service.getState({}).items[0].paperId, service.getItem(item.id).paperState], [paperId, "saved"]);
    // Importing again, or fetching the entry again, keeps the one paper.
    assert.equal(service.importItem(item.id), paperId);
    await service.refresh(source);
    assert.equal(service.getItem(item.id).paperId, paperId);
    assert.equal(papers.size, 1);

    for (const state of ["recycled", "missing"]) {
        const current = service.getItem(item.id).paperId;
        papers.get(current).state = state;
        assert.equal(service.getItem(item.id).paperState, state);
        assert.throws(() => service.importItem(item.id), /确认后可以重新入库/);
        assert.equal(service.getItem(item.id).paperId, current, "the link is kept until the reader decides");
        const replacement = service.importItem(item.id, true);
        assert.notEqual(replacement, current);
        assert.equal(service.getItem(item.id).paperState, "saved");
    }

    // A paper that cannot be created leaves the item unlinked.
    const [other] = database.prepare("INSERT INTO feed_items (id, source_id, external_id, title, authors, summary) VALUES ('other', ?, 'other', 'Other', '', '') RETURNING id").all(source);
    library.createPaper = () => {
        throw new Error("Library unavailable");
    };
    assert.throws(() => service.importItem(other.id), /Library unavailable/);
    assert.equal(service.getItem(other.id).paperId, null);
    assert.throws(() => new FeedService(createWorkspaceDatabase(database)).importItem(other.id), /不支持/);
});

test("registering two windows shares one initial and periodic check until the application quits", t => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const app = new EventEmitter();
    const refreshDue = t.mock.fn(async () => {});
    const interval = t.mock.fn(setInterval), timeout = t.mock.fn(setTimeout);
    const stopInterval = t.mock.fn(clearInterval), stopTimeout = t.mock.fn(clearTimeout);
    const ipc = join(output, "main/feed/ipc.js"), load = createRequire(ipc);
    const exports = {};
    // Load a fresh IPC module with Electron's application lifecycle under test control.
    runInNewContext(readFileSync(ipc, "utf8"), {
        exports,
        require: id => {
            if (id === "electron") return { app };
            if (id === "./service") return { FeedService: class {
                refreshDue = refreshDue;
            } };
            return load(id);
        },
        setInterval: interval, setTimeout: timeout,
        clearInterval: stopInterval, clearTimeout: stopTimeout,
        console
    });
    t.after(() => app.emit("quit"));
    const window = () => Object.assign(new EventEmitter(), { webContents: { ipc: { handle: t.mock.fn() } } });
    const a = window(), b = window();
    const startup = { state: { status: "ready" }, getDatabase: () => ({}) };
    exports.registerFeedIPCs(a, startup, {});
    exports.registerFeedIPCs(b, startup, {});
    assert.equal(a.webContents.ipc.handle.mock.callCount(), b.webContents.ipc.handle.mock.callCount());
    assert.ok(b.webContents.ipc.handle.mock.callCount() > 0, "both windows receive their handlers");
    assert.equal(interval.mock.callCount(), 1);
    assert.equal(timeout.mock.callCount(), 1);
    assert.equal(app.listenerCount("quit"), 1);
    t.mock.timers.tick(2999);
    assert.equal(refreshDue.mock.callCount(), 0);
    t.mock.timers.tick(1);
    assert.equal(refreshDue.mock.callCount(), 1, "one initial check after three seconds");
    a.emit("closed");
    t.mock.timers.tick(27000);
    assert.equal(refreshDue.mock.callCount(), 2, "one periodic check after thirty seconds, even after the first window closes");
    t.mock.timers.tick(30000);
    assert.equal(refreshDue.mock.callCount(), 3);
    app.emit("quit");
    assert.equal(stopInterval.mock.callCount(), 1);
    assert.equal(stopTimeout.mock.callCount(), 1);
    t.mock.timers.tick(60000);
    assert.equal(refreshDue.mock.callCount(), 3, "no checks remain after application exit");
});

test("arXiv PDF addresses are derived from modern and legacy entry addresses only", async () => {
    const urls = ["https://arxiv.org/abs/2411.01234", "http://export.arxiv.org/abs/2411.01234v2", "https://arxiv.org/abs/hep-th/9901001v1"];
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">${[...urls, "https://example.org/abs/2411.01234", "https://arxiv.org/help"].map((url, i) => `<entry><id>${i}</id><link href="${url}" rel="alternate"/></entry>`).join("")}</feed>`;
    const { entries } = await parseFeed(xml, "https://arxiv.org/feed");
    assert.deepEqual(entries.map(item => item.pdfURL), ["https://arxiv.org/pdf/2411.01234", "https://arxiv.org/pdf/2411.01234v2", "https://arxiv.org/pdf/hep-th/9901001v1", null, null]);
});

test("RSS PDF enclosures are selected by MIME type, resolve relative addresses and reject unsafe links", async () => {
    const { entries } = await parseFeed(`<rss version="2.0"><channel><title>PDF</title>
        <item><guid>a</guid><enclosure type="audio/mpeg" url="sound.mp3"/><enclosure type="application/pdf" url="/paper.pdf"/></item>
        <item><guid>b</guid><enclosure type="application/pdf" url="javascript:alert(1)"/></item>
        <item><guid>c</guid><link>https://example.org/article.pdf</link></item>
        </channel></rss>`, "https://example.org/feed");
    assert.deepEqual(entries.map(item => item.pdfURL), ["https://example.org/paper.pdf", null, null]);
});

test("Atom PDF links do not replace the article link and are selected by MIME type", async () => {
    const { entries } = await parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom">
        <entry><id>a</id><link rel="alternate" href="/article"/><link type="text/html" href="/other"/><link type="application/pdf" href="/full.pdf"/></entry>
        <entry><id>b</id><link type="application/pdf" href="file:///bad.pdf"/></entry></feed>`, "https://example.org/feed");
    assert.equal(entries[0].url, "https://example.org/article");
    assert.deepEqual(entries.map(item => item.pdfURL), ["https://example.org/full.pdf", null]);
});

test("JSON Feed PDF attachments are selected by MIME type without guessing from article addresses", () => {
    const { entries } = parseJSONFeed(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [
        { id: "a", url: "/article", attachments: [{ mime_type: "audio/mpeg", url: "/sound" }, { mime_type: "application/pdf", url: "/paper.pdf" }] },
        { id: "b", attachments: [{ mime_type: "application/pdf", url: "https://user:secret@example.org/a.pdf" }] },
        { id: "c", url: "https://example.org/article.pdf", attachments: [null, { mime_type: "text/html", url: "/a.pdf" }] }
    ] }), "https://example.org/feed");
    assert.deepEqual(entries.map(item => item.pdfURL), ["https://example.org/paper.pdf", null, null]);
});

async function pdfServer(t) {
    const pdf = Buffer.from("%PDF-1.4\nlocal test\n%%EOF");
    const calls = new Map();
    let retry = false;
    const server = createServer((request, response) => {
        const path = request.url;
        calls.set(path, (calls.get(path) ?? 0) + 1);
        if (path === "/404" || (path === "/retry" && !retry)) {
            response.writeHead(404).end();
        }
        else if (path === "/html") response.end("<!DOCTYPE html><html>arXiv unavailable</html>");
        else if (path === "/prefixed") response.end(Buffer.concat([Buffer.from("HTML before PDF"), pdf]));
        else if (path === "/timeout") { /* Wait until the client aborts. */ }
        else if (path === "/body-timeout") {
 response.writeHead(200); response.write("%PDF-");
}
        else if (path === "/large") response.end(Buffer.concat([pdf, Buffer.alloc(1024)]));
        else if (path === "/large-stream") {
 response.write(pdf); response.end(Buffer.alloc(1024));
}
        else response.end(pdf);
    });
    t.after(() => {
 server.closeAllConnections(); return new Promise(resolve => server.close(resolve));
});
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, pdf, calls, recover: () => retry = true };
}

for (const path of ["/ok", "/404", "/html", "/prefixed", "/timeout", "/body-timeout", "/large", "/large-stream", "/retry"]) {
    test(`PDF import through a local server: ${path}`, async t => {
        const server = await pdfServer(t);
        const papers = new Map(), tempFiles = [];
        const library = {
            createPaper: paper => {
 papers.set("paper", { paper, pdf: null }); return "paper";
},
            paperState: id => papers.has(id) ? "saved" : "missing",
            hasPDF: id => Boolean(papers.get(id)?.pdf),
            importPDF: (id, url) => importFeedPDF(url, file => {
                tempFiles.push(file);
                papers.get(id).pdf = readFileSync(file);
            }, fetch, { maxBytes: 128, timeoutMs: 100 }),
            announce: () => {}
        };
        const { service } = fixture(t, loaderOf([entry({ externalId: "pdf", pdfURL: server.url + path })]), library);
        await service.saveSource({ name: "PDF", url: server.url + "/feed" });
        const [item] = service.getState({}).items;
        const page = service.importItem(item.id);
        assert.equal(page, "paper", "paper creation returns immediately");
        assert.equal(papers.size, 1);
        assert.equal(service.getItem(item.id).pdfStatus, "downloading");
        assert.equal(server.calls.get(path), undefined, "network work starts after importItem returns");
        const first = service.fetchPDF(item.id), again = service.fetchPDF(item.id);
        assert.equal(first, again, "repeated requests share the same attempt");
        await first;
        assert.equal(server.calls.get(path), 1);
        assert.equal(service.getItem(item.id).paperState, "saved");
        if (path === "/ok") {
            assert.equal(service.getItem(item.id).pdfStatus, "saved");
            assert.deepEqual(papers.get(page).pdf, server.pdf);
            await service.fetchPDF(item.id);
            assert.equal(server.calls.get(path), 1, "an attached PDF is not downloaded again");
        }
        else {
            assert.equal(service.getItem(item.id).pdfStatus, "failed");
            assert.equal(papers.get(page).pdf, null);
            assert.equal(service.getItem(item.id).paperId, page);
            if (path === "/retry") {
                server.recover();
                await service.fetchPDF(item.id);
                assert.equal(service.getItem(item.id).pdfStatus, "saved");
                assert.equal(server.calls.get(path), 2);
                assert.equal(papers.size, 1, "retry attaches to the original paper");
                assert.deepEqual(papers.get(page).pdf, server.pdf);
            }
        }
        assert.ok(tempFiles.every(file => !existsSync(file)), "download temporary files are removed");
    });
}

test("a previously imported paper without a PDF can fetch it, and source refresh preserves the PDF address", async t => {
    const server = await pdfServer(t);
    let withAddress = true;
    let attached = false;
    const library = {
        createPaper: () => "paper", paperState: () => "saved", hasPDF: () => attached,
        importPDF: (_id, url) => importFeedPDF(url, () => {
 attached = true;
}, fetch), announce: () => {}
    };
    const { service, database } = fixture(t, loaderOf(() => [entry({ externalId: "saved", pdfURL: withAddress ? server.url + "/ok" : null })]), library);
    await service.saveSource({ name: "PDF", url: server.url + "/feed" });
    const [item] = service.getState({}).items;
    database.prepare("UPDATE feed_items SET paper_id = 'paper' WHERE id = ?").run(item.id);
    assert.equal(service.getItem(item.id).pdfStatus, "idle");
    withAddress = false;
    await service.refresh();
    assert.equal(service.getItem(item.id).pdfURL, server.url + "/ok");
    await service.fetchPDF(item.id);
    assert.equal(service.getItem(item.id).pdfStatus, "saved");
});

test("temporary PDF files are removed when PaperService refuses an attachment", async t => {
    const server = await pdfServer(t);
    let temporary;
    await assert.rejects(importFeedPDF(server.url + "/ok", file => {
        temporary = file;
        throw new Error("Paper was deleted");
    }), /Paper was deleted/);
    assert.equal(existsSync(temporary), false);
});