import type { FeedEntry } from "../../shared/types/feed";
import { feedURL } from "../../shared/utils/feed";

export function anthropicSection(url: string): "news" | "engineering" | null {
    const { hostname, pathname } = new URL(url);
    if (hostname !== "www.anthropic.com" && hostname !== "anthropic.com") return null;
    const section = pathname.replace(/\/$/, "").slice(1);
    return section === "news" || section === "engineering" ? section : null;
}

export function parseAnthropic(html: string, sourceURL: string): FeedEntry[] {
    const section = anthropicSection(sourceURL);
    if (!section) throw new Error("仅支持 Anthropic 的 News 和 Engineering 列表页。");

    // Read the public page data as JSON without evaluating any page scripts.
    const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)];
    const data = chunks.map(match => JSON.parse(match[1]) as string).join("");
    const entries = new Map<string, FeedEntry>();
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
            const featured = section === "news" && item._type === "featuredGridLink";
            if (!featured && item._type !== (section === "news" ? "post" : "engineeringArticle")) continue;
            if (typeof item.title !== "string" || !item.title.trim()) continue;

            let url: string;
            try {
                if (featured && typeof item.url === "string") url = feedURL(item.url, sourceURL);
                else {
                    const slug = item.slug as { current?: unknown; } | null;
                    if (typeof slug?.current !== "string" || !/^[\w-]+$/.test(slug.current)) continue;
                    url = `https://www.anthropic.com/${section}/${slug.current}`;
                }
            }
            catch {
                continue;
            }
            const date = featured ? item.date : item.publishedOn;
            const publishedAt = typeof date === "string" && Number.isFinite(Date.parse(date))
                ? Date.parse(date) : null;
            const summary = typeof item.summary === "string" ? item.summary.trim() : "";
            if (!entries.has(url) || (!entries.get(url)?.summary && summary)) {
                entries.set(url, {
                    externalId: url,
                    title: item.title.replace(/\s+/g, " ").trim(),
                    url,
                    authors: "",
                    summary,
                    publishedAt
                });
            }
        }
    }
    if (!entries.size) throw new Error("未找到 Anthropic 文章，页面结构可能已变化，请稍后重试。");
    return [...entries.values()];
}