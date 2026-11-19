import { randomUUID } from "node:crypto";
import { readdirSync, unlinkSync } from "node:fs";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { LabloomError, diagnostic } from "../../shared/failure";
import { httpURL } from "../../shared/utils/url";
import * as metadata from "./metadata";

export type DownloadOptions = { expectedType?: string; timeoutMs?: number };
type Request = DownloadOptions & { directory: string; fetcher: typeof fetch; signal: AbortSignal };

export const pdfHeader = Buffer.from("%PDF-");
const active = new Set<string>();

// Only staging files left by interrupted downloads are candidates. A previous session may still be closing its handle.
export function discardInterrupted(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^\.download-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.part$/.test(entry.name)) continue;
        const path = join(directory, entry.name);
        if (!active.has(path)) unlinkSync(path);
    }
}

async function stage<T>(directory: string, chunks: AsyncIterable<Uint8Array>, publish: (path: string) => T): Promise<T> {
    // The temporary file and its final name are on the same volume.
    const path = join(directory, ".download-" + randomUUID() + ".part");
    active.add(path);
    let owned = false;
    try {
        const file = await open(path, "wx");
        owned = true;
        try {
            for await (const chunk of chunks) await file.writeFile(chunk);
        }
        finally {
            await file.close();
        }
        return publish(path);
    }
    finally {
        try {
            if (owned) await rm(path, { force: true });
        }
        finally {
            active.delete(path);
        }
    }
}

export async function receive<T>(url: string, request: Request, save: (path: string, info: metadata.Metadata) => T): Promise<T> {
    const address = httpURL(url), expected = request.expectedType?.trim().toLowerCase();
    const controller = new AbortController(), signal = AbortSignal.any([request.signal, controller.signal]);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const startWaiting = (): void => {
        idle = setTimeout(() => controller.abort(new LabloomError({ kind: "download-timeout" })), request.timeoutMs ?? 30_000);
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = (): void => {
        void reader?.cancel(signal.reason).catch(() => {});
    };
    function networkFailure(error: unknown): never {
        signal.throwIfAborted();
        throw new LabloomError({ kind: "download-failed", diagnostic: diagnostic(error) }, { cause: error });
    }

    async function* chunks(): AsyncGenerator<Uint8Array> {
        let checked = 0;
        startWaiting();
        while (reader) {
            const { done, value } = await reader.read().catch(networkFailure);
            signal.throwIfAborted();
            if (done) break;
            if (!value.byteLength) continue;
            clearTimeout(idle);
            if (expected === "application/pdf" && checked < pdfHeader.length) {
                const prefix = value.subarray(0, pdfHeader.length - checked);
                if (!pdfHeader.subarray(checked, checked + prefix.length).equals(prefix)) throw new LabloomError({ kind: "pdf-invalid-response" });
                checked += prefix.length;
            }
            yield value;
            startWaiting();
        }
        clearTimeout(idle);
        if (expected === "application/pdf" && checked !== pdfHeader.length) throw new LabloomError({ kind: "pdf-invalid-response" });
    }

    signal.addEventListener("abort", cancel, { once: true });
    startWaiting();
    try {
        signal.throwIfAborted();
        const response = await request.fetcher(address, { credentials: "omit", headers: { Accept: expected ?? "*/*" }, signal }).catch(networkFailure);
        clearTimeout(idle);
        reader = response.body?.getReader();
        signal.throwIfAborted();
        if (!response.ok) throw new LabloomError({ kind: "download-http", status: response.status });
        const info = metadata.fromResponse(response, address);
        if (expected === "application/pdf") info.mediaType = expected; // Verified from the bytes, including on extensionless URLs.
        else if (expected && expected !== info.mediaType) throw new LabloomError({ kind: "download-type-mismatch", expected, actual: info.mediaType });
        return await stage(request.directory, chunks(), path => {
            signal.throwIfAborted();
            return save(path, info);
        });
    }
    finally {
        signal.removeEventListener("abort", cancel);
        clearTimeout(idle);
        if (reader) {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    }
}