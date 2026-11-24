<script lang="ts">
    import { type Snippet } from "svelte";
    import { isComposingKey, readerShortcuts } from "../../../shared/content/commands";
    import { t } from "../../i18n.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Input from "../base/Input.svelte";
    import Select from "../base/Select.svelte";
    import { scalePresets, type ReaderFindStatus, type ReaderScale } from "./defs";
    import { isScalePreset } from "./pdfjs";

    let {
        disabled, pageNumber, pagesCount, scale, scaleValue, findStatus, query, extra,
        goToPage, previousPage, nextPage, zoomIn, zoomOut, setScale, rotate, find, clearFind
    }: {
        disabled: boolean;
        pageNumber: number;
        pagesCount: number;
        scale: number;
        scaleValue: string;
        findStatus: ReaderFindStatus;
        query: string;
        extra?: Snippet;
        goToPage: (pageNumber: number) => void;
        previousPage: () => void;
        nextPage: () => void;
        zoomIn: () => void;
        zoomOut: () => void;
        setScale: (scale: ReaderScale) => void;
        rotate: () => void;
        find: (query: string, previous?: boolean) => void;
        clearFind: () => void;
    } = $props();

    const percentOptions = [50, 75, 100, 125, 150, 200, 300, 400];
    const percent = $derived(Math.round(scale * 100));
    const scaleOption = $derived(isScalePreset(scaleValue) ? scaleValue : percentOptions.includes(percent) ? String(percent / 100) : "custom");
    const options = $derived([
        ...scalePresets.map(value => ({ value, label: t(`reader.scale.${value}`) })),
        ...percentOptions.map(value => ({ value: String(value / 100), label: value + "%" })),
        ...(scaleOption === "custom" ? [{ value: "custom", label: percent + "%", disabled: true }] : [])
    ]);

    const findText = $derived.by(() => {
        switch (findStatus.kind) {
            case "pending": return "…";
            case "found": return t("reader.matchCount", { current: findStatus.current, total: findStatus.total });
            case "not-found": return t("reader.noMatches");
            case "no-text": return t("reader.noText");
            default: return "";
        }
    });
    let pageDraft = $state<string | null>(null);
    let searchInput = $state<HTMLInputElement>();

    export function focusSearch(): void {
        searchInput?.focus();
        searchInput?.select();
    }
    function commitPage(): void {
        if (pageDraft === null) return;
        const value = Number.parseInt(pageDraft, 10);
        pageDraft = null;
        if (Number.isFinite(value)) goToPage(value);
    }
    function pageKey(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
        if (isComposingKey(event)) return;
        if (event.key === "Enter") commitPage();
        else if (event.key === "Escape") {
            pageDraft = null;
            event.currentTarget.blur();
        }
    }
    function searchKey(event: KeyboardEvent): void {
        if (isComposingKey(event)) return;
        if (event.key === "Enter" && query) {
            event.preventDefault();
            find(query, event.shiftKey);
        }
        else if (event.key === "Escape") {
            event.preventDefault();
            clearFind();
        }
    }
</script>

<div class="toolbar" role="toolbar" aria-label={t("reader.pdf")}>
    {@render extra?.()}
    <div class="group">
        <IconButton icon="chevron-up" label={t("reader.previousPage")} disabled={disabled || pageNumber <= 1} onclick={previousPage} />
        <IconButton icon="chevron-down" label={t("reader.nextPage")} disabled={disabled || pageNumber >= pagesCount} onclick={nextPage} />
        <div class="page-input">
            <Input label={t("reader.pageNumber")} {disabled} value={pageDraft ?? (disabled ? "" : String(pageNumber))} oninput={value => pageDraft = value}
                onchange={commitPage} inputProps={{ inputmode: "numeric", onkeydown: pageKey }} />
        </div>
        <span class="muted">{t("reader.pageCount", { count: disabled ? "–" : pagesCount })}</span>
    </div>
    <div class="group" data-reader-transform>
        <IconButton icon="zoom-out" label={t("reader.zoomOut")} shortcut={readerShortcuts.zoomOut} {disabled} onclick={zoomOut} />
        <Select label={t("reader.zoom")} {options} value={scaleOption} {disabled}
            onchange={value => {
                if (value && value !== "custom") setScale(isScalePreset(value) ? value : Number(value));
            }} />
        <IconButton icon="zoom-in" label={t("reader.zoomIn")} shortcut={readerShortcuts.zoomIn} {disabled} onclick={zoomIn} />
        <IconButton icon="rotate-clockwise" label={t("reader.rotate")} {disabled} onclick={rotate} />
    </div>
    <div class="group search">
        <Input search label={t("reader.find")} clearLabel={t("reader.clearFind")} placeholder={t("reader.find")} {disabled}
            value={query} bind:input={searchInput} oninput={value => value ? find(value) : clearFind()} inputProps={{ onkeydown: searchKey }} />
        {#if findText}<span class="muted" aria-live="polite">{findText}</span>{/if}
        <IconButton icon="chevron-up" label={t("reader.previousMatch")} disabled={disabled || findStatus.kind !== "found"} onclick={() => find(query, true)} />
        <IconButton icon="chevron-down" label={t("reader.nextMatch")} disabled={disabled || findStatus.kind !== "found"} onclick={() => find(query)} />
    </div>
</div>

<style>
    .toolbar {
        display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: var(--ui-space-2) var(--ui-space-4);
        min-height: var(--ui-toolbar-height); padding: var(--ui-space-1) var(--ui-space-3);
        background: var(--ui-surface-panel); border-bottom: var(--ui-stroke) solid var(--ui-divider); font-size: var(--ui-font-small);
    }
    .group { display: flex; align-items: center; gap: var(--ui-space-1); flex: none; }
    .search { flex: 1 0 200px; min-width: 0; margin-inline-start: auto; }
    .search :global(.ui-field) { min-width: 0; max-width: 240px; flex: 1; }
    .search :global(input) { min-width: 0; }
    .page-input { width: 46px; }
    .page-input :global(input) { text-align: center; }
    .muted { color: var(--ui-text-secondary); white-space: nowrap; }
</style>