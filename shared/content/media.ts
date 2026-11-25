import type { Attachment } from "../types/papers";

export type MediaFile = Attachment & { path: string };

export const imageTypes = {
    png: "image/png", apng: "image/apng", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif",
    heic: "image/heic", heif: "image/heif", jxl: "image/jxl"
};

export const attachmentScheme = "labloom-file";
export const attachmentOrigin = attachmentScheme + "://workspace";

export function attachmentURL(id: string): string {
    return attachmentOrigin + "/" + id;
}

export function pastedURL(text: string, base?: string): string | undefined {
    if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(text)) return "data:" + text.slice(5);
    if (!text || /\s/u.test(text)) return;
    try {
        const url = new URL(text, base);
        if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
    }
    catch { /* The text is not a path or URL. */ }
    return undefined;
}

export function isImageURL(url: string): boolean {
    if (url.startsWith("data:")) return /^data:image\//i.test(url);
    const suffix = new URL(url).pathname.match(/\.([^/.]+)$/u)?.[1].toLowerCase();
    return suffix !== undefined && Object.hasOwn(imageTypes, suffix);
}