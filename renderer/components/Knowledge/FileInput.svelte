<div class="file-input">
    {#if definition.type === "file" && files[0]}
        <button class="file-name" title={files[0].originalName} onclick={() => openFile(files[0])}>{files[0].originalName}</button>
        {#if !disabled}<button class="text-button" onclick={() => onchange(null)}>清空</button>{/if}
    {/if}
    <Popover.Root bind:open={expanded}>
        <Popover.Trigger class="file-trigger" title={display(definition, value, { fileName })} aria-label={definition.name + "文件列表"}>
            {definition.type === "files" ? display(definition, value, { fileName }) || (disabled ? "未填写" : "添加文件") : disabled ? "文件" : "添加文件"}
        </Popover.Trigger>
        <Popover.Portal><Popover.Content class="compact-menu file-menu" sideOffset={4} collisionPadding={8}>
            {#each files as file (file.id)}
                <div class="file-row">
                    <button class="file-name" title={file.originalName} onclick={() => openFile(file)}>{file.originalName}</button>
                    {#if !disabled}<button class="text-button" aria-label={`移除${file.originalName}`} onclick={() => remove(file.id)}>{definition.type === "file" ? "清空" : "移除"}</button>{/if}
                </div>
            {:else}<span class="muted">没有文件</span>{/each}
            {#if !disabled}
                {#if session}<button class="compact-item" disabled={busy} onclick={add}>{busy ? "正在添加…" : "添加文件"}</button>
                {:else}
                    <input type="search" aria-label="搜索文件" placeholder="搜索文件名…" bind:value={query} />
                    <div class="choices">{#each choices.filter(file => !ids.includes(file.id) && file.originalName.toLocaleLowerCase().includes(query.toLocaleLowerCase())) as file (file.id)}
                        <button class="compact-item" onclick={() => choose(file.id)}>{file.originalName}</button>
                    {:else}<span class="muted">没有可选文件</span>{/each}</div>
                {/if}
                {#if definition.type === "files" && ids.length}<button class="compact-item" onclick={() => onchange([])}>清空</button>{/if}
            {/if}
            {#if error}<p class="error">{message(error)}</p>{/if}
        </Popover.Content></Popover.Portal>
    </Popover.Root>
</div>
{#if preview}<AttachmentReader file={preview} onclose={() => preview = null} />{/if}
<style>
    .file-input { display: flex; align-items: center; gap: 4px; height: var(--button-height); min-width: 0; }
    .file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; color: inherit; }
    .file-name:hover { text-decoration: underline; }
    .text-button { flex-shrink: 0; font-size: inherit; }
    :global(.file-trigger) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; font-size: inherit; }
    :global(.file-menu) { width: min(360px, calc(100vw - 24px)); max-height: min(420px, calc(100vh - 48px)); overflow: auto; }
    .file-row { display: flex; align-items: center; gap: 8px; min-height: var(--property-row-height); }
    input { width: 100%; height: var(--button-height); margin-block: 4px; padding-inline: 6px; border: var(--border-width) solid var(--c-line); background: var(--c-paper); color: inherit; }
    .choices { max-height: 240px; overflow: auto; }
    .muted { color: var(--c-muted); }
    .error { color: var(--c-reader-error-text); overflow-wrap: anywhere; }
</style>
<script lang="ts">
    import { failure, message, type ErrorValue } from "../../i18n.svelte";
    import { Popover } from "bits-ui";
    import { display } from "../../../shared/attrs/format";
    import { type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
    import { type Attachment } from "../../../shared/types/papers";
    import { type PageSession, knowledgeState, writeFromTab } from "./state.svelte";
    import AttachmentReader from "./AttachmentReader.svelte";
    let { definition, value, session, disabled = false, onchange }: { definition: AttributeDefinition; value: AttributeValue; session?: PageSession; disabled?: boolean; onchange: (value: AttributeValue) => void } = $props();
    const ids = $derived((Array.isArray(value) ? value : typeof value === "string" ? [value] : []) as string[]);
    let files = $state<Attachment[]>([]), choices = $state<Attachment[]>([]), preview = $state<Attachment | null>(null);
    let expanded = $state(false), busy = $state(false), error = $state<ErrorValue>(""), query = $state("");
    const fileName = (id: string): string | undefined => files.find(file => file.id === id)?.originalName;
    $effect(() => {
        const current = [...ids];
        let active = true;
        void window.api.knowledge.files(current).then(result => {
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
        void window.api.knowledge.files().then(result => {
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
    async function openFile(file: Attachment): Promise<void> {
        try {
            if (file.mediaType === "application/pdf") preview = file;
            else await window.api.knowledge.openFile(file.id);
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
            await writeFromTab(current.tabId, async () => {
                if (await window.api.knowledge.importFiles(current.state.page!.id, definition.id, current.tabId)) await current.reread([current.state.page!.id]);
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