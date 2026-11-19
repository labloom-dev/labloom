import type { HistorySource } from "../../../shared/history/ipc";
import type { PageSummary } from "../../../shared/types/content";
import { openPage } from "../layout/navigation";
import { confirmed } from "./confirmation.svelte";
import { perform } from "./feedback.svelte";
import { write } from "./page-sessions";
import { purgePages } from "./purge";

export function pageMenu(page: PageSummary, source: HistorySource, ids = [page.id]): { label: string; shortcut?: string; run: () => void }[] {
    const run = (action: () => Promise<unknown>): void => {
        void perform(async () => {
            await write(action);
        });
    };
    if (page.attributes.deleted) return [
        { label: "恢复", run: () => run(() => window.api.pages.restore(ids, source)) },
        { label: "永久删除", run: () => run(() => purgePages(ids)) }
    ];
    return [
        { label: "打开", shortcut: "Enter", run: () => openPage(page.id) },
        { label: "在另一标签组打开", shortcut: "Ctrl+Enter", run: () => openPage(page.id, { otherGroup: true }) },
        { label: page.attributes.pinned ? "取消固定" : "固定到侧栏", run: () => run(() => window.api.pages.commitEdit({ pageId: page.id, batch: 0, blocks: [], attributes: { pinned: !page.attributes.pinned } }, source)) },
        { label: "移入回收站", shortcut: "Delete", run: () => run(() => confirmed(token => window.api.pages.trash(ids, source, token))) }
    ];
}