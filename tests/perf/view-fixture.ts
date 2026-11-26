import type Database from "better-sqlite3";
import { emptyValue, encodeValue } from "../../shared/attrs/values";
import { secondsPerDay } from "../../shared/content/time";
import type { AttributeDefinition, AttributeValue } from "../../shared/types/attributes";
import { columnField, type TableParams } from "../../shared/workspace/table";
import { seedLibrary } from "./library-fixture";

export const viewFields = {
    status: "custom:20000000-0000-4000-8000-000000000001",
    category: "custom:20000000-0000-4000-8000-000000000002",
    multiple: "custom:20000000-0000-4000-8000-000000000003",
    date: "custom:20000000-0000-4000-8000-000000000004",
    project: "custom:20000000-0000-4000-8000-000000000005",
    text: "custom:20000000-0000-4000-8000-000000000006"
};

const options = [
    { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }, { id: "e", name: "E" }
];
const defs: AttributeDefinition[] = [
    { id: viewFields.status, name: "Study status", type: "status", metadata: { options: [
        { id: "done", name: "Done", group: "complete" }, { id: "new", name: "To do", group: "incomplete" }, { id: "doing", name: "In progress", group: "incomplete" }
    ] } },
    { id: viewFields.category, name: "Category", type: "select", metadata: { options } },
    { id: viewFields.multiple, name: "Study method", type: "multiselect", metadata: { options } },
    { id: viewFields.date, name: "Study date", type: "day", metadata: {} },
    { id: viewFields.project, name: "Project", type: "page-link", metadata: {} },
    { id: viewFields.text, name: "Study notes", type: "string", metadata: {} }
];

export function seedViews(sql: Database.Database, referenceDay: number): void {
    seedLibrary(sql);
    const ids = sql.prepare("SELECT id FROM pages ORDER BY id").pluck().all() as string[];
    const projects = sql.prepare("SELECT id FROM pages WHERE kind='editable' ORDER BY id LIMIT 50").pluck().all() as string[];
    const attr = sql.prepare("INSERT INTO page_attrs(page_id,attr_id,value) VALUES(?,?,?)");
    const meta = sql.prepare("INSERT INTO attrs_meta(id,type,name,metadata) VALUES (?,?,?,?)");
    const link = sql.prepare("INSERT INTO link_refs(source_kind,source_id,source_field,target_kind,target_id) VALUES ('page',?,?,'page',?)");
    sql.transaction(() => {
        for (const def of defs) meta.run(def.id, def.type, def.name, JSON.stringify(def.metadata));
        for (const [i, id] of ids.entries()) {
            const project = i % 13 ? projects[i * 7 % projects.length] : null;
            const chosen = options[i % options.length].id;
            const several = Array.from({ length: i % 3 + 1 }, (_, j) => options[(i * 3 + j) % options.length].id);
            const values: AttributeValue[] = [
                i % 11 ? defs[0].metadata.options![i % 3].id : null, i % 7 ? chosen : null, i % 17 ? several : [],
                i % 19 ? referenceDay + (i * 79 % 361 - 180) * secondsPerDay : null,
                project, i % 5 ? "Study protocol " + i : "Other protocol " + i
            ];
            for (const [j, def] of defs.entries()) {
                if (i % 31 === 0) continue;
                const value = encodeValue(def, values[j] ?? emptyValue(def.type));
                attr.run(id, def.id, typeof value === "number" ? BigInt(value) : value);
            }
            if (project && i % 31) link.run(id, viewFields.project, project);
        }
    })();
}

export function viewFixtureParams(): TableParams {
    const [status, category, multiple, date, project, text] = defs.map(def => def.id);
    return { columns: ["title", status, category, multiple, date, project, text].map(id => ({ id })), showProperties: false, query: {
        conditions: [
            { field: columnField(date), operator: "equals", values: [{ kind: "relative", period: "past-days", days: 180 }] },
            { field: columnField(text), operator: "contains", values: ["study"] },
            { field: columnField(multiple), operator: "any", values: ["a"] }
        ],
        sort: [{ field: columnField(date), direction: "desc" }, { field: columnField("title"), direction: "asc" }],
        group: { field: columnField(status), collapsed: [] }
    } };
}