<div class="toolbar">
    <div class="group">
        <button disabled={disabled || pageNumber <= 1} onclick={previousPage}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html chevron_up}
        </button>
        <button disabled={disabled || pageNumber >= pagesCount} onclick={nextPage}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html chevron_down}
        </button>
        <input
            class="page-input"
            inputmode="numeric"
            {disabled}
            value={pageDraft ?? (disabled ? "" : String(pageNumber))}
            oninput={event => pageDraft = event.currentTarget.value}
            onkeydown={onPageKeydown}
            onblur={commitPage}
        />
        <span class="muted">/ {disabled ? "–" : pagesCount}</span>
    </div>

    <div class="group">
        <button {disabled} onclick={zoomOut}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html zoom_out}
        </button>
        <select {disabled} value={scaleOption} onchange={event => setScale(parseScale(event.currentTarget.value))}>
            {#each presetOptions as option (option.value)}
                <option value={option.value}>{option.label}</option>
            {/each}
            {#each percentOptions as percent (percent)}
                <option value={String(percent / 100)}>{percent}%</option>
            {/each}
            {#if scaleOption === "custom"}
                <option value="custom" disabled hidden>{Math.round(scale * 100)}%</option>
            {/if}
        </select>
        <button {disabled} onclick={zoomIn}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html zoom_in}
        </button>
        <button {disabled} onclick={rotate}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html rotate_clockwise}
        </button>
    </div>

    <div class="group search">
        <span class="icon">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html search}
        </span>
        <input
            type="search"
            placeholder="在文档中搜索"
            {disabled}
            value={query}
            bind:this={searchInput}
            oninput={onSearchInput}
            onkeydown={onSearchKeydown}
        />
        <span class="muted find-status">
            {findText}
        </span>
        <button disabled={disabled || findStatus.kind !== "found"} onclick={() => find(query, true)}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html chevron_up}
        </button>
        <button disabled={disabled || findStatus.kind !== "found"} onclick={() => find(query)}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html chevron_down}
        </button>
    </div>
</div>


<style>
    .toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
        height: 36px;
        padding-inline: 12px;
        overflow-x: auto;
        background-color: var(--c-reader-toolbar-background);
        border-bottom: var(--border-width) solid var(--c-reader-toolbar-border);
        font-size: 13px;
    }
    .group {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
    }
    .search {
        flex-shrink: 1;
        min-width: 0;
        margin-left: auto;
    }
    button {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        box-sizing: border-box;
    }
    button:hover:not(:disabled) {
        background-color: var(--c-surface-hover);
    }
    button:disabled {
        cursor: default;
        opacity: .4;
    }
    button :global(svg), .icon :global(svg) {
        width: 16px;
        height: 16px;
    }
    .icon {
        display: flex;
        padding-inline: 4px;
        color: var(--c-reader-muted-text);
    }
    input, select {
        height: 24px;
        padding-inline: 6px;
        border: var(--border-width) solid var(--c-reader-input-border);
        border-radius: 6px;
        background-color: var(--c-surface);
        font: inherit;
    }
    input:focus-visible, select:focus-visible, button:focus-visible {
        outline: var(--focus-width) solid var(--c-border-focus);
    }
    .page-input {
        width: 48px;
        margin-left: 4px;
        text-align: center;
    }
    input[type="search"] {
        width: 180px;
        min-width: 80px;
        flex-shrink: 1;
    }
    .muted {
        color: var(--c-reader-muted-text);
        white-space: nowrap;
    }
    .find-status {
        min-width: 48px;
        text-align: center;
    }
</style>


<script lang="ts">
    import type { ReaderFindStatus, ReaderScale } from "./defs";
    import { isScalePreset } from "./pdfjs";
    import chevron_up from "../../assets/carbon--chevron-up.svg?raw";
    import chevron_down from "../../assets/carbon--chevron-down.svg?raw";
    import zoom_in from "../../assets/carbon--zoom-in.svg?raw";
    import zoom_out from "../../assets/carbon--zoom-out.svg?raw";
    import rotate_clockwise from "../../assets/carbon--rotate-clockwise.svg?raw";
    import search from "../../assets/carbon--search.svg?raw";

    type Props = {
        disabled: boolean;
        pageNumber: number;
        pagesCount: number;
        scale: number;
        /** pdf.js' `currentScaleValue`: a preset name or a number as a string. */
        scaleValue: string;
        findStatus: ReaderFindStatus;
        query: string;
        goToPage: (pageNumber: number) => void;
        previousPage: () => void;
        nextPage: () => void;
        zoomIn: () => void;
        zoomOut: () => void;
        setScale: (scale: ReaderScale) => void;
        rotate: () => void;
        find: (query: string, previous?: boolean) => void;
        clearFind: () => void;
    };

    const {
        disabled, pageNumber, pagesCount, scale, scaleValue, findStatus, query,
        goToPage, previousPage, nextPage, zoomIn, zoomOut, setScale, rotate, find, clearFind
    }: Props = $props();

    const presetOptions = [
        { value: "auto", label: "自动" },
        { value: "page-actual", label: "实际大小" },
        { value: "page-width", label: "适合宽度" },
        { value: "page-fit", label: "适合页面" }
    ];
    const percentOptions = [50, 75, 100, 125, 150, 200, 300, 400];

    const scaleOption = $derived.by(() => {
        if (isScalePreset(scaleValue)) return scaleValue;
        const percent = Math.round(scale * 100);
        return percentOptions.includes(percent) ? String(percent / 100) : "custom";
    });

    const findText = $derived.by(() => {
        switch (findStatus.kind) {
            case "pending": return "…";
            case "found": return `${findStatus.current}/${findStatus.total}`;
            case "not-found": return "无结果";
            case "no-text": return "无可搜索文本";
            default: return "";
        }
    });

    let pageDraft = $state<string | null>(null);
    let searchInput = $state<HTMLInputElement | null>(null);

    export function focusSearch(): void {
        searchInput?.focus();
        searchInput?.select();
    }

    function parseScale(value: string): ReaderScale {
        return isScalePreset(value) ? value : Number(value);
    }

    function commitPage(): void {
        if (pageDraft === null) return;
        const value = Number.parseInt(pageDraft, 10);
        pageDraft = null;
        if (Number.isFinite(value)) goToPage(value);
    }

    function onPageKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
        if (event.key === "Enter") {
            commitPage();
        }
        else if (event.key === "Escape") {
            pageDraft = null;
            event.currentTarget.blur();
        }
    }

    function onSearchInput(event: Event & { currentTarget: HTMLInputElement }): void {
        const value = event.currentTarget.value;
        if (value) find(value);
        else clearFind();
    }

    function onSearchKeydown(event: KeyboardEvent): void {
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