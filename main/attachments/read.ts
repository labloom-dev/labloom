import { lstat, open } from "node:fs/promises";
import { Readable } from "node:stream";
import { validUUID } from "../../shared/attrs/values";
import { attachmentOrigin } from "../../shared/content/media";
import { attachmentPath } from "../storage/files";
import * as workspace from "../workspace-state";
import { storedAttachment } from "./service";

function byteRange(header: string, size: number): { start: number; end: number } | null {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
    if (!match || !size || !match[1] && !match[2]) return null;
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    return start <= end ? { start, end } : null;
}

export async function readAttachment(request: Request): Promise<Response> {
    const missing = (): Response => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const prefix = attachmentOrigin + "/", id = request.url.slice(prefix.length);
    if (!request.url.startsWith(prefix) || !validUUID(id) || !workspace.ready()) return missing();
    const session = workspace.requireWorkspace(), row = storedAttachment(id);
    if (!row) return missing();
    const signal = AbortSignal.any([session.controller.signal, request.signal]);
    try {
        const path = attachmentPath(session.info.path, row.storedName);
        const stat = await lstat(path);
        if (!stat.isFile() || stat.size !== row.size || signal.aborted) return missing();
        const headers = new Headers({
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Content-Type": row.mediaType,
            "X-Content-Type-Options": "nosniff"
        });
        if (!/^(?:image|video|audio)\//.test(row.mediaType)) headers.set("Content-Disposition", "attachment");
        const range = request.method === "GET" && request.headers.get("range");
        const bounds = range ? byteRange(range, stat.size) : { start: 0, end: stat.size - 1 };
        if (!bounds) {
            headers.set("Content-Range", "bytes */" + stat.size);
            return new Response(null, { status: 416, headers });
        }
        const { start, end } = bounds;
        headers.set("Content-Length", String(end - start + 1));
        if (range) headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        const status = range ? 206 : 200;
        if (request.method === "HEAD" || !stat.size) return new Response(null, { status, headers });
        const file = await open(path, "r");
        if (signal.aborted) {
            await file.close();
            return missing();
        }
        // Count queued chunks explicitly. The filesystem high-water mark is measured in bytes.
        const stream = file.createReadStream({ start, end, signal });
        const body = Readable.toWeb(stream, { strategy: { highWaterMark: 1 } }) as ReadableStream<Uint8Array>;
        return new Response(body, { status, headers });
    }
    catch {
        return missing();
    }
}