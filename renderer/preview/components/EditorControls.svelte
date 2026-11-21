<script lang="ts">
    import { blockListRows } from "../../../shared/content/block-list";
    import type { Editor } from "@tiptap/core";
    import { Tabs } from "bits-ui";
    import { tick } from "svelte";
    import { t, setLocale } from "../../i18n.svelte";
    import { attributeTypes, type AttributeDefinition, type AttributeValue } from "../../../shared/types/attributes";
    import type { ContentBlockKind, PageSearchResult, Target } from "../../../shared/types/content";
    import { block as blockItems, body as bodyItems, paste as pasteItems } from "../../components/Editor/menus";
    import { pageActions } from "../../components/Knowledge/page-header";
    import { providePropertyControls } from "../../components/Knowledge/property-controls";
    import Properties from "../../components/Knowledge/Properties.svelte";
    import TargetPicker from "../../components/Knowledge/TargetPicker.svelte";
    import PageStatus from "../../components/Knowledge/PageStatus.svelte";
    import TabBar from "../../components/Tab/TabBar.svelte";
    import TabItem from "../../components/Tab/TabItem.svelte";
    import Menu from "../../components/base/Menu.svelte";
    import Button from "../../components/base/Button.svelte";
    import Select from "../../components/base/Select.svelte";
    import { pickerPages, protocol } from "./editor-page";

    let { editor }: { editor: Editor } = $props();
    const pages = pickerPages();
    const initialDefinitions: AttributeDefinition[] = attributeTypes.map(type => ({
        type, id: type === "multiselect" ? "tags" : "sample-" + type, name: type === "multiselect" ? "标签" : t(`attributeType.${type}`),
        metadata: ["status", "select", "multiselect"].includes(type) ? { options: [{ id: "a", name: "现场" }, { id: "b", name: "室内" }] } : {}
    }));
    let definitions = $state<AttributeDefinition[]>(initialDefinitions);
    const initial: Record<typeof attributeTypes[number], AttributeValue> = {
        string: "港口声景", number: 51, boolean: true, minute: 1795213800, hour: 1795212000, day: 1795219200, month: 1793491200, year: 1767225600,
        select: "a", status: "b", multiselect: ["a"], url: "https://example.org", "page-link": "journal", "page-links": ["methods"],
        file: "recording", files: ["recording"], recurrence: { every: 60, unit: "minute" }, json: { point: "A" }
    };
    let attributes = $state<Record<string, AttributeValue>>(Object.fromEntries(initialDefinitions.map(d => [d.id, initial[d.type]])));
    let show = $state(true), recycled = $state(false), exampleInTrash = $state(true), status = $state(""), picker = $state<"reference" | "sync" | "inline" | null>(null);
    let kind = $state<ContentBlockKind>("table"), folded = $state(false), shared = $state(true), language = $state("zh-CN");
    let position = $state<{ x: number; y: number; left: number; right: number; bottom: number }>();
    let offsets: Record<string, number[]> = {};
    const files = [{ id: "recording", originalName: "点位 A.wav", mediaType: "audio/wav", size: 32000 }];
    const source = {
        recent: async () => pages.map(page => ({ ...page, openedAt: 0 })),
        search: async (keyword: string, offset = 0) => {
            const needle = keyword.toLocaleLowerCase();
            const result: PageSearchResult[] = pages.flatMap(page => page.title.toLocaleLowerCase().includes(needle)
                ? [{ ...page, match: { field: "title" as const } } as PageSearchResult]
                : page.excerpt.toLocaleLowerCase().includes(needle) ? [{ ...page, match: { field: "body" as const, snippet: page.excerpt } } as PageSearchResult] : []);
            return { items: result.slice(offset), total: result.length };
        },
        blockList: async (id: string) => {
            const page = pages.find(page => page.id === id)!;
            return { title: page.title, rows: blockListRows(page.children, id => page.blocks[id], () => protocol.title) };
        }
    };
    providePropertyControls({
        picker: source, manage: () => status = t("property.manage"), open: id => status = pages.find(page => page.id === id)?.title ?? id,
        saveDefinition: async value => {
            definitions = [...definitions.filter(item => item.id !== value.id), value]; return true;
        },
        files: async ids => files.filter(file => !ids || ids.includes(file.id)), openFile: async () => {
            status = files[0].originalName;
        },
        reminders: async () => offsets, setReminder: async (_page, attr, seconds, enabled) => {
            const old = offsets[attr] ?? []; offsets = { ...offsets, [attr]: enabled ? [...old, seconds] : old.filter(s => s !== seconds) };
        }
    });
    const header = $derived(pageActions(show, recycled, false, () => show = !show, () => recycled = !recycled));
    function format(): void {
        const line = editor.view.dom.querySelector<HTMLElement>("[data-kind=paragraph] [data-body]")!;
        const from = editor.view.posAtDOM(line, 0);
        line.scrollIntoView({ block: "center" });
        editor.chain().focus().setTextSelection({ from, to: from + 3 }).run();
    }
    function pick(mode: typeof picker): void {
        if (mode === "inline") {
            const dom = editor.view.dom, at = dom.querySelector<HTMLElement>("[data-kind=callout] [data-body]")!;
            at.scrollIntoView({ block: "center" });
            const pos = editor.view.posAtDOM(at, 0);
            editor.commands.setTextSelection(pos); editor.view.focus();
            const rect = editor.view.coordsAtPos(pos), bounds = dom.getBoundingClientRect();
            position = { x: rect.left, y: rect.bottom, left: bounds.left, right: bounds.right, bottom: window.innerHeight };
        }
        picker = mode;
    }
    function choose(target: Target, label: string): void {
        if (picker === "inline") editor.chain().focus().insertContent({ type: "inlineReference", attrs: { target, label } }).run();
        status = label; picker = null;
    }
