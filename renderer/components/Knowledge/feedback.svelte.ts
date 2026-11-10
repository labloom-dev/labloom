import type { KnowledgeChange } from "../../../shared/types/content";

export const knowledgeState = $state<{ change: KnowledgeChange & { seq: number }; error: string; busy: boolean }>({
    change: { sourceTab: "", pages: [], blocks: [], seq: 0 }, error: "", busy: false
});
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