<span class="icon" style:width={`${size}px`} style:height={`${size}px`} aria-hidden="true">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html icons[name]}
</span>


<style>
    .icon {
        display: inline-flex;
        flex-shrink: 0;
        vertical-align: middle;
    }
    .icon :global(svg) {
        width: 100%;
        height: 100%;
    }
</style>


<script module lang="ts">
    import home from "../../assets/carbon--home.svg?raw";
    import feed from "../../assets/carbon--rss.svg?raw";
    import book from "../../assets/basil--book-outline.svg?raw";
    import calendar from "../../assets/carbon--calendar.svg?raw";
    import library from "../../assets/codicon--library.svg?raw";
    import ai from "../../assets/carbon--ai-agent.svg?raw";
    import plus from "../../assets/carbon--add-large.svg?raw";
    import settings from "../../assets/carbon--settings.svg?raw";
    import search from "../../assets/carbon--search.svg?raw";
    import arrow from "../../assets/carbon--arrow-right.svg?raw";
    import close from "../../assets/carbon--close.svg?raw";
    import refresh from "../../assets/carbon--rotate-clockwise.svg?raw";

    import star from "../../assets/custom--star.svg?raw";
    import flower from "../../assets/custom--flower.svg?raw";
    import pen from "../../assets/custom--pen.svg?raw";
    import chevron from "../../assets/carbon--chevron-down.svg?raw";

    const icons = { home, feed, book, calendar, library, ai, plus, settings, search, arrow, close, refresh, star, flower, pen, chevron };
    export type IconName = keyof typeof icons;
</script>


<script lang="ts">
    let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>