</script>

<div class="editor-controls">
    <h3>{t("editor.controls")}</h3>
    <div class="controls-row">
        <Menu items={blockItems({ kind, shared, folded, children: true }, value => {
            kind = value; status = t(`block.${value}`);
        }, action => {
            if (action === "fold") folded = !folded; else if (action === "unsync") shared = false; status = t(`editor.${action}`);
        }, pick, direction => status = t(direction < 0 ? "editor.up" : "editor.down"))}>
            {#snippet trigger({ props })}<Button {...props} icon="gripper">{t("command.blockMenu")}</Button>{/snippet}
        </Menu>
        <Menu context items={bodyItems(id => id === "inlineReference" ? pick("inline") : status = t(`command.${id}`), true)}>
            {#snippet trigger({ props })}<Button {...props}>{t("editor.bodyMenu")}</Button>{/snippet}
        </Menu>
        <Menu first items={pasteItems(synced => status = t(synced ? "editor.pasteSynced" : "command.paste"))}>
            {#snippet trigger({ props })}<Button {...props}>{t("editor.pasteOptions")}</Button>{/snippet}
        </Menu>
        <Button onclick={format}>{t("editor.toolbar")}</Button>
        <Button onclick={() => pick("reference")}>{t("editor.choosePage")}</Button>
        <Button onclick={() => pick("inline")}>{t("editor.inline")}</Button>
        <Select label={t("language.label")} bind:value={language} options={[{ value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" }]} onchange={value => setLocale(value === "en" ? "en" : "zh-CN")} />
    </div>
    <Tabs.Root value="page">
        <TabBar focused canMerge={false} hasTabs {header} onsplit={() => status = t("command.splitRight")} onmerge={() => status = t("command.mergeGroup")}
            oncloseall={() => status = t("shell.closeAll")} oncreate={() => status = t("command.newPage")}>
            <TabItem id="page" title="港口声景观察" icon="edit" active menu={[]} onactivate={() => {}} onclose={() => status = t("shell.close")} />
        </TabBar>
    </Tabs.Root>
    <PageStatus recycled={exampleInTrash || recycled} onrestore={() => {
        exampleInTrash = false; recycled = false; status = t("pageAction.restore");
    }} />
    <PageStatus error={t("failure.database-readonly")} onrestore={() => {}} />
    {#if show}
        <div class="property-sample"><Properties page={{ ...pages[0], attributes: { ...attributes, deleted: recycled } }} {definitions}
            onattr={(id, value) => attributes[id] = value} ondetach={id => {
                delete attributes[id];
            }} /></div>
    {/if}
    {#if status}<output>{status}</output>{/if}
</div>
{#if picker}<TargetPicker {source} mode={picker === "sync" ? "sync" : "reference"} position={picker === "inline" ? position : undefined}
    onselect={choose} onclose={() => {
        if (picker === "inline") void tick().then(() => editor.view.focus()); picker = null;
    }} />{/if}

<style>
    .editor-controls { display: grid; gap: var(--ui-space-3); margin-block: var(--ui-space-5); color: var(--ui-text); }
    .controls-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-space-2); }
    .property-sample { width: min(100%, var(--ui-properties-width)); border: var(--ui-stroke) solid var(--ui-divider); border-radius: var(--ui-radius-panel); }
    h3 { margin: 0; }
    output { font-size: var(--ui-font-small); color: var(--ui-text-secondary); }
</style>