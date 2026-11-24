import { type PurgeResult } from "../../shared/types/knowledge";
import * as workspace from "../workspace-state";
import { fingerprint } from "./attributes";
import * as commit from "./commit";
import * as data from "./records";
import * as retention from "./retention";

export function purge(ids: string[] | null, confirmation?: string): PurgeResult {
    workspace.requireWorkspace();
    return commit.run({ history: false, cleanup: true, confirmation }, context => {
        const plan = retention.purgePlan(ids);
        const token = fingerprint({ ids, ...plan });
        if (plan.pages.length && token !== confirmation) return { status: "confirmation", token, pages: plan.pages, links: plan.links };
        const pages = plan.pages.map(page => page.id);
        if (pages.length) data.statement("DELETE FROM pages WHERE id IN (SELECT value FROM json_each(?))").run(JSON.stringify(pages));
        const blocks = context.cleanup();
        context.invalidate([...pages.map(id => "page:" + id), ...blocks.map(id => "block:" + id)], true);
        context.change({ pages, blocks, backlinks: pages, purged: pages });
        return { status: "deleted", pages, blocks };
    });
}