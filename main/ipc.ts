import type { InvokeKeys } from "../shared/ipc/contract";
import { LabloomError } from "../shared/failure";
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { toFailureInfo } from "../shared/failure";

// Handlers live on one window's webContents and only answer its top-level page.
function fromMainFrame(contents: WebContents, event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return event.senderFrame === contents.mainFrame;
}

export function handle(contents: WebContents, channel: string, listener: (...args: unknown[]) => unknown): void {
    contents.ipc.handle(channel, async (event, ...args: unknown[]) => {
        try {
            if (!fromMainFrame(contents, event)) throw new LabloomError({ kind: "ipc-not-main-frame" });
            return { ok: true, value: await listener(...args) };
        }
        catch (error) {
            const failure = toFailureInfo(error);
            if (failure.diagnostic) console.error(channel, failure);
            return { ok: false, failure };
        }
    });
}

export function on(contents: WebContents, channel: string, listener: (...args: unknown[]) => void): void {
    contents.ipc.on(channel, (event, ...args: unknown[]) => {
        if (!fromMainFrame(contents, event)) return;
        try {
            listener(...args);
        }
        catch (error) {
            console.error(channel, toFailureInfo(error));
        }
    });
}

export function invalid({ path, expected }: { path?: string; expected: string }): LabloomError {
    return new LabloomError({ kind: "invalid-argument", diagnostic: `${path ?? "$input"}: expected ${expected}` });
}
export function route<Args extends unknown[], Result>(check: (input: unknown) => Args, run: (...args: NoInfer<Args>) => Result): ((...raw: unknown[]) => Result) & { check(input: unknown): Args } {
    return Object.assign((...raw: unknown[]) => run(...check(raw)), { check });
}
type Route<Method> = Method extends (...args: infer Args) => infer Result
    ? ((...raw: unknown[]) => Awaited<Result> | Result) & { check(input: unknown): Args } : never;
export type Routes<API> = { [Key in InvokeKeys<API>]: Route<API[Key]> };
export type Messages<API> = { [Key in keyof API]: Route<API[Key]> };
export function register<Key extends string>(contents: WebContents, channels: Record<Key, string>, routes: Record<NoInfer<Key>, (...args: unknown[]) => unknown>, bind = handle): void {
    for (const key in channels) bind(contents, channels[key], routes[key]);
}