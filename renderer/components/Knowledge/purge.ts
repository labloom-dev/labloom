import type { PurgeResult } from "../../../shared/types/knowledge";
import { ask } from "./confirmation.svelte";
import { t } from "../../i18n.svelte";

export async function purgePages(ids: string[] | null): Promise<boolean> {
    const submit = (token?: string): Promise<PurgeResult> => ids === null ? window.api.pages.emptyTrash(token) : window.api.pages.purge(ids, token);
    let result = await submit();
    while (result.status === "confirmation") {
        const preview = result;
        const count = preview.pages.length;
        const text = (): string => t(count === 1 ? "dialog.purgeOne" : "dialog.purgeImpact", { count })
            + (preview.links ? "\n" + t("dialog.deletedLinks", { count: preview.links }) : "");
        if (!await ask(() => t("dialog.purge"), text, preview.pages.map(page => page.title), true)) return false;
        result = await submit(result.token);
    }
    return true;
}