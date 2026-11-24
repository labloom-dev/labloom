<script lang="ts">
    import { tick } from "svelte";
    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import { isTimeType } from "../../../shared/content/time";
    import { isBuiltin } from "../../../shared/attrs/builtins";
    import { defaultMetadata, defaultValue, emptyValue, nullable } from "../../../shared/attrs/values";
    import { attributeTypes, type AttributeType, type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
    import { type PageRecord, type Backlink } from "../../../shared/types/content";
    import { type AnnotationPaper } from "../../../shared/types/papers";
    import type { PageSession } from "./page-session.svelte";
    import { propertyControls } from "./property-controls";
    import { propertyName } from "./attribute-labels";
    import Popover from "../base/Popover.svelte";
    import Button from "../base/Button.svelte";
    import TextButton from "../base/TextButton.svelte";
    import Tooltip from "../base/Tooltip.svelte";
    import IconButton from "../base/IconButton.svelte";
    import SearchList from "../globalSearch/SearchList.svelte";
    import AttributeInput from "./AttributeInput.svelte";
    import TagInput from "./TagInput.svelte";
    import TimerMenu from "./TimerMenu.svelte";

    let { page, definitions, sourcePaper, session, disabled = false, exclude = [], onattr, ondetach }: {
        page: PageRecord; definitions: AttributeDefinition[]; sourcePaper?: Backlink; session?: PageSession; disabled?: boolean; exclude?: readonly string[];
        onattr: (id: string, value: AttributeValue) => void; ondetach: (id: string) => void;
    } = $props();
    const services = propertyControls(), locked = $derived(disabled || !!page.attributes.deleted);
    const annotationId = $derived(page.kind === "annotation" ? page.id : "");
    let original = $state.raw<AnnotationPaper | null>();
    const paper = $derived(original === undefined && sourcePaper
        ? { id: sourcePaper.sourceId, title: sourcePaper.title, recycled: sourcePaper.deleted } : original);
    $effect(() => {
        const id = annotationId;
        original = undefined;
        if (!id) return;
        let active = true;
        let version = 0;
        function read(): void {
            const request = ++version;
            void window.api.papers.annotationPaper(id).then(result => {
                if (active && request === version) original = result;
            }).catch(problem => {
                if (active && request === version) error = failure(problem);
            });
        }
        read();
        const stop = window.api.pages.onChanged(change => {
            const owner = paper?.id;
            if (owner && change.purged?.includes(owner)) {
                version++;
                original = null;
            }
            else if (owner && (change.titlePages?.includes(owner) || change.recycledPages?.includes(owner))
                || change.highlightPages?.some(id => (!owner || id === owner) && change.pages.includes(id))) read();
        });
        return () => {
            active = false;
            stop();
        };
    });
    const visible = $derived(definitions.filter(item => Object.hasOwn(page.attributes, item.id) && !item.hidden && item.id !== "deleted" && !exclude.includes(item.id))
        .sort((a, b) => Number(["created_at", "modified_at"].includes(a.id)) - Number(["created_at", "modified_at"].includes(b.id))));
    let adding = $state(false), query = $state(""), name = $state(""), selected = $state(0), error = $state<ErrorValue>("");
    let input = $state<HTMLInputElement>();
    type Option = { id: string; title: string; run: () => void };
    const options = $derived.by(() => {
        const needle = query.trim().toLocaleLowerCase();
        if (name) return attributeTypes.filter(type => type !== "recurrence").map(type => ({
            id: type, title: t(`attributeType.${type}`), run: () => void create(type)
        })).filter(row => row.title.toLocaleLowerCase().includes(needle));
        const rows: Option[] = definitions.filter(item => !isBuiltin(item.id) && !Object.hasOwn(page.attributes, item.id) && propertyName(item).toLocaleLowerCase().includes(needle))
            .map(item => ({ id: item.id, title: propertyName(item), run: () => attach(item) }));
        if (needle && !definitions.some(item => propertyName(item) === query.trim())) rows.push({ id: "create", title: t("property.create", { name: query.trim() }), run: () => {
            name = query.trim(); query = ""; selected = 0; input?.focus();
        } });
        rows.push({ id: "manage", title: t("property.manage"), run: () => {
            adding = false; services.manage();
        } });
        return rows;
    });
    function toggle(value: boolean): void {
        adding = value; if (value) {
            query = ""; name = ""; selected = 0;
        }
    }
    function attach(item: AttributeDefinition): void {
        onattr(item.id, defaultValue(item.type)); adding = false;
    }
    async function create(type: AttributeType): Promise<void> {
        const definition: AttributeDefinition = { id: `custom:${crypto.randomUUID()}`, type, name, metadata: defaultMetadata(type) };
        try {
            if (await services.saveDefinition(definition)) attach(definition);
        }
        catch (problem) {
            error = failure(problem);
        }
    }
</script>

<section class="properties">
    {#if page.kind === "annotation"}
        <div class="property"><span class="property-label">{t("property.sourcePaper")}</span>
            <div class="value">
                {#if paper}
                    <TextButton text={paper.title || t("shell.untitled")} suffix={paper.recycled ? t("editor.recycledSuffix") : ""} onclick={() => services.open(paper!.id)} />
                {:else if paper === null}
                    {t("property.sourcePaperDeleted")}
                {/if}
            </div>
        </div>
    {/if}
    {#each visible as definition (definition.id)}
        {@const label = propertyName(definition)}
        <div class="property">
            <Tooltip text={label} canOpen={element => element.scrollWidth > element.clientWidth}>
                {#snippet trigger({ props })}<span {...props} class="property-label">{label}</span>{/snippet}
            </Tooltip>
            <div class="value">
                <div class="value-input">{#if definition.id === "tags"}<TagInput {definition} value={page.attributes.tags} disabled={locked} onchange={value => onattr("tags", value)} />
                {:else}<AttributeInput {definition} {session} value={page.attributes[definition.id]} disabled={locked} onchange={value => onattr(definition.id, value)} />{/if}</div>
                {#if isTimeType(definition.type)}<TimerMenu pageId={page.id} {definition} disabled={locked} />{/if}
                {#if !definition.readonly}
                    <div class="property-actions">
                        {#if nullable(definition.type) && definition.type !== "file" && definition.type !== "files"}<IconButton icon="close" label={t("property.clear", { name: label })} disabled={locked} onclick={() => onattr(definition.id, emptyValue(definition.type))} />{/if}
                        {#if !isBuiltin(definition.id)}<IconButton icon="dash" label={t("property.remove", { name: label })} disabled={locked} onclick={() => ondetach(definition.id)} />{/if}
                    </div>
                {/if}
            </div>
        </div>
    {/each}
    <Popover label={t("property.add")} bind:open={() => adding, toggle} contentProps={{ class: "property-picker", onOpenAutoFocus: event => {
        event.preventDefault(); void tick().then(() => input?.focus());
    } }}>
        {#snippet trigger({ props })}<Button {...props} variant="text" icon="add" disabled={locked}>{t("property.add")}</Button>{/snippet}
        <SearchList bind:query bind:input bind:selected {options} label={name || t("property.search")} onchoose={index => options[index]?.run()}
            onback={name ? () => {
                query = name; name = ""; selected = 0;
            } : undefined} />
    </Popover>
    {#if error}<div data-paragraph role="alert">{message(error)}</div>{/if}
</section>

<style>
    .properties { padding: var(--ui-space-3); color: var(--ui-text); background: var(--ui-surface-window); font-size: var(--ui-font-small); }
    .property { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); align-items: center; min-height: var(--ui-row-height); padding-block: var(--ui-space-1); gap: var(--ui-space-2); border-bottom: var(--ui-stroke) solid var(--ui-divider); }
    .property-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ui-text-secondary); }
    .value, .property-actions { display: flex; align-items: center; min-width: 0; }
    .value-input { flex: 1; min-width: 0; }
    .property-actions { width: 0; overflow: hidden; opacity: 0; pointer-events: none; }
    .property:is(:hover, :focus-within) .property-actions { width: auto; overflow: visible; opacity: 1; pointer-events: auto; }
    .property-actions :global(.ui-icon-button) { width: var(--ui-icon-large); }
    :global(.ui-popover.property-picker) { padding: 0; width: min(var(--ui-properties-width), calc(100vw - var(--ui-space-5))); }
    :where([data-paragraph]) { color: var(--ui-danger); }
</style>