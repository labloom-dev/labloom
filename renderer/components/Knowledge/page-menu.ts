import { t } from "../../i18n.svelte";
import type { HistorySource } from "../../../shared/history/ipc";
import type { PageSummary } from "../../../shared/types/content";
import { openPage } from "../layout/navigation";
import { confirmed } from "./confirmation.svelte";
import { perform } from "./feedback.svelte";
import { write } from "./page-sessions";
import { purgePages } from "./purge";

export function pageMenu(page: Pick<PageSummary, "id" | "attributes">, source: HistorySource, ids = [page.id], currentGroup = false): { id: string; label: string; shortcut?: string; run: () => void }[] {
    const run = (action: () => Promise<unknown>): void => {
        void perform(async () => {
            await write(action);
        });
    };
    if (page.attributes.deleted) return [
        { id: "restore", label: t("pageAction.restore"), run: () => run(() => window.api.pages.restore(ids, source)) },
        { id: "purge", label: t("pageAction.purge"), run: () => run(() => purgePages(ids)) }
    ];
    return [
        { id: "open", label: t("pageAction.open"), shortcut: "Enter", run: () => openPage(page.id, { currentGroup }) },
        { id: "openSide", label: t("pageAction.openSide"), shortcut: "Ctrl+Enter", run: () => openPage(page.id, { otherGroup: true }) },
        { id: "pin", label: t(page.attributes.pinned ? "pageAction.unpin" : "pageAction.pin"), run: () => run(() => window.api.pages.commitEdit({ pageId: page.id, batch: 0, blocks: [], attributes: { pinned: !page.attributes.pinned } }, source)) },
        { id: "trash", label: t("pageAction.trash"), shortcut: "Delete", run: () => run(() => confirmed(token => window.api.pages.trash(ids, source, token))) }
    ];
}