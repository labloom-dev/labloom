import type Database from "better-sqlite3";
import { builtinAttrs, builtinAttrsByPageKind } from "../../shared/attrs/builtins";
import { defaultValue, encodeValue } from "../../shared/attrs/values";
import { payload } from "../../shared/content/blocks";
import type { AttributeValue } from "../../shared/types/attributes";

// The same row, block, tag and timestamp sequence is used by every library benchmark.
export function seedLibrary(sql: Database.Database): void {
    const block = sql.prepare("INSERT INTO blocks(id,type,content,children) VALUES(?,?,?,'[]')");
    const page = sql.prepare("INSERT INTO pages(id,kind,title_block_id,children) VALUES(?,?,?,?)");
    const attr = sql.prepare("INSERT INTO page_attrs(page_id,attr_id,value) VALUES(?,?,?)");
    const annotation = sql.prepare("INSERT INTO link_refs(source_kind, source_id, source_field, target_kind, target_id) VALUES('page',?,'paper_annotations','page',?)");
    const options = ["光谱", "Climate", "生态", "Methods", "海洋", "Review"].map((name, i) => ({ id: "tag-" + i, name }));
    const id = (n: number): string => "10000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
    sql.transaction(() => {
        sql.prepare("UPDATE attrs_meta SET metadata=? WHERE id='tags'").run(JSON.stringify({ options }));
        for (let i = 0; i < 10000; i++) {
            const kind = i % 2 === 0 ? "paper" : i % 10 === 1 ? "annotation" : "editable", chinese = i % 4 < 2;
            const title = (kind === "annotation" ? (chinese ? "批注" : "Annotation") : chinese ? "海洋观测" : "Coastal survey") + " " + i.toString().padStart(5, "0");
            const pageId = id(i * 3), titleId = id(i * 3 + 1), bodyId = id(i * 3 + 2);
            block.run(titleId, "title", JSON.stringify(payload("title", title)));
            if (kind !== "paper") block.run(bodyId, "paragraph", JSON.stringify(payload("paragraph", (chinese ? "采样记录 " : "Sampling log ") + i)));
            page.run(pageId, kind, titleId, JSON.stringify(kind === "paper" ? [] : [bodyId]));
            const values: Record<string, AttributeValue> = {
                independent: kind !== "annotation", paper_annotations: i % 10 === 0 ? [id((i + 1) * 3)] : [], created_at: 1609459200 + i * 60, modified_at: 1704067200 + ((i * 7919) % 10000) * 60,
                pinned: i % 97 === 0, tags: i % 29 ? [options[i % 6].id, options[(i + 1) % 6].id] : [],
                paper_authors: i % 71 ? (chinese ? "张明" : "A. Brown") + " " + i : "",
                paper_year: i % 83 ? String(1970 + i % 57) : "", paper_venue: i % 67 ? (chinese ? "海洋科学" : "Ocean Science") + " " + (i % 103) : "",
                paper_doi: i % 79 ? "10.1234/coast." + i : "", paper_keywords: i % 73 ? (chinese ? "监测，海岸 " : "monitoring, coast ") + i : "",
                paper_abstract: (chinese ? "季节性海岸观测。" : "Seasonal coastal observations. ") + i
            };
            if (kind === "annotation") annotation.run(id((i - 1) * 3), pageId);
            for (const key of builtinAttrsByPageKind[kind]) {
                const def = { ...builtinAttrs[key], id: key, ...(key === "tags" ? { metadata: { options } } : {}) };
                const value = encodeValue(def, values[key] ?? defaultValue(def.type));
                attr.run(pageId, key, typeof value === "number" ? BigInt(value) : value);
            }
        }
    })();
}