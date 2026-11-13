import { LabloomError } from "../shared/failure";
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { toFailureInfo } from "../shared/failure";

// Handlers live on one window's webContents and only answer its top-level page.
function fromMainFrame(contents: WebContents, event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return event.senderFrame === contents.mainFrame;
}

// Arguments come from the renderer, so they stay unknown until the handler validates them.
export function handle(contents: WebContents, channel: string, listener: (...args: unknown[]) => unknown): void {
    contents.ipc.handle(channel, async (event, ...args: unknown[]) => {
        try {
            if (!fromMainFrame(contents, event)) throw new LabloomError({ kind: "ipc-not-main-frame" });
            return { ok: true, value: await listener(...args) };
        }
        catch (error) {
            const failure = toFailureInfo(error);
            if (failure.diagnostic) console.error(channel, error);
            return { ok: false, failure };
        }
    });
}

export function on(contents: WebContents, channel: string, listener: (...args: unknown[]) => void): void {
    contents.ipc.on(channel, (event, ...args: unknown[]) => {
        if (fromMainFrame(contents, event)) listener(...args);
    });
}