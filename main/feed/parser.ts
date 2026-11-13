import { setTimeout as delay } from "node:timers/promises";
import Parser from "rss-parser";
import type { FeedEntry } from "../../shared/types/feed";
import { feedURL } from "../../shared/utils/feed";
import { anthropicSection, parseAnthropic } from "./anthropic";
import { LabloomError, diagnostic, type FailureInfo } from "../../shared/failure";

type ExtraItem = {
    id?: string;
    links?: { $?: { type?: string; href?: string } }[];
    enclosures?: { $?: { type?: string; url?: string } }[];
    author?: string;
    atomAuthors?: { name?: string[]; }[];
    creators?: string[];
    abstract?: string;
    abstractSnippet?: string;
    "content:encoded"?: string;
};

export type FeedRequest = {
    url: string;
    /** Validators from the previous response, replayed verbatim. */
    etag?: string | null;
    lastModified?: string | null;
    /** Follow a web page's link to its feed. Only used when a source is saved. */
    discover?: boolean;
};

export type FeedResult = {
    /** null when the source reported no change since the validators were issued. */
    entries: FeedEntry[] | null;
    /** The feed's own title, empty when it has none. */
    title: string;
    /** The address the feed was read from; differs from the request after discovery. */
    url: string;
    etag: string | null;
    lastModified: string | null;
};

/** A failed fetch. Only retryable failures are attempted again before the next interval. */
export class FeedError extends LabloomError {
    constructor(failure: FailureInfo, readonly retryable: boolean, readonly retryAfter?: number, cause?: unknown) {
        super(failure, cause === undefined ? undefined : { cause });
    }
}

const summaryOptions = { keepArray: false, includeSnippet: true };
const parser = new Parser<{ title?: string }, ExtraItem>({
    customFields: {
        item: [
            ["author", "atomAuthors", { keepArray: true }],
            ["dc:creator", "creators", { keepArray: true }],
            ["summary", "abstract", summaryOptions],
            ["link", "links", { keepArray: true }],
            ["enclosure", "enclosures", { keepArray: true }]
        ]
    }
});
const maxBytes = 10 * 1024 * 1024;
const maxRetryAfter = 24 * 60 * 60 * 1000;
const feedTypes = /^application\/(rss\+xml|atom\+xml|feed\+json)$/i;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let arxivQueue: Promise<unknown> = Promise.resolve();
let nextArxivRequest = 0;

function clean(value: unknown): string {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

const namedEntities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function plainText(html: string): string {
    return html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/<\/?(h\d|br|p|ul|ol|li|blockquote|section|table|tr|div)\b[^>]*>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
            if (name[0] !== "#") return namedEntities[name.toLowerCase()] ?? entity;
            const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
        })
        .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function link(value: unknown, base: string): string | null {
    try {
        return typeof value === "string" && value ? feedURL(value, base) : null;
    }
    catch {
        // Unsafe links remain unavailable in the reader.
        return null;
    }
}

function pdfURL(article: string | null, attachments: { type?: unknown; url?: unknown }[], base: string): string | null {
    if (article) {
        const address = new URL(article);
        const id = /^\/abs\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)\/?$/i.exec(address.pathname)?.[1];
        if ((address.hostname === "arxiv.org" || address.hostname === "www.arxiv.org" || address.hostname === "export.arxiv.org") && id) {
            return `https://arxiv.org/pdf/${id}`;
        }
    }
    for (const attachment of attachments) {
        if (typeof attachment.type !== "string" || attachment.type.trim().toLowerCase() !== "application/pdf") continue;
        const address = link(attachment.url, base);
        if (address) return address;
    }
    return null;
}

function time(value: unknown): number | null {
    const parsed = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
}

function title(value: unknown, summary: string): string {
    const text = clean(value);
    if (text) return text;
    // Untitled posts are named after their opening words.
    const opening = clean(summary);
    return opening ? opening.length > 80 ? `${opening.slice(0, 80)}…` : opening : "无标题";
}

/** The declarations before an XML document's root element, and that element's name. */
function documentStart(xml: string): { prolog: string; root: string } {
    // Comments and processing instructions may hold anything, so they are left out of the search.
    const text = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, " ");
    const root = /<([A-Za-z_][\w:.-]*)/.exec(text);
    return { prolog: root ? text.slice(0, root.index) : text, root: root?.[1] ?? "" };
}

