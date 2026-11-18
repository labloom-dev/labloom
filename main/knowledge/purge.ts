import { type PurgeResult } from "../../shared/types/knowledge";
import * as workspace from "../workspace-state";
import * as attributes from "./attributes";
import { fingerprint } from "./attributes";
import * as commit from "./commit";
import * as data from "./records";
import * as retention from "./retention";
import { checkTab } from "./validation";

export function purge(ids: string[] | null, tabId: string, confirmation?: string): PurgeResult {
    workspace.requireWorkspace();
    checkTab(tabId);
    return commit.run({ sourceTab: tabId, history: false, cleanup: true, confirmation }, context => {
        const plan = retention.purgePlan(ids), pages = plan.pages.map(id => ({ id, title: data.title(id) }));
        const token = fingerprint({ ids, ...plan, pages });
        if (pages.length && token !== confirmation) return { status: "confirmation", token, pages, links: plan.links };
        const retained = data.statement("SELECT page_id AS pageId,value FROM page_attrs WHERE attr_id='paper_annotations'").all() as { pageId: string; value: string }[];
        for (const row of retained) {
            if (plan.pages.includes(row.pageId)) continue;
            const current = JSON.parse(row.value) as string[], next = current.filter(id => !plan.pages.includes(id));
            if (next.length !== current.length) {
                attributes.persistValues(row.pageId, attributes.prepareValues(row.pageId, { paper_annotations: next }, [], true));
                context.change({ pages: [row.pageId] });
            }
        }
        if (plan.pages.length) data.statement("DELETE FROM pages WHERE id IN (SELECT value FROM json_each(?))").run(JSON.stringify(plan.pages));
        const blocks = context.cleanup();
        if (plan.pages.length || blocks.length) context.clearHistory();
        context.change({ pages: plan.pages, blocks, backlinks: plan.pages, purged: plan.pages });
        return { status: "deleted", pages: plan.pages, blocks };
    });
}