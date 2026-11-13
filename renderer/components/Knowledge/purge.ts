import type { PurgeResult } from "../../../shared/types/knowledge";
import { ask } from "./state.svelte";
import { t } from "../../i18n.svelte";

export async function purgePages(ids: string[] | null, tabId: string): Promise<boolean> {
    const submit = (token?: string): Promise<PurgeResult> => ids === null ? window.api.knowledge.emptyTrash(tabId, token) : window.api.knowledge.purge(ids, tabId, token);
    let result = await submit();
    while (result.status === "confirmation") {
        const preview = result;
        const text = (): string => t("dialog.purgeImpact", { count: preview.pages.length, titles: preview.pages.map(page => page.title).join(t("dialog.listJoin")) }) + (preview.links ? "\n" + t("dialog.deletedLinks", { count: preview.links }) : "");
        if (!await ask(() => t("dialog.purge"), text)) return false;
        result = await submit(result.token);
    }
    return true;
}