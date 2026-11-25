import { Mark } from "@tiptap/core";
import { pastedURL } from "../../../../../shared/content/media";

export const webLinkClipboard = "application/x-labloom-web-links";
let clipboardPaste: { event: ClipboardEvent; parsed: boolean } | undefined;

export function readClipboardWebLinks(event: ClipboardEvent): boolean {
    if (event.clipboardData?.getData(webLinkClipboard) !== "1") return false;
    // ProseMirror parses the HTML in the same paste event.
    clipboardPaste = { event, parsed: false };
    queueMicrotask(() => {
        if (clipboardPaste?.event === event) clipboardPaste = undefined;
    });
    return true;
}

export function finishClipboardWebLinks(event: ClipboardEvent): boolean {
    if (clipboardPaste?.event !== event) return false;
    const { parsed } = clipboardPaste;
    clipboardPaste = undefined;
    return parsed;
}

export default Mark.create({
    name: "webLink", inclusive: false,
    addAttributes: () => ({ href: { default: null, parseHTML: () => null } }),
    parseHTML: () => [{ tag: "a.web-link[href]", getAttrs: element => {
        if (!clipboardPaste?.event.currentTarget) return false;
        const href = pastedURL(element.getAttribute("href") ?? "");
        if (!href || !/^https?:\/\//u.test(href)) return false;
        clipboardPaste.parsed = true;
        return { href };
    } }],
    renderHTML: ({ mark }) => ["a", { href: pastedURL(mark.attrs.href ?? ""), target: "_blank", rel: "noopener noreferrer", class: "web-link" }, 0]
});