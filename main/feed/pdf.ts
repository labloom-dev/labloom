import { LabloomError, diagnostic } from "../../shared/failure";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { feedURL } from "../../shared/utils/feed";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const pdfLimits = { timeoutMs: 30000, maxBytes: 50 * 1024 * 1024 };

/** Downloads the supplied PDF address; PaperService stores a new, independent attachment. */
export async function importFeedPDF(
    url: string,
    attach: (path: string) => void,
    fetcher: Fetcher = fetch,
    limits = pdfLimits,
    signal?: AbortSignal
): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new LabloomError({ kind: "pdf-download-timeout" })), limits.timeoutMs);
    const abort = (): void => {
        clearTimeout(timer); controller.abort(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let folder: string | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
        const response = await fetcher(feedURL(url), { signal: controller.signal, credentials: "omit", headers: { Accept: "application/pdf" } }).catch(error => {
            throw controller.signal.aborted ? controller.signal.reason : new LabloomError({ kind: "pdf-download-failed", diagnostic: diagnostic(error) }, { cause: error });
        });
        if (signal?.aborted) {
            await response.body?.cancel();
            return;
        }
        if (!response.ok || !response.body) {
            await response.body?.cancel();
            throw new LabloomError({ kind: "pdf-download-http", status: response.status });
        }
        reader = response.body.getReader();
        if (Number(response.headers.get("content-length")) > limits.maxBytes) throw new LabloomError({ kind: "pdf-too-large" });
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (; ;) {
            const { value, done } = await reader.read().catch(error => {
                throw controller.signal.aborted ? controller.signal.reason : new LabloomError({ kind: "pdf-download-failed", diagnostic: diagnostic(error) }, { cause: error });
            });
            if (done) break;
            size += value.length;
            if (size > limits.maxBytes) throw new LabloomError({ kind: "pdf-too-large" });
            chunks.push(value);
        }
        const data = Buffer.concat(chunks);
        if (!data.subarray(0, 4).equals(Buffer.from("%PDF"))) throw new LabloomError({ kind: "pdf-invalid-response" });
        folder = await mkdtemp(join(tmpdir(), "labloom-feed-pdf-"));
        const path = join(folder, "article.pdf");
        await writeFile(path, data, { flag: "wx" });
        if (!signal?.aborted) attach(path);
    }
    finally {
        signal?.removeEventListener("abort", abort);
        clearTimeout(timer);
        await reader?.cancel().catch(() => { });
        if (folder) await rm(folder, { recursive: true, force: true });
    }
}