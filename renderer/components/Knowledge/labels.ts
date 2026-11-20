import { type PageKind } from "../../../shared/types/content";
import { type IconName } from "../utils/Icon.svelte";
export const kindNames: Record<PageKind, string> = { editable: "笔记", paper: "文献", annotation: "批注", feed: "订阅源" };
export const kindIcons: Record<PageKind, IconName> = { editable: "edit", paper: "book", annotation: "edit", feed: "rss" };