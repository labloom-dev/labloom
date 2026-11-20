export type AppCommands = {
    openDevTools(): void;
    setFrameColors(color: string, symbolColor: string): void;
    editorStarted(): void;
    beforeQuit(check: () => Promise<boolean> | boolean): () => void;
};
export type AppMessages = Omit<AppCommands, "beforeQuit"> & {
    beforeQuitResult(id: string, blocked: boolean): void;
};
export const appChannels = {
    openDevTools: "app:open-devtools",
    setFrameColors: "app:set-frame-colors",
    editorStarted: "app:editor-started",
    beforeQuitResult: "app:before-quit-result"
} as const satisfies Record<keyof AppMessages, string>;
export const beforeQuit = "app:before-quit";