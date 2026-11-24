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
        const selected = JSON.stringify(pages);
        const sources = pages.length ? data.statement(`SELECT p.id
            FROM json_each(?) j CROSS JOIN pages p ON p.id=j.value WHERE p.kind='feed'`).pluck().all(selected) as string[] : [];
        if (pages.length) data.statement("DELETE FROM pages WHERE id IN (SELECT value FROM json_each(?))").run(selected);
        const blocks = context.cleanup();
        context.invalidate([...pages.map(id => "page:" + id), ...blocks.map(id => "block:" + id)], true);
        context.change({ pages, blocks, backlinks: pages, purged: pages,
            ...(sources.length ? { kinds: Object.fromEntries(sources.map(id => [id, "feed" as const])) } : {}) });
        return { status: "deleted", pages, blocks };
    });
}