import { extname } from "node:path";
import { MIMEType } from "node:util";
import { type Attachment } from "../../shared/types/papers";

export type Metadata = Pick<Attachment, "originalName" | "mediaType">;
export const binary = "application/octet-stream";
const mediaTypes: Record<string, string> = {
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values",
    json: "application/json", xml: "application/xml", html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text", rtf: "application/rtf", epub: "application/epub+zip",
    zip: "application/zip", gz: "application/gzip", tar: "application/x-tar", "7z": "application/x-7z-compressed", rar: "application/vnd.rar",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime"
};

export function typeFor(name: string): string | undefined {
    const extension = extname(name).slice(1).toLowerCase();
    return Object.hasOwn(mediaTypes, extension) ? mediaTypes[extension] : undefined;
}

export function suffixFor(type: string): string {
    const extension = Object.keys(mediaTypes).find(key => mediaTypes[key] === type);
    return extension ? "." + extension : "";
}

// A response filename is display metadata. Keep only a usable final path component.
function safeName(name: string): string {
    return (name.split(/[\\/]/).pop() ?? "").replace(/[\p{Cc}<>:"|?*]/gu, "_").trim().replace(/[. ]+$/, "");
}

function dispositionName(header: string): string {
    let fallback = "";
    for (const match of header.matchAll(/;\s*([^=;\s]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/g)) {
        const key = match[1].toLowerCase(), value = match[2]?.replace(/\\(["\\])/g, "$1") ?? match[3].trim();
        if (key === "filename") fallback ||= safeName(value);
        if (key === "filename*") {
            const extended = /^([^']*)'[^']*'(.*)$/i.exec(value);
            if (!extended) continue;
            try {
                let decoded: string;
                if (/^utf-8$/i.test(extended[1])) decoded = decodeURIComponent(extended[2]);
                else if (/^iso-8859-1$/i.test(extended[1])) decoded = extended[2].replace(/%([\da-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
                else continue;
                const name = safeName(decoded);
                if (name) return name;
            }
            catch { /* Fall back to the ordinary filename if the encoding is malformed. */ }
        }
    }
    return fallback;
}

function urlName(url: string): string {
    const leaf = new URL(url).pathname.split("/").pop() ?? "";
    try {
        return safeName(decodeURIComponent(leaf));
    }
    catch {
        return safeName(leaf);
    }
}

function responseType(header: string | null): string | undefined {
    if (!header) return undefined;
    try {
        return new MIMEType(header).essence;
    }
    catch {
        return undefined;
    }
}

export function fromResponse(response: Response, url: string): Metadata {
    const declaredName = dispositionName(response.headers.get("content-disposition") ?? "");
    const leaf = response.url && urlName(response.url) || urlName(url);
    const declaredType = responseType(response.headers.get("content-type"));
    const mediaType = declaredType || typeFor(declaredName) || typeFor(leaf) || binary;
    return { originalName: declaredName || leaf || "attachment" + suffixFor(mediaType), mediaType };
}