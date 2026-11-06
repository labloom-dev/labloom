import type { AssistantConfig, AssistantMessage } from "../../../shared/types/assistant";
import type { PageSummary } from "../../../shared/types/knowledge";

export const assistantState = $state({
    config: null as AssistantConfig | null,
    messages: [] as AssistantMessage[],
    pages: [] as Pick<PageSummary, "id" | "title">[],
    question: "",
    request: "",
    cancelled: false,
    error: ""
});