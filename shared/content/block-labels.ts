import { type ContentBlockKind } from "../types/content";

export const kinds = [["paragraph", "段落"], ["heading_1", "一级标题"], ["heading_2", "二级标题"], ["heading_3", "三级标题"], ["unordered_list", "无序列表"], ["ordered_list", "有序列表"], ["blockquote", "引用"], ["callout", "提示框"], ["code", "代码"], ["table", "表格"], ["hr", "分隔线"]] as const;

export const blockKindNames: Record<ContentBlockKind, string> = {
    ...Object.fromEntries(kinds), title: "标题", blocked_reference: "链接引用", source: "原文片段"
} as Record<ContentBlockKind, string>;