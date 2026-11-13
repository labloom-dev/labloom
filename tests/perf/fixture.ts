import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { EditHistory } from "../../main/knowledge/history";
import { KnowledgeService } from "../../main/knowledge/service";
import { createWorkspace } from "../../main/storage/workspace";
import { payload } from "../../shared/content/blocks";
import { nowSeconds } from "../../shared/content/time";

export type SeedPage = { id: string; children: string[] };
type Fixture = {
    sql: Database.Database;
    service: KnowledgeService;
    makePage(count: number, title: string, match?: boolean, independent?: boolean): SeedPage;
    attr: Database.Statement;
};

export function fixture(): Fixture {
    const ws = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "perf-")));
    const service = new KnowledgeService(ws.db);
    new EditHistory(service);
    const sql = ws.database;
    const block = sql.prepare("INSERT INTO blocks (id, type, content, children) VALUES (?, ?, ?, '[]')");
    const page = sql.prepare("INSERT INTO pages (id, kind, title_block_id, children) VALUES (?, 'editable', ?, ?)");
    const attr = sql.prepare("UPDATE page_attrs SET value = ? WHERE page_id = ? AND attr_id = ?");
    const now = BigInt(nowSeconds());
    function makePage(count: number, title: string, match = false, independent = true): SeedPage {
        const id = randomUUID(), titleId = randomUUID(), children: string[] = [];
        block.run(titleId, "title", JSON.stringify(payload("title", title)));
        for (let i = 1; i < count; i++) {
            const child = randomUUID();
            children.push(child);
            block.run(child, "paragraph", JSON.stringify(payload("paragraph", match && i === count - 1 ? "quasar" : "An ordinary research note.")));
        }
        page.run(id, titleId, JSON.stringify(children));
        service.attributes.initializePage(id);
        attr.run(Number(independent), id, "independent");
        attr.run(0, id, "deleted");
        attr.run(now, id, "created_at");
        attr.run(now, id, "modified_at");
        return { id, children };
    }
    return { sql, service, makePage, attr };
}

export function seedLargePage({ sql, makePage, service }: Fixture): SeedPage {
    const large = sql.transaction(() => {
        for (let i = 0; i < 1000; i++) makePage(10, "Research notes");
        return makePage(10000, "Large page");
    })();
    service.rebuildLinks();
    return large;
}