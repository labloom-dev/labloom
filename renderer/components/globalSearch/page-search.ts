import type { PagesAPI } from "../../../shared/pages/ipc";
import type { PageSummary } from "../../../shared/types/content";

export async function recent(): Promise<(PageSummary & { openedAt: number })[]> {
    const { navigationState } = await import("../Tab/persistence.svelte");
    const history = navigationState.recentPages;
    if (!history.length) return [];
    const { items } = await window.api.pages.list({ ids: history.map(entry => entry.id), limit: history.length });
    const byId = new Map(items.map(page => [page.id, page]));
    return history.flatMap(({ id, openedAt }) => {
        const page = byId.get(id);
        return page ? [{ ...page, openedAt }] : [];
    });
}

export const search: PagesAPI["search"] = (keyword: string, offset: number) => window.api.pages.search(keyword, offset);
export const blockList: PagesAPI["blockList"] = id => window.api.pages.blockList(id);