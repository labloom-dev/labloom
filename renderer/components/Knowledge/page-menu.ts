import { historySource } from "../Tab/views";
import type { HistorySource } from "../../../shared/history/ipc";
import type { PageSummary } from "../../../shared/types/content";
import { openDestination, openPage } from "../layout/navigation";
import { confirmed, perform, writeFromTab } from "./state.svelte";
import { purgePages } from "./purge";

export function pageMenu(page: PageSummary, context?: { tabId: string; source: HistorySource }, ids = [page.id]): { label: string; shortcut?: string; run: () => void }[] {
    const write = (action: (tabId: string, source: HistorySource) => Promise<unknown>): void => {
        if (!context) {
            const tab = openDestination("library");
            context = { tabId: tab.id, source: historySource(tab.view) };
        }
        const { tabId, source } = context;
        void perform(async () => {
            await writeFromTab(tabId, () => action(tabId, source));
        });
    };
    if (page.attributes.deleted) return [
        { label: "恢复", run: () => write((tabId, source) => window.api.pages.restore(ids, tabId, source)) },
        { label: "永久删除", run: () => write(tabId => purgePages(ids, tabId)) }
    ];
    return [
        { label: "打开", shortcut: "Enter", run: () => openPage(page.id) },
        { label: "在另一标签组打开", shortcut: "Ctrl+Enter", run: () => openPage(page.id, { otherGroup: true }) },
        { label: page.attributes.pinned ? "取消固定" : "固定到侧栏", run: () => write((tabId, source) => window.api.pages.commitEdit({ pageId: page.id, tabId, batch: 0, blocks: [], attributes: { pinned: !page.attributes.pinned } }, source)) },
        { label: "移入回收站", shortcut: "Delete", run: () => write((tabId, source) => confirmed(token => window.api.pages.trash(ids, tabId, source, token))) }
    ];
}