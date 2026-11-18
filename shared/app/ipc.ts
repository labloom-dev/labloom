export type AppCommands = {
    openDevTools(): void;
    editorStarted(): void;
    beforeQuit(check: () => Promise<boolean> | boolean): () => void;
};
export type AppMessages = Omit<AppCommands, "beforeQuit"> & {
    beforeQuitResult(id: string, blocked: boolean): void;
};
export const appChannels = {
    openDevTools: "app:open-devtools",
    editorStarted: "app:editor-started",
    beforeQuitResult: "app:before-quit-result"
} as const satisfies Record<keyof AppMessages, string>;
export const beforeQuit = "app:before-quit";