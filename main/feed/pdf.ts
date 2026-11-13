import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { feedURL } from "../../shared/utils/feed";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export const pdfLimits = { timeoutMs: 30000, maxBytes: 50 * 1024 * 1024 };

/** Downloads only the supplied PDF address, then lets PaperService own storage and deduplication. */
export async function importFeedPDF(
    url: string,
    attach: (path: string) => void,
    fetcher: Fetcher = fetch,
    limits = pdfLimits
): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("PDF 下载超时。")), limits.timeoutMs);
    let folder: string | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
        const response = await fetcher(feedURL(url), { signal: controller.signal, credentials: "omit", headers: { Accept: "application/pdf" } });
        if (!response.ok || !response.body) {
            await response.body?.cancel();
            throw new Error(`PDF 下载失败（HTTP ${response.status}）。`);
        }
        reader = response.body.getReader();
        if (Number(response.headers.get("content-length")) > limits.maxBytes) throw new Error("PDF 超过大小上限。");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limits.maxBytes) throw new Error("PDF 超过大小上限。");
            chunks.push(value);
        }
        const data = Buffer.concat(chunks);
        if (!data.subarray(0, 4).equals(Buffer.from("%PDF"))) throw new Error("响应不是 PDF 文件。");
        folder = await mkdtemp(join(tmpdir(), "labloom-feed-pdf-"));
        const path = join(folder, "article.pdf");
        await writeFile(path, data, { flag: "wx" });
        attach(path);
    }
    finally {
        clearTimeout(timer);
        await reader?.cancel().catch(() => {});
        if (folder) await rm(folder, { recursive: true, force: true });
    }
}