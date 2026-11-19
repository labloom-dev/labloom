import { LabloomError } from "../failure";
export function httpURL(value: string, base?: string): string {
    let url: URL;
    try {
        url = new URL(value, base);
    }
    catch {
        throw new LabloomError({ kind: "url-invalid" });
    }
    if (!value.trim() || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new LabloomError({ kind: "url-unsafe" });
    }
    url.hash = "";
    return url.href;
}