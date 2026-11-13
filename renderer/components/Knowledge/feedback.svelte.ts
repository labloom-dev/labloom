import type { KnowledgeChange } from "../../../shared/types/content";
export { message } from "../../i18n.svelte";
import { failure, type ErrorValue } from "../../i18n.svelte";

export const knowledgeState = $state<{ change: KnowledgeChange & { seq: number }; error: ErrorValue; notice: string; busy: boolean }>({
    change: { sourceTab: "", pages: [], blocks: [], seq: 0 }, error: "", notice: "", busy: false
});
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string): void {
    clearTimeout(noticeTimer);
    knowledgeState.notice = text;
    noticeTimer = text ? setTimeout(() => knowledgeState.notice = "", 4000) : undefined;
}
export async function perform(action: () => Promise<void>): Promise<void> {
    try {
        knowledgeState.error = "";
        await action();
    }
    catch (error) {
        knowledgeState.error = failure(error);
    }
}