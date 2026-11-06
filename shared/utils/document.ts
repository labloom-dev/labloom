import type { DocumentNode } from "../types/knowledge";

export function documentText(node: DocumentNode): string {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "pageReference") return String(node.attrs?.title ?? "页面链接");
    return (node.content ?? []).map(documentText).join(["doc", "bulletList", "orderedList", "listItem", "blockquote"].includes(node.type) ? "\n" : "");
}