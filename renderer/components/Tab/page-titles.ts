import { derived, readable, toStore, type Readable } from "svelte/store";
import { type PageKind } from "../../../shared/types/content";
import { failure, t } from "../../i18n.svelte";
import { knowledgeState } from "../Knowledge/feedback.svelte";

type Heading = { title: string | undefined | null; kind: PageKind };
const watched = new Map<string, { store: Readable<Heading>; publish: (title: string) => void }>();

export function publishTitle(id: string, title: string): void {
    watched.get(id)?.publish(title);
}

function heading(id: string): Readable<Heading> {
    return { subscribe: run => (watched.get(id)?.store ?? observe(id)).subscribe(run) };
}
export function pageTitle(id: string): Readable<string> {
    const labels = toStore(() => ({ loading: t("shell.page"), missing: t("shell.missing"), untitled: t("shell.untitled") }));
    return derived([heading(id), labels], ([page, text]) => page.title === undefined ? text.loading : page.title === null ? text.missing : page.title || text.untitled);
}
export function pageKind(id: string): Readable<PageKind> {
    return derived(heading(id), page => page.kind);
}

function observe(id: string): Readable<Heading> {
    const store = readable<Heading>({ title: undefined, kind: "editable" }, (_set, update) => {
        let revision = 0, edits = 0;
        async function refresh(): Promise<void> {
            const request = ++revision, before = edits;
            try {
                const query = { ids: [id], limit: 1 };
                const page = (await window.api.pages.list(query)).items[0]
                    ?? (await window.api.pages.list({ ...query, deleted: true })).items[0];
                if (request === revision) update(current => ({
                    title: before === edits ? page?.title ?? null : current.title, kind: page?.kind ?? current.kind
                }));
            }
            catch (problem) {
                if (request === revision) knowledgeState.error = failure(problem);
            }
        }
        watched.set(id, { store, publish: title => {
            edits++; update(current => ({ ...current, title }));
        } });
        const off = window.api.pages.onChanged(change => {
            if (change.titlePages?.includes(id) || change.purged?.includes(id) || change.kinds?.[id]) void refresh();
        });
        void refresh();
        return () => {
            revision++; off(); watched.delete(id);
        };
    });
    return store;
}