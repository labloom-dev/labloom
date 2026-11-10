import type { KnowledgeChange } from "../../../shared/types/content";

export const knowledgeState = $state<{ change: KnowledgeChange & { seq: number }; error: string; notice: string; busy: boolean }>({
    change: { sourceTab: "", pages: [], blocks: [], seq: 0 }, error: "", notice: "", busy: false
});
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string): void {
    clearTimeout(noticeTimer);
    knowledgeState.notice = text;
    noticeTimer = text ? setTimeout(() => knowledgeState.notice = "", 4000) : undefined;
}
export const message = (error: unknown): string => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : String(error);
export async function perform(action: () => Promise<void>): Promise<void> {
    try {
        knowledgeState.error = "";
        await action();
    }
    catch (error) {
        knowledgeState.error = message(error);
    }
}