import { type AttributeDefinition, type AttributeFormat, type AttributeValue } from "../types/attributes";

const option = (id: string, name: string): { id: string; name: string } => ({ id, name });
export const builtinAttrs = {
    deleted: { type: "boolean", metadata: {} },
    independent: { type: "boolean", metadata: { name: "独立保留" } },
    created_at: { type: "datetime", metadata: { name: "创建时间", readonly: true } },
    modified_at: { type: "datetime", metadata: { name: "修改时间", readonly: true } },
    recycle_reason: { type: "select", metadata: { name: "回收原因", hidden: true, readonly: true, options: [option("manual_delete", "手动删除"), option("unreachable", "失去保留关系")] } },
    recycled_at: { type: "datetime", metadata: { name: "回收时间", hidden: true, readonly: true } },
    pinned: { type: "boolean", metadata: { name: "固定到侧栏" } },
    tags: { type: "multiselect", metadata: { name: "标签", options: [] } },
    links: { type: "page-links", metadata: { name: "关联页面" } },
    paper_authors: { type: "string", metadata: { name: "作者" } },
    paper_doi: { type: "string", metadata: { name: "DOI" } },
    paper_year: { type: "string", metadata: { name: "发表时间" } },
    paper_venue: { type: "string", metadata: { name: "期刊 / 会议" } },
    paper_url: { type: "url", metadata: { name: "原文地址" } },
    paper_abstract: { type: "string", metadata: { name: "摘要" } },
    paper_keywords: { type: "string", metadata: { name: "关键词" } },
    source_snapshot: { type: "json", metadata: { name: "原始来源", hidden: true, readonly: true } },
    reading_position: { type: "json", metadata: { name: "阅读位置", hidden: true, readonly: true } },
    annotation_paper: { type: "page-link", metadata: { name: "来源文献", readonly: true } },
    annotation_anchor: { type: "string", metadata: { name: "原文锚点", hidden: true, readonly: true } },
    task_status: { type: "select", metadata: { name: "状态", options: [option("todo", "未开始"), option("doing", "进行中"), option("done", "已完成")] } },
    priority: { type: "select", metadata: { name: "优先级", options: [option("low", "低"), option("normal", "普通"), option("high", "高")] } },
    schedule_date: { type: "date", metadata: { name: "日期" } },
    schedule_start: { type: "datetime", metadata: { name: "开始时间" } },
    schedule_end: { type: "datetime", metadata: { name: "结束时间" } },
    schedule_zone: { type: "string", metadata: { name: "时区" } },
    reminder_at: { type: "datetime", metadata: { name: "提醒时间" } }
} satisfies Record<string, Omit<AttributeDefinition, "id">>;

export type BuiltinAttrId = keyof typeof builtinAttrs;
export type BuiltinAttrValues = { [Id in BuiltinAttrId]: AttributeValue };
const common = ["deleted", "independent", "created_at", "modified_at", "recycle_reason", "recycled_at", "pinned", "tags", "links"] as const;
const schedule = ["schedule_date", "schedule_start", "schedule_end", "schedule_zone", "reminder_at"] as const;
export const builtinAttrsByPageKind = {
    editable: [...common],
    paper: [...common, "paper_authors", "paper_doi", "paper_year", "paper_venue", "paper_url", "paper_abstract", "paper_keywords", "source_snapshot", "reading_position"],
    annotation: [...common, "annotation_paper", "annotation_anchor"],
    task: [...common, "task_status", "priority", ...schedule],
    event: [...common, ...schedule]
} as const satisfies Record<string, readonly BuiltinAttrId[]>;

export function isBuiltin(id: string): id is BuiltinAttrId {
    return Object.hasOwn(builtinAttrs, id);
}

// Presentation overrides stay outside the serializable attribute definitions.
export const builtinValueFormats: Partial<Record<BuiltinAttrId, { display?: AttributeFormat; search?: AttributeFormat }>> = {
    recycle_reason: { search: () => "" },
    recycled_at: { search: () => "" },
    annotation_anchor: { search: () => "" }
};