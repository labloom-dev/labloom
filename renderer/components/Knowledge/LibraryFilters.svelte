<script lang="ts">
    import type { AttributeDefinition, AttributeValue } from "../../../shared/types/attributes";
    import { defaultValue } from "../../../shared/attrs/values";
    import { pageKinds, type PageKind } from "../../../shared/types/content";
    import type { ViewParams } from "../../../shared/workspace/views";
    import { t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import Checkbox from "../base/Checkbox.svelte";
    import Input from "../base/Input.svelte";
    import Select from "../base/Select.svelte";
    import { copyData } from "../copy-data";
    import AttributeInput from "./AttributeInput.svelte";
    import { propertyName } from "./attribute-labels";

    type Params = ViewParams["library"];
    let { params, definitions, change }: { params: Params; definitions: AttributeDefinition[]; change: (patch: Partial<Params>) => void } = $props();
    let search = $state(""), field = $state("");
    const options = $derived(definitions.find(d => d.id === "tags")?.metadata.options ?? []);
    const fields = $derived(definitions.filter(d => !d.hidden && d.id !== "deleted"));
    const def = $derived(fields.find(d => d.id === field));
    let value = $derived<AttributeValue>(def ? defaultValue(def.type) : null);
    function add(): void {
        if (!def) return;
        change({ filters: [...params.filters.filter(f => f.attribute.id !== def.id), { attribute: { kind: "attribute", id: def.id }, value: copyData(value) }] });
    }
</script>

<div class="filters">
    {#if !params.paperOnly}
        <span>{t("library.type")}</span>
        <Select label={t("library.type")} value={params.pageType?.type ?? ""} options={[{ value: "", label: t("library.all") }, ...pageKinds.map(type => ({ value: type, label: t(`library.${type}`) }))]}
            onchange={type => change({ pageType: type ? { kind: "page-type", type: type as PageKind } : undefined })} />
    {/if}
    <span>{t("attributeName.tags")}</span>
    <Input search clearLabel={t("shell.clearFilter")} label={t("library.tags")} placeholder={t("library.tags")} bind:value={search} />
    <div class="tags">
        {#each options.filter(o => o.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) as option (option.id)}
            <Checkbox label={option.name} checked={params.tags.includes(option.id)} onchange={checked => {
                change({ tags: checked ? [...params.tags, option.id] : params.tags.filter(id => id !== option.id) });
            }} />
        {/each}
    </div>
    <span>{t("library.property")}</span>
    <Select label={t("library.property")} placeholder={t("library.property")} bind:value={field}
        options={fields.map(d => ({ value: d.id, label: propertyName(d) }))} />
    {#if def}
        <AttributeInput definition={{ ...def, readonly: false }} {value} onchange={next => value = next} />
        <Button onclick={add}>{t("library.add")}</Button>
    {/if}
</div>

<style>
    .filters { display: grid; gap: var(--ui-space-2); width: min(var(--ui-properties-width), 75vw); max-height: 75vh; overflow-y: auto; }
    .filters > span { margin-top: var(--ui-space-2); font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
    .tags { display: grid; max-height: var(--ui-search-list-height); overflow-y: auto; }
</style>