export async function parseFeed(xml: string, sourceURL: string): Promise<{ title: string; entries: FeedEntry[] }> {
    const start = documentStart(xml);
    // Feeds are data; reject a document type, which could define external entities. One can only be declared
    // before the root element; the same text inside an article (a post that is a whole HTML page) is content.
    if (/<!DOCTYPE/i.test(start.prolog)) throw new FeedError({ kind: "feed-xml-declaration" }, false);
    let feed: Awaited<ReturnType<typeof parser.parseString>>;
    try {
        feed = await parser.parseString(xml);
    }
    catch {
        throw new FeedError({ kind: "feed-invalid-xml" }, false);
    }
    // Atom separates the article (content) from its excerpt (summary); RSS uses content:encoded and description.
    const atom = start.root === "feed";
    const entries = feed.items.map(item => {
        if (item.id?.startsWith("http://arxiv.org/api/errors") || item.id?.startsWith("https://arxiv.org/api/errors")) {
            throw new FeedError({ kind: "feed-arxiv-query", diagnostic: item.summary }, false);
        }
        const authors = item.atomAuthors?.flatMap(author => author.name ?? []).join(", ")
            || item.creators?.join(", ") || item.creator || item.author || "";
        const encoded = item["content:encoded"];
        const body = (typeof encoded === "string" && encoded) || (atom && item.content) || "";
        const excerpt = atom ? typeof item.abstract === "string" ? item.abstract : "" : item.content ?? "";
        const markup = body || excerpt;
        const summary = (atom && item.abstractSnippet) || item.contentSnippet || plainText(markup);
        const url = link(item.link, sourceURL);
        const attachments = atom ? (item.links ?? []).map(value => ({ type: value.$?.type, url: value.$?.href }))
            : (item.enclosures ?? []).map(value => ({ type: value.$?.type, url: value.$?.url }));
        return {
            externalId: item.guid || item.id || null,
            title: title(item.title, summary),
            url,
            pdfURL: pdfURL(url, attachments, sourceURL),
            authors: clean(authors),
            summary,
            // Plain text needs no second copy; the summary already holds it.
            content: /[<&]/.test(markup) ? markup : "",
            fullContent: Boolean(body),
            publishedAt: time(item.isoDate ?? item.pubDate)
        };
    });
    return { title: clean(feed.title), entries };
}

export function parseJSONFeed(json: string, sourceURL: string): { title: string; entries: FeedEntry[] } {
    let data: unknown;
    try {
        data = JSON.parse(json);
    }
    catch {
        throw new FeedError({ kind: "feed-invalid-json" }, false);
    }
    const feed = data as { version?: unknown; title?: unknown; items?: unknown };
    if (!feed || typeof feed.version !== "string" || !feed.version.startsWith("https://jsonfeed.org/version/") || !Array.isArray(feed.items)) {
        throw new FeedError({ kind: "feed-unsupported-format" }, false);
    }
    const entries = (feed.items as Record<string, unknown>[]).filter(item => item && typeof item === "object").map(item => {
        const html = typeof item.content_html === "string" ? item.content_html : "";
        const text = typeof item.content_text === "string" ? item.content_text : "";
        const summary = typeof item.summary === "string" && item.summary.trim() ? item.summary.trim() : text.trim() || plainText(html);
        const people = Array.isArray(item.authors) ? item.authors : item.author ? [item.author] : [];
        const id = typeof item.id === "string" || typeof item.id === "number" ? String(item.id) : "";
        const url = link(item.url, sourceURL) ?? link(item.external_url, sourceURL);
        const attachments = Array.isArray(item.attachments) ? item.attachments.map(value => ({ type: value?.mime_type, url: value?.url })) : [];
        return {
            externalId: id || null,
            title: title(item.title, summary),
            url,
            pdfURL: pdfURL(url, attachments, sourceURL),
            authors: people.map(person => clean((person as { name?: unknown })?.name)).filter(Boolean).join(", "),
            summary,
            content: html,
            fullContent: Boolean(html || text),
            publishedAt: time(item.date_published)
        };
    });
    return { title: clean(feed.title), entries };
}

/** Feed addresses a web page advertises with <link rel="alternate">. */
export function discoverFeeds(html: string, pageURL: string): string[] {
    const found: string[] = [];
    for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
        const attributes: Record<string, string> = {};
        for (const match of tag.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
            attributes[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? "").replace(/&amp;/g, "&").trim();
        }
        if (!/(^|\s)alternate(\s|$)/i.test(attributes.rel ?? "") || !feedTypes.test(attributes.type ?? "")) continue;
        const address = link(attributes.href, pageURL);
        if (address && !found.includes(address)) found.push(address);
    }
    return found;
}

function decode(bytes: Buffer, contentType: string | null): string {
    let label = "utf-8";
    if (bytes[0] === 0xff && bytes[1] === 0xfe) label = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";
    else if (!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
        // The declaration written with the document is more reliable than a server default.
        label = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/i.exec(bytes.subarray(0, 256).toString("latin1"))?.[1]
            ?? /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? "")?.[1] ?? label;
    }
    try {
        return new TextDecoder(label).decode(bytes);
    }
    catch {
        return new TextDecoder().decode(bytes);
    }
}

/** Retry-After as a delay in milliseconds; it is either seconds or an HTTP date. */
export function retryAfter(value: string | null, now = Date.now()): number | undefined {
    if (!value) return undefined;
    const delayMs = /^\s*\d+\s*$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
    return Number.isFinite(delayMs) ? Math.min(Math.max(delayMs, 0), maxRetryAfter) : undefined;
}

