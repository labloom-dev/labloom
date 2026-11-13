import { tabState } from "../Tab/state.svelte";
import type { PageSummary } from "../../../shared/types/content";
import { openDestination, openPage } from "../layout/navigation";
import { confirmed, perform, writeFromTab } from "./state.svelte";
import { purgePages } from "./purge";

export function pageMenu(page: PageSummary, tabId: string, ids = [page.id]): { label: string; shortcut?: string; run: () => void }[] {
    const write = (action: (source: string) => Promise<unknown>): void => {
        if (!tabId) openDestination("library");
        const source = tabId || tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId;
        if (!source) return;
        void perform(async () => {
            await writeFromTab(source, () => action(source));
        });
    };
    if (page.attributes.deleted) return [
        { label: "恢复", run: () => write(source => window.api.knowledge.restore(ids, source)) },
        { label: "永久删除", run: () => write(source => purgePages(ids, source)) }
    ];
    return [
        { label: "打开", shortcut: "Enter", run: () => openPage(page.id) },
        { label: "在另一标签组打开", shortcut: "Ctrl+Enter", run: () => openPage(page.id, { otherGroup: true }) },
        { label: page.attributes.pinned ? "取消固定" : "固定到侧栏", run: () => write(source => window.api.knowledge.commitEdit({ pageId: page.id, tabId: source, batch: 0, blocks: [], attributes: { pinned: !page.attributes.pinned } })) },
        { label: "移入回收站", shortcut: "Delete", run: () => write(source => confirmed(token => window.api.knowledge.trash(ids, source, token))) }
    ];
}