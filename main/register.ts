import type { BrowserWindow } from "electron";
import { registerAppIPCs } from "./app/ipc";
import { registerPagesIPCs } from "./pages/ipc";
import { registerAttributesIPCs } from "./attributes/ipc";
import { registerHistoryIPCs } from "./history/ipc";
import { registerPapersIPCs } from "./papers/ipc";
import { registerAttachmentIPCs } from "./attachments/ipc";
import { registerTimersIPCs } from "./timers/ipc";
import { registerWorkspaceIPCs } from "./workspace/ipc";
import { registerSettingsIPCs } from "./settings/ipc";
import { registerStartupIPCs } from "./startup/ipc";
import { registerFeedIPCs } from "./feed/ipc";

export function registerIPCs(window: BrowserWindow, rememberWindow: () => void): void {
    registerAppIPCs(window);
    registerPagesIPCs(window);
    registerAttributesIPCs(window);
    registerHistoryIPCs(window);
    registerPapersIPCs(window);
    registerAttachmentIPCs(window);
    registerTimersIPCs(window);
    registerWorkspaceIPCs(window);
    registerSettingsIPCs(window, rememberWindow);
    registerStartupIPCs(window);
    registerFeedIPCs(window);
}