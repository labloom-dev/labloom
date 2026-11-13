import type { PurgeResult } from "../../../shared/types/knowledge";
import { ask } from "./state.svelte";

export async function purgePages(ids: string[] | null, tabId: string): Promise<boolean> {
    const submit = (token?: string): Promise<PurgeResult> => ids === null ? window.api.knowledge.emptyTrash(tabId, token) : window.api.knowledge.purge(ids, tabId, token);
    let result = await submit();
    while (result.status === "confirmation") {
        const text = `将永久删除 ${result.pages.length} 个页面：${result.pages.map(page => page.title).join("、")}。此操作无法撤销。` + (result.links ? `\n${result.links} 个链接引用将显示“已删除”。` : "");
        if (!await ask("永久删除页面", text)) return false;
        result = await submit(result.token);
    }
    return true;
}