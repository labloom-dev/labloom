{#snippet contents()}
    {#each files as file (file.id)}
        <div class="file-row">
            {#if openPaperPDF}<Menu context items={[{ label: t("library.openFile"), onselect: () => external(file) }]}>
                {#snippet trigger({ props })}<TextButton {...props} class="file-name" text={file.originalName} onclick={() => file.mediaType === "application/pdf" ? openPaperPDF?.(file.id) : external(file)} />{/snippet}
            </Menu>{:else}<TextButton class="file-name" text={file.originalName} onclick={() => openFile(file)} />{/if}
            {#if !disabled}<IconButton icon="close" label={t("property.removeItem", { name: file.originalName })} onclick={() => remove(file.id)} />{/if}
        </div>
    {:else}<span class="muted">{t("property.noFiles")}</span>{/each}
    {#if !disabled}
        {#if session}<Button icon="add" disabled={busy} onclick={add}>{t(busy ? "property.addingFile" : "property.addFile")}</Button>
        {:else}
            <Input search label={t("property.findFile")} clearLabel={t("shell.clearFilter")} placeholder={t("property.findFile")} bind:value={query} />
            {#each choices.filter(file => !ids.includes(file.id) && file.originalName.toLocaleLowerCase().includes(query.toLocaleLowerCase())) as file (file.id)}
                <TextButton text={file.originalName} onclick={() => choose(file.id)} />
            {:else}<span class="muted">{t("property.noFileChoices")}</span>{/each}
        {/if}
        {#if definition.type === "files" && ids.length}<Button variant="text" onclick={() => onchange([])}>{t("property.clear", { name: propertyName(definition) })}</Button>{/if}
    {/if}
    {#if error}<div data-paragraph role="alert">{message(error)}</div>{/if}
{/snippet}
{#if openPaperPDF}
    <div class="inline-files">{@render contents()}</div>
{:else}<div class="file-input">
    {#if definition.type === "file" && files[0]}
        <TextButton class="file-name" text={files[0].originalName} onclick={() => openFile(files[0])} />
        {#if !disabled}<IconButton class="file-clear" icon="close" label={t("property.clear", { name: files[0].originalName })} onclick={() => onchange(null)} />{/if}
    {/if}
    <Popover label={t("property.files", { name: propertyName(definition) })} bind:open={expanded} contentProps={{ class: "file-menu" }}>
        {#snippet trigger({ props })}
            <TextButton {...props} class="file-trigger" aria-label={t("property.files", { name: propertyName(definition) })}
                text={definition.type === "files" ? display(definition, value, { fileName }) || t(disabled ? "property.empty" : "property.addFile") : t(disabled ? "attributeType.file" : "property.addFile")} />
        {/snippet}
        {@render contents()}
    </Popover>
</div>{/if}
{#if preview}
    {#await import("./AttachmentReader.svelte") then { default: AttachmentReader }}<AttachmentReader file={preview} onclose={() => preview = null} />{/await}
{/if}

<style>
    .file-input, .file-row { display: flex; align-items: center; min-width: 0; gap: var(--ui-space-2); }
    .inline-files { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--ui-space-1); justify-items: start; }
    .inline-files .file-row { width: 100%; }
    .file-row { min-height: var(--ui-row-height); }
    :global(.file-name) { flex: 1; }
    .file-input :global(.file-clear) { opacity: 0; width: 0; overflow: hidden; }
    .file-input:is(:hover, :focus-within) :global(.file-clear), :global(.property:is(:hover, :focus-within)) .file-input :global(.file-clear) { width: var(--ui-icon-large); opacity: 1; }
    :global(.file-menu) { display: grid; gap: var(--ui-space-2); width: var(--ui-properties-width); }
    .muted { color: var(--ui-text-secondary); }
    [role="alert"] { color: var(--ui-danger); }
</style>
<script lang="ts">
    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import Menu from "../base/Menu.svelte";
    import Popover from "../base/Popover.svelte";
    import Button from "../base/Button.svelte";
    import TextButton from "../base/TextButton.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Input from "../base/Input.svelte";
    import { propertyControls } from "./property-controls";
    import { propertyName } from "./attribute-labels";
    import { display } from "../../../shared/attrs/format";
    import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
    import { type Attachment } from "../../../shared/types/papers";
    import { type PageSession } from "./page-session.svelte";
    import { knowledgeState } from "./feedback.svelte";
    import { write } from "./page-sessions";
    let { definition, value, session, disabled = false, openPaperPDF, onchange }: { definition: AttributeDefinition; value: AttributeValue; session?: PageSession; disabled?: boolean; openPaperPDF?: (id: string) => void; onchange: (value: AttributeValue) => void } = $props();
    const services = propertyControls();
    const ids = $derived((Array.isArray(value) ? value : typeof value === "string" ? [value] : []) as string[]);
    let files = $state<Attachment[]>([]), choices = $state<Attachment[]>([]), preview = $state<Attachment | null>(null);
    let expanded = $state(false), busy = $state(false), error = $state<ErrorValue>(""), query = $state("");
    const fileName = (id: string): string | undefined => files.find(file => file.id === id)?.originalName;
    $effect(() => {
        const current = [...ids];
        if (!current.length) {
            files = []; return;
        }
        let active = true;
        void services.files(current).then(result => {
            if (active) files = result;
        }, problem => {
            if (active) error = failure(problem);
        });
        return () => {
            active = false;
        };
    });
    $effect(() => {
        if (!expanded || session || disabled) return;
        void knowledgeState.change.seq;
        let active = true;
        void services.files().then(result => {
            if (active) choices = result;
        }, problem => {
            if (active) error = failure(problem);
        });
        return () => {
            active = false;
        };
    });
    function remove(id: string): void {
        onchange(definition.type === "file" ? null : ids.filter(value => value !== id));
    }
    function choose(id: string): void {
        onchange(definition.type === "file" ? id : [...ids, id]);
        if (definition.type === "file") expanded = false;
    }
    async function external(file: Attachment): Promise<void> {
        try {
            await services.openFile(file.id);
        }
        catch (problem) {
            error = failure(problem);
        }
    }
    async function openFile(file: Attachment): Promise<void> {
        try {
            if (file.mediaType === "application/pdf") preview = file;
            else await services.openFile(file.id);
        }
        catch (problem) {
            error = failure(problem); expanded = true;
        }
    }
    async function add(): Promise<void> {
        if (!session?.state.page) return;
        busy = true;
        try {
            const current = session;
            await write(async () => {
                if (await window.api.papers.importFiles(current.state.page!.id, definition.id, current.source)) await current.reread([current.state.page!.id]);
            });
            error = "";
        }
        catch (problem) {
            error = failure(problem);
        }
        finally {
            busy = false;
        }
    }
</script>