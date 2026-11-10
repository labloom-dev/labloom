import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Parser from "rss-parser";
import type { FeedEntry } from "../../shared/types/feed";
import { feedURL } from "../../shared/utils/feed";
import { anthropicSection, parseAnthropic } from "./anthropic";

type ExtraItem = {
    id?: string;
    author?: string;
    atomAuthors?: { name?: string[]; }[];
    creators?: string[];
    abstractSnippet?: string;
};

const summaryOptions = { keepArray: false, includeSnippet: true };
const parser = new Parser<Record<string, never>, ExtraItem>({
    customFields: {
        item: [
            ["author", "atomAuthors", { keepArray: true }],
            ["dc:creator", "creators", { keepArray: true }],
            ["summary", "abstract", summaryOptions]
        ]
    }
});
const maxBytes = 10 * 1024 * 1024;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let arxivQueue: Promise<unknown> = Promise.resolve();
let nextArxivRequest = 0;

export async function parseFeed(xml: string, sourceURL: string): Promise<FeedEntry[]> {
    // Feeds are data; reject declarations that could define external entities.
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("订阅内容包含不支持的 XML 声明。");
    const feed = await parser.parseString(xml);
    return feed.items.map(item => {
        if (item.id?.startsWith("http://arxiv.org/api/errors") || item.id?.startsWith("https://arxiv.org/api/errors")) {
            throw new Error(item.summary || "arXiv 查询失败，请检查领域和关键词。");
        }
        let url: string | null = null;
        try {
            if (item.link) url = feedURL(item.link, sourceURL);
        }
        catch { /* Unsafe links remain unavailable in the reader. */ }
        const title = typeof item.title === "string" ? item.title.replace(/\s+/g, " ").trim() : "无标题";
        const date = item.isoDate ?? item.pubDate;
        const publishedAt = date && Number.isFinite(Date.parse(date)) ? Date.parse(date) : null;
        const authors = item.atomAuthors?.flatMap(author => author.name ?? []).join(", ")
            || item.creators?.join(", ") || item.creator || item.author || "";
        const summary = item.abstractSnippet ?? item.contentSnippet ?? "";
        const externalId = item.guid || item.id || url
            || createHash("sha256").update(JSON.stringify([title, authors, publishedAt === null ? null : new Date(publishedAt).toISOString()])).digest("hex");
        return { externalId, title, url, authors, summary, publishedAt };
    });
}

async function download(url: string, fetcher: Fetcher): Promise<FeedEntry[]> {
    const response = await fetcher(url, {
        signal: AbortSignal.timeout(30000),
        credentials: "omit",
        headers: {
            "Accept": anthropicSection(url) ? "text/html" : "application/atom+xml, application/rss+xml, application/xml, text/xml",
            "User-Agent": "Labloom/1.0 (+https://labloom.dev)"
        }
    });
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(response.status === 429
            ? "来源请求过于频繁，请稍后重试。"
            : `来源返回 HTTP ${response.status}，请检查地址或稍后重试。`);
    }
    if (!response.body) throw new Error("来源没有返回订阅内容。");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxBytes) throw new Error("订阅内容超过 10 MB，请缩小订阅范围。");
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel();
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return anthropicSection(url) ? parseAnthropic(body, url) : parseFeed(body, response.url || url);
}

export async function fetchFeed(url: string, fetcher: Fetcher = fetch): Promise<FeedEntry[]> {
    const host = new URL(feedURL(url)).hostname;
    if (host !== "arxiv.org" && !host.endsWith(".arxiv.org")) {
        const entries = await download(url, fetcher);
        const unique = [...new Map(entries.map(entry => [entry.externalId, entry])).values()];
        return unique.sort((a, b) => (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity)).slice(0, 10);
    }
    // arXiv requests share one connection queue, at least three seconds apart.
    const request = arxivQueue.then(async () => {
        await delay(Math.max(0, nextArxivRequest - Date.now()));
        try {
            return await download(url, fetcher);
        }
        finally {
            nextArxivRequest = Date.now() + 3000;
        }
    });
    arxivQueue = request.catch(() => {});
    return request;
}