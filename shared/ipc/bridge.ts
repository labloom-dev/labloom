import { LabloomError, type FailureInfo } from "../failure";

export type IPCReply<T> = { ok: true; value: T } | { ok: false; failure: FailureInfo };
export type BridgeAPI<T> = { [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<IPCReply<R>> : T[K] extends (...args: never[]) => unknown ? T[K] : BridgeAPI<T[K]> };

/** Unwrap in the renderer: contextBridge does not preserve custom properties of thrown Errors. */
export function connectAPI<T>(bridge: BridgeAPI<T>): T {
    return Object.fromEntries(Object.entries(bridge as object).map(([key, value]) => [key, typeof value === "function" ? (...args: unknown[]) => {
        const result = value(...args);
        return result && typeof result.then === "function" ? result.then((reply: IPCReply<unknown>) => {
            if (!reply.ok) throw new LabloomError(reply.failure);
            return reply.value;
        }) : result;
    } : connectAPI(value)])) as T;
}