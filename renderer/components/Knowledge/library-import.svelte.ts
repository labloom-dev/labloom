import { SvelteMap } from "svelte/reactivity";
import type { HistorySource } from "../../../shared/history/ipc";
import { message, t } from "../../i18n.svelte";
import { openDestination, openPage } from "../layout/navigation";
import { knowledgeState } from "./feedback.svelte";
import { write } from "./page-sessions";

export const importedPages = new SvelteMap<string, string[]>();
export async function importPapers(source: HistorySource, options: { tabId?: string; pageId?: string; paths?: string[] } = {}): Promise<void> {
    const { tabId, pageId, paths } = options;
    const result = await write(() => paths ? window.api.papers.importPaths(paths, source, pageId) : window.api.papers.importPDF(source, pageId));
    if (result.failures.length) {
        knowledgeState.error = { kind: "import-failed", diagnostic: result.failures.map(f => f.name + t("dialog.join") + message(f.error)).join("\n") };
    }
    if (!pageId && result.pages.length) {
        if (result.pages.length === 1 && !result.failures.length) openPage(result.pages[0]);
        else importedPages.set(tabId ?? openDestination("papers").id, result.pages);
    }
}