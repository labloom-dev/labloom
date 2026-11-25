import { DOMParser as DocumentParser, type Node as DocNode, type Schema } from "@tiptap/pm/model";
import { pastedURL } from "../../../shared/content/media";
import { LabloomError } from "../../../shared/failure";
import { blankBlock } from "./document";
import { mediaNode, probeMedia, uploadImage, type MediaInsertions, type MediaJob } from "./media-insert";

export type WebPart = { url: string } | { row: DocNode };
type WebContent = { fragment: DocumentFragment; images: { url: string; element: Element }[]; imageCount: number; hasText: boolean };

export function readWebContent(html: string, base?: string): WebContent {
    const template = document.createElement("template");
    template.innerHTML = html;
    const fragment = template.content;
    const declared = fragment.querySelector("base[href]")?.getAttribute("href");
    const origin = declared ? pastedURL(declared, base) : base;
    fragment.querySelectorAll("title,script,style,iframe,object,embed").forEach(element => element.remove());
    const elements = [...fragment.querySelectorAll("img")];
    const images = elements.flatMap(element => {
        const src = element.getAttribute("src")?.trim(), url = src && pastedURL(src, origin);
        return url ? [{ url, element }] : [];
    });
    return { fragment, images, imageCount: elements.length, hasText: !!fragment.textContent?.trim() };
}

export function uri(data: DataTransfer): string | undefined {
    const line = data.getData("text/uri-list").split(/\r?\n/u).find(value => value && !value.startsWith("#"));
    return line ? pastedURL(line.trim()) : undefined;
}

export function webParts(schema: Schema, { fragment, images }: WebContent): WebPart[] | undefined {
    if (!images.length) return;
    const parts: WebPart[] = [], range = fragment.ownerDocument.createRange(), parser = DocumentParser.fromSchema(schema);
    range.selectNodeContents(fragment);
    function append(content: DocumentFragment): void {
        const elements = [...content.querySelectorAll("li,p")].filter(el => el.tagName === "LI" || !el.closest("li"));
        for (const element of elements.length ? elements : [content]) {
            const editable = element.cloneNode(true) as Element | DocumentFragment;
            editable.querySelectorAll("ul,ol,img").forEach(child => child.remove());
            const field = parser.parse(editable, { topNode: schema.nodes.blockBody.create() });
            if (!field.textContent.trim() && !field.content.content.some(child => child.isAtom)) continue;
            const parent = element instanceof Element && element.tagName === "LI" ? element.parentElement?.tagName : undefined;
            const row = blankBlock(schema, parent === "OL" ? "ordered_list" : parent === "UL" ? "unordered_list" : "paragraph");
            parts.push({ row: row.copy(row.content.replaceChild(0, field)) });
        }
    }
    for (const { url, element } of images) {
        range.setEndBefore(element);
        append(range.cloneContents());
        parts.push({ url });
        range.setEnd(fragment, fragment.childNodes.length);
        range.setStartAfter(element);
    }
    append(range.cloneContents());
    return parts;
}

export function urlText(schema: Schema, url: string): DocNode {
    return schema.text(url, [schema.marks.webLink.create({ href: url })]);
}

export async function onlineNodes(schema: Schema, parts: WebPart[], job: MediaJob, transfers: MediaInsertions): Promise<DocNode[]> {
    const inputs = parts.flatMap(part => "url" in part ? [part.url] : []);
    const signal = job.cancel.signal;
    const images = await transfers.collect(job, inputs, url => url, async (url, id) => {
        const file = url.startsWith("data:")
            ? await uploadImage({ name: "", blob: await fetch(url, { signal }).then(response => response.blob()) },
                id, signal, (bytes, length) => transfers.progress(job, bytes, length))
            : await window.api.attachments.downloadImage(id, url);
        job.files.push(file.id);
        const media = await probeMedia(file, signal);
        if (media.kind !== "image") throw new LabloomError({ kind: "attachment-image-decode" });
        return mediaNode(schema, media.kind, media.data);
    });
    let index = 0;
    return parts.map(part => {
        if ("row" in part) return part.row;
        const node = images[index++];
        if (node) return node;
        const row = blankBlock(schema);
        return row.copy(row.content.replaceChild(0, schema.nodes.blockBody.create(null, urlText(schema, part.url))));
    });
}