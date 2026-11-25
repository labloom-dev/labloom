import { type ContentBlockKind, type PageKind } from "../../../shared/types/content";
import { type IconName } from "../utils/Icon.svelte";
export const kindIcons: Record<PageKind, IconName> = { editable: "edit", paper: "book", annotation: "edit", feed: "rss" };
export const blockIcons: Record<ContentBlockKind, IconName> = {
    title: "edit", paragraph: "paragraph", heading_1: "heading-1", heading_2: "heading-2", heading_3: "heading-3",
    unordered_list: "list-unordered", ordered_list: "list-ordered", blockquote: "quote", callout: "info",
    code: "code", table: "table", hr: "horizontal-rule", blocked_reference: "link-external",
    image: "file-media", video: "play-circle", file: "file"
};