function requestError(error: unknown): FeedError {
    if (error instanceof FeedError) return error;
    const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
    const detail = [(error as Error)?.name, (error as Error)?.message, cause?.code, cause?.message].filter(Boolean).join(" ");
    // The cause is kept for the log; the message is what the reader sees.
    if (/Timeout|TIMED_?OUT|AbortError/i.test(detail)) return new FeedError({ kind: "feed-timeout", diagnostic: diagnostic(error) }, true, undefined, error);
    // A wrong certificate does not fix itself between retries; other TLS failures are often transient.
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(detail)) return new FeedError({ kind: "feed-certificate", diagnostic: diagnostic(error) }, false, undefined, error);
    return new FeedError({ kind: "feed-network", diagnostic: diagnostic(error) }, true, undefined, error);
}

function statusError(response: Response): FeedError {
    const { status } = response;
    const wait = retryAfter(response.headers.get("retry-after"));
    if (status === 429) return new FeedError({ kind: "feed-rate-limited" }, true, wait);
    if (status === 401 || status === 403 || status === 407) return new FeedError({ kind: "feed-denied", status }, false);
    if (status === 404 || status === 410) return new FeedError({ kind: "feed-address-missing", status }, false);
    if (status === 408 || status === 425 || status >= 500) return new FeedError({ kind: "feed-unavailable", status }, true, wait);
    return new FeedError({ kind: "feed-http", status }, false);
}

async function download(request: FeedRequest, fetcher: Fetcher): Promise<FeedResult> {
    const { url } = request;
    const adapter = anthropicSection(url);
    const headers: Record<string, string> = {
        "Accept": adapter ? "text/html" : "application/atom+xml, application/rss+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5",
        "User-Agent": "Labloom/1.0 (+https://labloom.dev)"
    };
    if (request.etag) headers["If-None-Match"] = request.etag;
    if (request.lastModified) headers["If-Modified-Since"] = request.lastModified;
    let response: Response;
    try {
        response = await fetcher(url, { signal: AbortSignal.timeout(30000), credentials: "omit", headers });
    }
    catch (error) {
        throw requestError(error);
    }
    const etag = response.headers.get("etag"), lastModified = response.headers.get("last-modified");
    if (response.status === 304) {
        await response.body?.cancel();
        return { entries: null, title: "", url, etag: etag ?? request.etag ?? null, lastModified: lastModified ?? request.lastModified ?? null };
    }
    if (!response.ok) {
        await response.body?.cancel();
        throw statusError(response);
    }
    if (!response.body) throw new FeedError({ kind: "feed-empty" }, true);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxBytes) throw new FeedError({ kind: "feed-too-large" }, false);
            chunks.push(value);
        }
    }
    catch (error) {
        throw requestError(error);
    }
    finally {
        await reader.cancel();
    }
    const type = response.headers.get("content-type");
    const body = decode(Buffer.concat(chunks), type);
    const base = response.url || url;
    const validators = { url, etag, lastModified };
    if (adapter) return { ...validators, title: "", entries: parseAnthropic(body, url) };
    const opening = body.slice(0, 1024).trimStart();
    if (/json/i.test(type ?? "") || opening.startsWith("{")) return { ...validators, ...parseJSONFeed(body, base) };
    if (/^<!doctype\s+html|^<html[\s>]/i.test(opening) || (/text\/html/i.test(type ?? "") && !/<(rss|feed|rdf:RDF)[\s>]/i.test(opening))) {
        if (!request.discover) throw new FeedError({ kind: "feed-webpage" }, false);
        const [address] = discoverFeeds(body, base);
        if (!address) throw new FeedError({ kind: "feed-no-discovery" }, false);
        return download({ url: address }, fetcher);
    }
    return { ...validators, ...await parseFeed(body, base) };
}

export async function fetchFeed(request: FeedRequest, fetcher: Fetcher = fetch): Promise<FeedResult> {
    const host = new URL(feedURL(request.url)).hostname;
    if (host !== "arxiv.org" && !host.endsWith(".arxiv.org")) {
        const result = await download(request, fetcher);
        if (!result.entries) return result;
        // Blog sources import their latest ten entries; an entry without an identifier is told apart by its address.
        const unique = [...new Map(result.entries.map(entry => [entry.externalId ?? entry.url ?? `${entry.title}\n${entry.publishedAt}`, entry])).values()];
        return { ...result, entries: unique.sort((a, b) => (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity)).slice(0, 10) };
    }
    // arXiv requests share one connection queue, at least three seconds apart.
    const queued = arxivQueue.then(async () => {
        await delay(Math.max(0, nextArxivRequest - Date.now()));
        try {
            return await download(request, fetcher);
        }
        finally {
            nextArxivRequest = Date.now() + 3000;
        }
    });
    arxivQueue = queued.catch(() => {});
    return queued;
}