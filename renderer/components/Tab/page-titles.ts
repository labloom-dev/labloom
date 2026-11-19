import { readable, type Readable } from "svelte/store";
import { failure } from "../../i18n.svelte";
import { knowledgeState } from "../Knowledge/feedback.svelte";

const watched = new Map<string, { store: Readable<string>; publish: (title: string) => void }>();

export function publishTitle(id: string, title: string): void {
    watched.get(id)?.publish(title || "未命名");
}

export function pageTitle(id: string): Readable<string> {
    return {
        subscribe(run) {
            const store = watched.get(id)?.store ?? observe(id);
            return store.subscribe(run);
        }
    };
}

function observe(id: string): Readable<string> {
    const store = readable("页面", set => {
        let revision = 0;
        async function refresh(): Promise<void> {
            const request = ++revision;
            try {
                const query = { ids: [id], limit: 1 };
                const page = (await window.api.pages.list(query)).items[0]
                    ?? (await window.api.pages.list({ ...query, deleted: true })).items[0];
                if (request === revision) set(page ? page.title || "未命名" : "找不到页面");
            }
            catch (problem) {
                if (request === revision) knowledgeState.error = failure(problem);
            }
        }
        watched.set(id, { store, publish: title => {
            revision++; set(title);
        } });
        const off = window.api.pages.onChanged(change => {
            if (change.titlePages?.includes(id) || change.purged?.includes(id)) void refresh();
        });
        void refresh();
        return () => {
            revision++; off(); watched.delete(id);
        };
    });
    return store;
}