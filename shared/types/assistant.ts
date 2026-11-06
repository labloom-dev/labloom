export type AssistantConfig = { endpoint: string; model: string; hasKey: boolean };
export type AssistantSource = { id: string; title: string; number: number };
export type AssistantMessage = { role: "user" | "assistant"; content: string; sources?: AssistantSource[] };
export type AssistantRequest = { id: string; question: string; pageIds: string[]; history: AssistantMessage[] };
export interface AssistantAPI {
    config(): Promise<AssistantConfig>;
    configure(value: { endpoint: string; model: string; key?: string; clearKey?: boolean }): Promise<AssistantConfig>;
    ask(value: AssistantRequest): Promise<{ content: string; sources: AssistantSource[] }>;
    cancel(id: string): Promise<void>;
}