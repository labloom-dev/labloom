import { SvelteMap } from "svelte/reactivity";
import type { HistorySource } from "../../../shared/history/ipc";
import type { AttributeValue } from "../../../shared/types/attributes";
import { failure, message, t } from "../../i18n.svelte";
import { openDestination, openPage } from "../layout/navigation";
import { knowledgeState } from "./feedback.svelte";
import { write } from "./page-sessions";

export const importedPages = new SvelteMap<string, string[]>();
type ImportOptions = { pageId?: string; paths?: string[]; initial?: Record<string, AttributeValue> };
export async function importPaperFiles(source: HistorySource, { pageId, paths, initial }: ImportOptions): Promise<{ pages: string[]; failed: boolean }> {
    const api = window.api, selected = paths ?? await api.attachments.choose("pdf");
    if (!selected.length) return { pages: [], failed: false };
    const { files, failures } = await api.attachments.stagePaths(selected, !pageId || !paths);
    const ids = files.map(file => file.id);
    let pages: string[] = [];
    if (ids.length) {
        try {
            pages = await write(() => api.papers.importPrepared(ids, source, pageId, initial));
        }
        catch (error) {
            failures.push(...files.map(file => ({ name: file.originalName, error: failure(error) })));
        }
        finally {
            await api.attachments.releaseHandoffs(ids);
        }
    }
    if (failures.length) knowledgeState.error = { kind: "import-failed", diagnostic: failures.map(f => f.name + t("dialog.join") + message(f.error)).join("\n") };
    return { pages, failed: !!failures.length };
}

export async function importPapers(source: HistorySource, options: ImportOptions = {}): Promise<void> {
    const { pages, failed } = await importPaperFiles(source, options);
    if (!options.pageId && pages.length) {
        if (pages.length === 1 && !failed) openPage(pages[0]);
        else importedPages.set(openDestination("papers").id, pages);
    }
}