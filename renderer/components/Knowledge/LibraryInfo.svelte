<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { t, message } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import Input from "../base/Input.svelte";
    import { openPage } from "../layout/navigation";
    import { inspectPage } from "./page-sessions";
    import { visits } from "../Tab/activity.svelte";
    import Properties from "./Properties.svelte";
    import FileInput from "./FileInput.svelte";

    let { tabId, pageId, readonly = false }: { tabId: string; pageId: string; readonly?: boolean } = $props();
    const inspection = untrack(() => inspectPage(tabId, pageId)), current = inspection.current;
    onDestroy(inspection.release);
    const page = $derived(current.state.page);
    const attachments = $derived(current.state.definitions.find(def => def.id === "paper_files"));
    const locked = $derived(readonly || current.state.loading || !!page?.attributes.deleted);
</script>

<div class="library-info" data-history-page={pageId} tabindex="-1">
    {#if current.state.error}
        <div data-paragraph role="alert">{message(current.state.error)} <Button onclick={() => void visits.settled(tabId)}>{t("dialog.retry")}</Button></div>
    {:else if page}
        <Properties {page} session={current} definitions={current.state.definitions} disabled={locked}
            exclude={page.kind === "paper" ? ["paper_abstract", "paper_files"] : []}
            sourcePaper={current.state.backlinks.find(link => link.sourceFields?.includes("paper_annotations"))} onattr={current.attr} ondetach={current.detach} />
        {#if page.kind === "paper"}
            {#if attachments}<section class="library-attachments"><h3>{t("attributeName.paper_files")}</h3>
                <FileInput definition={attachments} value={page.attributes.paper_files} session={current} disabled={locked}
                    openPaperPDF={fileId => openPage(pageId, { duplicate: true, fileId })} onchange={value => current.attr("paper_files", value)} />
            </section>{/if}
            <section class="abstract"><h3>{t("attributeName.paper_abstract")}</h3>
                {#if readonly || page.attributes.deleted}<div data-paragraph>{page.attributes.paper_abstract}</div>
                {:else}<Input label={t("attributeName.paper_abstract")} multiline={4} value={String(page.attributes.paper_abstract ?? "")}
                    disabled={locked} onchange={value => current.attr("paper_abstract", value)} />{/if}
            </section>
        {/if}
    {:else}<div data-paragraph>{t("library.loading")}</div>{/if}
</div>

<style>
    .library-info { font-size: var(--ui-font-small); }
    section, :where([data-paragraph]) { padding: var(--ui-space-3); }
    h3 { margin: 0 0 var(--ui-space-2); font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
    .abstract :global(.ui-field) { width: 100%; }
    .abstract :global(textarea) { field-sizing: content; }
    .abstract :where([data-paragraph]) { padding: 0; margin: 0; white-space: pre-wrap; user-select: text; overflow-wrap: anywhere; }
    [role="alert"] { color: var(--ui-danger); }
</style>