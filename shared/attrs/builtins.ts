import { annotationColors } from "../content/annotations";
import { type AttributeDefinition, type AttributeFormat, type AttributeValue } from "../types/attributes";

const option = (id: string, name: string): { id: string; name: string } => ({ id, name });
export const builtinAttrs = {
    deleted: { type: "boolean", name: "已删除", metadata: {} },
    independent: { type: "boolean", name: "独立保留", metadata: {} },
    created_at: { type: "minute", name: "创建时间", readonly: true, metadata: {} },
    modified_at: { type: "minute", name: "修改时间", readonly: true, metadata: {} },
    recycle_reason: { type: "select", name: "回收原因", hidden: true, readonly: true, metadata: { options: [option("manual_delete", "手动删除"), option("unreachable", "失去保留关系")] } },
    recycled_at: { type: "minute", name: "回收时间", hidden: true, readonly: true, metadata: {} },
    pinned: { type: "boolean", name: "固定到侧栏", metadata: {} },
    tags: { type: "multiselect", name: "标签", metadataEditable: true, metadata: { options: [] } },
    links: { type: "page-links", name: "关联页面", metadata: {} },
    paper_files: { type: "files", name: "附件", metadata: {} },
    paper_authors: { type: "string", name: "作者", metadata: {} },
    paper_doi: { type: "string", name: "DOI", metadata: {} },
    paper_year: { type: "string", name: "发表时间", metadata: {} },
    paper_venue: { type: "string", name: "期刊 / 会议", metadata: {} },
    paper_url: { type: "url", name: "原文地址", metadata: {} },
    paper_abstract: { type: "string", name: "摘要", metadata: {} },
    paper_keywords: { type: "string", name: "关键词", metadata: {} },
    source_snapshot: { type: "json", name: "原始来源", hidden: true, readonly: true, metadata: {} },
    reading_position: { type: "json", name: "阅读位置", hidden: true, readonly: true, metadata: {} },
    paper_annotations: { type: "page-links", name: "批注", hidden: true, readonly: true, metadata: {} },
    annotation_file: { type: "file", name: "文件", hidden: true, readonly: true, metadata: {} },
    annotation_position: { type: "json", name: "位置", hidden: true, readonly: true, metadata: {} },
    annotation_color: { type: "select", name: "颜色", metadata: { options: Object.entries(annotationColors).map(([id, item]) => option(id, item.name)) } },
    annotation_quote: { type: "string", name: "原文", readonly: true, metadata: {} },
    annotation_context: { type: "string", name: "上下文", hidden: true, readonly: true, metadata: {} },
    annotation_extractor: { type: "string", name: "提取器版本", hidden: true, readonly: true, metadata: {} },
    feed_url: { type: "url", name: "订阅地址", metadata: {} },
    feed_status: { type: "select", name: "订阅状态", metadata: { options: [option("enabled", "启用"), option("paused", "暂停"), option("cancelled", "已取消")] } },
    feed_refresh: { type: "recurrence", name: "刷新间隔", metadata: {} },
    feed_last_refreshed: { type: "minute", name: "上次成功刷新", hidden: true, readonly: true, metadata: {} },
    feed_last_checked: { type: "minute", name: "上次尝试刷新", hidden: true, readonly: true, metadata: {} },
    feed_last_added: { type: "number", name: "上次新增条目数", hidden: true, readonly: true, metadata: {} },
    feed_error: { type: "string", name: "错误", hidden: true, readonly: true, metadata: {} },
    feed_failures: { type: "number", name: "连续失败次数", hidden: true, readonly: true, metadata: {} },
    feed_etag: { type: "string", name: "ETag", hidden: true, readonly: true, metadata: {} },
    feed_last_modified: { type: "string", name: "Last-Modified", hidden: true, readonly: true, metadata: {} },
    task_status: { type: "select", name: "状态", metadata: { options: [option("todo", "未开始"), option("doing", "进行中"), option("done", "已完成")] } },
    priority: { type: "select", name: "优先级", metadata: { options: [option("low", "低"), option("normal", "普通"), option("high", "高")] } },
    schedule_date: { type: "day", name: "日期", metadata: {} },
    schedule_start: { type: "minute", name: "开始时间", metadata: {} },
    schedule_end: { type: "minute", name: "结束时间", metadata: {} }
} satisfies Record<string, Omit<AttributeDefinition, "id"> & { metadataEditable?: boolean }>;

export function editableBuiltinMetadata(id: BuiltinAttrId): boolean {
    const definition = builtinAttrs[id];
    return "metadataEditable" in definition && definition.metadataEditable === true;
}

export type BuiltinAttrId = keyof typeof builtinAttrs;
export type BuiltinAttrValues = { [Id in BuiltinAttrId]: AttributeValue };
const common = ["deleted", "independent", "created_at", "modified_at", "recycle_reason", "recycled_at", "pinned", "tags", "links"] as const;
const schedule = ["schedule_date", "schedule_start", "schedule_end"] as const;
export const builtinAttrsByPageKind = {
    editable: [...common],
    paper: [...common, "paper_files", "paper_authors", "paper_doi", "paper_year", "paper_venue", "paper_url", "paper_abstract", "paper_keywords", "source_snapshot", "reading_position", "paper_annotations"],
    annotation: [...common, "annotation_file", "annotation_position", "annotation_color", "annotation_quote", "annotation_context", "annotation_extractor"],
    task: [...common, "task_status", "priority", ...schedule],
    event: [...common, ...schedule],
    feed: [...common, "feed_url", "feed_status", "feed_refresh", "feed_last_refreshed", "feed_last_checked", "feed_last_added", "feed_error", "feed_failures", "feed_etag", "feed_last_modified"]
} as const satisfies Record<string, readonly BuiltinAttrId[]>;

export function isBuiltin(id: string): id is BuiltinAttrId {
    return Object.hasOwn(builtinAttrs, id);
}

// Presentation overrides stay outside the serializable attribute definitions.
export const builtinValueFormats: Partial<Record<BuiltinAttrId, { display?: AttributeFormat; search?: AttributeFormat }>> = {
    recycle_reason: { search: () => "" },
    recycled_at: { search: () => "" },
    ...Object.fromEntries(["annotation_file", "annotation_position", "annotation_context", "annotation_extractor", "feed_last_refreshed", "feed_last_checked", "feed_last_added", "feed_error", "feed_failures", "feed_etag", "feed_last_modified"].map(id => [id, { search: () => "" }]))
};