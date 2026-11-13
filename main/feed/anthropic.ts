import { LabloomError } from "../../shared/failure";
import type { FeedEntry } from "../../shared/types/feed";
import { feedURL } from "../../shared/utils/feed";

const site = "https://www.anthropic.com";

export function anthropicSection(url: string): "news" | "engineering" | null {
    const { hostname, pathname } = new URL(url);
    if (hostname !== "www.anthropic.com" && hostname !== "anthropic.com") return null;
    const section = pathname.replace(/\/$/, "").slice(1);
    return section === "news" || section === "engineering" ? section : null;
}

type Article = {
    title: string;
    slug: string | null;
    /** The site files every article as "news" or "research". */
    kind: unknown;
    categories: Set<unknown>;
    /** Set when the article lives somewhere other than its usual address. */
    link: string | null;
    published: unknown;
    summary: string;
};

export function parseAnthropic(html: string, sourceURL: string): FeedEntry[] {
    const section = anthropicSection(sourceURL);
    if (!section) throw new LabloomError({ kind: "feed-anthropic-section" });

    // Read the public page data as JSON without evaluating any page scripts.
    const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)];
    const data = chunks.map(match => JSON.parse(match[1]) as string).join("");
    // The data repeats an article wherever the page shows it, each time with different fields.
    const articles = new Map<string, Article>();
    for (const match of data.matchAll(/[0-9a-f]+:([[{][^\n]*)/g)) {
        let record: unknown;
        try {
            record = JSON.parse(match[1]);
        }
        catch {
            continue;
        }
        const pending: unknown[] = [record];
        while (pending.length) {
            const value = pending.pop();
            if (!value || typeof value !== "object") continue;
            pending.push(...Object.values(value));
            const item = value as Record<string, unknown>;
            if (item._type !== "article" || typeof item.title !== "string" || !item.title.trim()) continue;
            const current = (item.slug as { current?: unknown; } | null)?.current;
            const slug = typeof current === "string" && /^[\w-]+$/.test(current) ? current : null;
            const link = typeof item.linkedUrl === "string" && item.linkedUrl.trim() ? item.linkedUrl.trim() : null;
            const key = slug ?? link;
            if (!key) continue;
            const article = articles.get(key) ?? { title: "", slug, kind: null, categories: new Set(), link: null, published: null, summary: "" };
            article.title ||= item.title.replace(/\s+/g, " ").trim();
            article.kind ??= item.articleType;
            article.link ??= link;
            article.published ??= item.publishedOn;
            if (item.category) article.categories.add(item.category);
            for (const text of [item.summary, item.seoDescription]) if (!article.summary && typeof text === "string") article.summary = text.trim();
            articles.set(key, article);
        }
    }

    // The page data also carries the site's menus, which list articles of every kind. News are the
    // "news" articles. Engineering articles are "research" filed under Engineering; the page links
    // to the ones it lists, including some that carry no category.
    const linked = new Set([...html.matchAll(/href="\/(?:research|engineering)\/([\w-]+)"/g)].map(match => match[1]));
    const entries: FeedEntry[] = [];
    for (const article of articles.values()) {
        const listed = section === "news" ? article.kind === "news"
            : article.kind === "research" && (article.categories.has("Engineering") || (article.slug !== null && linked.has(article.slug)));
        if (!listed) continue;
        let url: string;
        try {
            // Engineering articles are published under /research.
            url = article.link ? feedURL(article.link, sourceURL) : `${site}/${article.kind === "research" ? "research" : "news"}/${article.slug}`;
        }
        catch {
            continue;
        }
        const published = typeof article.published === "string" ? Date.parse(article.published) : NaN;
        entries.push({
            // The identifier keeps the form it had when articles were addressed by section, so saved items are recognised.
            externalId: article.slug ? `${site}/${section}/${article.slug}` : url,
            title: article.title,
            url,
            pdfURL: null,
            authors: "",
            summary: article.summary,
            content: "",
            fullContent: false,
            publishedAt: Number.isFinite(published) ? published : null
        });
    }
    if (!entries.length) throw new LabloomError({ kind: "feed-anthropic-empty" });
    return entries;
}