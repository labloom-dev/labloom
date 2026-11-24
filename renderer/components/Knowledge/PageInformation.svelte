<script lang="ts">
    import { onDestroy, onMount, untrack } from "svelte";
    import { blockText, payload } from "../../../shared/content/blocks";
    import { isComposingKey } from "../../../shared/content/commands";
    import { t } from "../../i18n.svelte";
    import Input from "../base/Input.svelte";
    import { openPage } from "../layout/navigation";
    import Backlinks from "./Backlinks.svelte";
    import LibraryInfo from "./LibraryInfo.svelte";
    import { inspectPage } from "./page-sessions";
    import { knowledgeState } from "./feedback.svelte";

    let { tabId, pageId }: { tabId: string; pageId: string } = $props();
    const inspection = untrack(() => inspectPage(tabId, pageId)), current = inspection.current;
    onDestroy(inspection.release);
    const page = $derived(current.state.page);
    const title = $derived(page?.blocks[page.titleBlockId]);
    let draft: string | undefined;
    onMount(() => {
        const flush = (): void => {
            if (draft !== undefined) rename(draft);
        };
        window.addEventListener("workspace-flush", flush);
        return () => window.removeEventListener("workspace-flush", flush);
    });
    function rename(value: string): void {
        draft = undefined;
        if (!title || page?.attributes.deleted || value === blockText(title)) return;
        current.stage({ blocks: [{ ...title, payload: payload("title", value) }] });
        void current.flush().then(saved => {
            if (!saved && current.state.error) knowledgeState.error = current.state.error;
        });
    }
</script>

<div class:paper-info={page?.kind === "paper"} data-history-page={pageId} tabindex="-1">
    {#if page?.kind === "paper" && title}
        <div class="paper-title">
            <Input value={blockText(title)} label={t("quickOpen.title")} placeholder={t("shell.untitled")}
                inputProps={{ readonly: !!page.attributes.deleted, onkeydown: event => {
                    if (event.key === "Enter" && !isComposingKey(event)) event.currentTarget.blur();
                } }} disabled={current.state.loading} oninput={value => draft = value} onchange={rename} />
        </div>
    {/if}
    <LibraryInfo {tabId} {pageId} />
    {#if page?.kind === "paper" && current.state.backlinks.length}
        <div class="backlinks">
            <Backlinks links={current.state.backlinks} onopen={(id, otherGroup, anchorId) => openPage(id, { currentGroup: true, otherGroup, anchorId })} />
        </div>
    {/if}
</div>

<style>
    .paper-title, .backlinks { padding: var(--ui-space-3); }
    .paper-title :global(.ui-field) { width: 100%; }
    .paper-info :global(.library-info) { display: flex; flex-direction: column; }
    .paper-info :global(.library-attachments) { order: 1; }
</style>