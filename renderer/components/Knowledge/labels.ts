import { type PageKind } from "../../../shared/types/content";
import { type IconName } from "../utils/Icon.svelte";
export const kindNames: Record<PageKind, string> = { editable: "笔记", paper: "文献", annotation: "批注", task: "任务", event: "日程", feed: "订阅源" };
export const kindIcons: Record<PageKind, IconName> = { editable: "pen", paper: "book", annotation: "pen", task: "calendar", event: "calendar", feed: "feed" };