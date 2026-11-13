import zhCN from "../locales/zh-CN.json";
import { type Translate } from "./i18n";

export type FailureKind = keyof typeof zhCN.failure;
type Details = {
    "workspace-not-workspace": { path: string };
    "workspace-folder-missing": { path: string };
    "file-missing": { path: string };
    "attribute-invalid-value": { attrId: string; name: string; type: string };
    "attribute-invalid-metadata": { type: string };
    "attribute-builtin-missing": { attrId: string };
    "attribute-builtin-storage": { attrId: string };
    "attribute-builtin-metadata-storage": { attrId: string };
    "feed-denied": { status: number };
    "feed-address-missing": { status: number };
    "feed-unavailable": { status: number };
    "feed-http": { status: number };
    "pdf-download-http": { status: number };
    "block-missing": { blockId: string };
};
export type FailureInfo = { [K in FailureKind]: { kind: K; diagnostic?: string } & (K extends keyof Details ? Details[K] : object) }[FailureKind];

/** Application errors contain identifiers and data. Only external exceptions supply diagnostic text. */
export class LabloomError extends Error {
    constructor(readonly failure: FailureInfo, options?: ErrorOptions) {
        super(failure.kind, options);
    }
}

export function diagnostic(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function isFailureInfo(value: unknown): value is FailureInfo {
    return !!value && typeof value === "object" && "kind" in value && typeof value.kind === "string" && Object.hasOwn(zhCN.failure, value.kind);
}

/** Filesystem/SQLite/PDF exceptions are classified once at the process or operation boundary. */
export function toFailureInfo(error: unknown): FailureInfo {
    if (error instanceof LabloomError) return error.failure;
    if (isFailureInfo(error)) return error;
    const native = error as { code?: string | number; name?: string; path?: string } | null;
    const detail = diagnostic(error);
    if (native?.name === "PasswordException") return { kind: native.code === 2 ? "pdf-password-incorrect" : "pdf-password-required", diagnostic: detail };
    if (native?.name === "InvalidPDFException" || native?.name === "MissingPDFException") return { kind: "pdf-unavailable", diagnostic: detail };
    switch (native?.code) {
        case "ENOENT": case "ENOTDIR": return { kind: "file-missing", path: native.path ?? "", diagnostic: detail };
        case "EACCES": case "EPERM": return { kind: "file-access-denied", diagnostic: detail };
        case "SQLITE_CANTOPEN": return { kind: "file-access-denied", diagnostic: detail };
        case "SQLITE_READONLY": return { kind: "database-readonly", diagnostic: detail };
        case "ENOSPC": case "SQLITE_FULL": return { kind: "disk-full", diagnostic: detail };
        case "SQLITE_NOTADB": case "SQLITE_CORRUPT": return { kind: "workspace-corrupt", diagnostic: detail };
        default: return { kind: "unexpected", diagnostic: detail };
    }
}

export function failureText(t: Translate, failure: FailureInfo): string {
    return t(`failure.${failure.kind}`, { ...failure });
}

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