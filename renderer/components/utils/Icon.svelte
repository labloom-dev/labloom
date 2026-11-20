<script module lang="ts">
    import arrowUndo16 from "@fluentui/svg-icons/icons/arrow_undo_16_regular.svg?inline";
    import arrowUndo20 from "@fluentui/svg-icons/icons/arrow_undo_20_regular.svg?inline";
    import arrowRedo16 from "@fluentui/svg-icons/icons/arrow_redo_16_regular.svg?inline";
    import arrowRedo20 from "@fluentui/svg-icons/icons/arrow_redo_20_regular.svg?inline";
    import highlight16 from "@fluentui/svg-icons/icons/highlight_16_regular.svg?inline";
    import highlight20 from "@fluentui/svg-icons/icons/highlight_20_regular.svg?inline";
    import textUnderline16 from "@fluentui/svg-icons/icons/text_underline_16_regular.svg?inline";
    import textUnderline20 from "@fluentui/svg-icons/icons/text_underline_20_regular.svg?inline";
    import textColor16 from "@fluentui/svg-icons/icons/text_color_16_regular.svg?inline";
    import textColor20 from "@fluentui/svg-icons/icons/text_color_20_regular.svg?inline";
    import headingOne from "@fluentui/svg-icons/icons/text_header_1_20_regular.svg?inline";
    import headingTwo from "@fluentui/svg-icons/icons/text_header_2_20_regular.svg?inline";
    import headingThree from "@fluentui/svg-icons/icons/text_header_3_20_regular.svg?inline";
    import textClearFormatting16 from "@fluentui/svg-icons/icons/text_clear_formatting_16_regular.svg?inline";
    import textClearFormatting20 from "@fluentui/svg-icons/icons/text_clear_formatting_20_regular.svg?inline";
    import textParagraph16 from "@fluentui/svg-icons/icons/text_paragraph_16_regular.svg?inline";
    import textParagraph20 from "@fluentui/svg-icons/icons/text_paragraph_20_regular.svg?inline";
    import arrowRotateClockwise16 from "@fluentui/svg-icons/icons/arrow_rotate_clockwise_16_regular.svg?inline";
    import arrowRotateClockwise20 from "@fluentui/svg-icons/icons/arrow_rotate_clockwise_20_regular.svg?inline";

    const codicons = [
        "add", "agent", "arrow-left", "arrow-right", "bell", "bell-dot", "bold", "book", "calendar",
        "check", "chevron-down", "chevron-left", "chevron-right", "chevron-up", "circle-small-filled",
        "close", "code", "comment", "dash", "edit", "folder-opened", "gripper", "home",
        "horizontal-rule", "info", "italic", "layout-sidebar-left", "library", "link-external",
        "list-ordered", "list-unordered", "quote", "refresh", "rss", "search",
        "settings-gear", "split-horizontal", "split-vertical", "strikethrough", "symbol-color",
        "sync", "table", "trash", "zoom-in", "zoom-out"
    ] as const;

    const fluent = {
        undo: { artwork16: arrowUndo16, artwork20: arrowUndo20 },
        redo: { artwork16: arrowRedo16, artwork20: arrowRedo20 },
        "text-highlight": { artwork16: highlight16, artwork20: highlight20 },
        underline: { artwork16: textUnderline16, artwork20: textUnderline20 },
        "text-color": { artwork16: textColor16, artwork20: textColor20 },
        "heading-1": { artwork20: headingOne },
        "heading-2": { artwork20: headingTwo },
        "heading-3": { artwork20: headingThree },
        "clear-formatting": { artwork16: textClearFormatting16, artwork20: textClearFormatting20 },
        paragraph: { artwork16: textParagraph16, artwork20: textParagraph20 },
        "rotate-clockwise": { artwork16: arrowRotateClockwise16, artwork20: arrowRotateClockwise20 }
    };
    type FluentName = keyof typeof fluent;
    export type IconName = typeof codicons[number] | FluentName;
    export const iconNames: IconName[] = [...codicons, ...Object.keys(fluent) as FluentName[]];
    export const fluentIcons: Partial<Record<IconName, { artwork16?: string; artwork20: string }>> = fluent;
</script>

<script lang="ts">
    import "@vscode/codicons/dist/codicon.css";
    let { name, size = 16 }: { name: IconName; size?: number | string } = $props();
    const artwork = $derived(fluentIcons[name]);
    const length = $derived(typeof size === "number" ? size + "px" : size);
</script>

<span class="icon" class:has-artwork={artwork !== undefined} data-icon={name} style:width={length} style:height={length} aria-hidden="true">
    {#if artwork}
        <span class="fluent" style:--art-small={`url("${artwork.artwork16 ?? artwork.artwork20}")`}
            style:--art-large={`url("${artwork.artwork20}")`}></span>
    {:else}
        <span class={"codicon codicon-" + name} style:font-size={length}></span>
    {/if}
</span>

<style>
    .icon {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        vertical-align: middle;
        line-height: 1;
        pointer-events: none;
    }
    .has-artwork { container: fluent-icon / inline-size; }
    .fluent {
        width: 100%;
        height: 100%;
        background-color: currentColor;
        mask: var(--art-small) center / contain no-repeat;
    }
    /* Select the closest drawing using the resolved width, including em, rem and CSS variables. */
    @container fluent-icon (min-width: 18px) {
        .fluent { mask-image: var(--art-large); }
    }
</style>