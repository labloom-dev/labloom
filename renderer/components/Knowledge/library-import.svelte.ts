import { SvelteMap } from "svelte/reactivity";
import type { HistorySource } from "../../../shared/history/ipc";
import { failure, message, t } from "../../i18n.svelte";
import { openDestination, openPage } from "../layout/navigation";
import { knowledgeState } from "./feedback.svelte";
import { write } from "./page-sessions";

export const importedPages = new SvelteMap<string, string[]>();
export async function importPapers(source: HistorySource, options: { tabId?: string; pageId?: string; paths?: string[] } = {}): Promise<void> {
    const { tabId, pageId, paths } = options;
    const api = window.api, selected = paths ?? await api.attachments.choose("pdf");
    if (!selected.length) return;
    const { files, failures } = await api.attachments.stagePaths(selected, !pageId || !paths);
    const ids = files.map(file => file.id);
    let pages: string[] = [];
    if (ids.length) {
        try {
            pages = await write(() => api.papers.importPrepared(ids, source, pageId));
        }
        catch (error) {
            failures.push(...files.map(file => ({ name: file.originalName, error: failure(error) })));
        }
        finally {
            await api.attachments.releaseHandoffs(ids);
        }
    }
    if (failures.length) knowledgeState.error = { kind: "import-failed", diagnostic: failures.map(f => f.name + t("dialog.join") + message(f.error)).join("\n") };
    if (!pageId && pages.length) {
        if (pages.length === 1 && !failures.length) openPage(pages[0]);
        else importedPages.set(tabId ?? openDestination("papers").id, pages);
    }
}