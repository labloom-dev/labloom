<div class="search-input">
    <span class="search-icon">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html search}
    </span>
    <input placeholder="搜索…" autocomplete="off" spellcheck="false" />
</div>
<div class="search-results">

</div>
<footer>
    <span><kbd>Esc</kbd> 关闭</span>
</footer>


<style>
    .search-input {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
        padding: 14px 16px;
        border-bottom: 1px solid var(--c-search-divider);
    }
    .search-input:focus-within {
        border-bottom-color: var(--c-accent);
    }
    .search-icon {
        display: flex;
        width: 20px;
        height: 20px;
        flex-shrink: 0;
        color: var(--c-search-icon);
    }
    input {
        flex: 1;
        min-width: 0;
        padding: 4px 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 15px;
        user-select: text;
    }
    input::placeholder {
        color: var(--c-search-placeholder);
    }
    footer {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        flex-shrink: 0;
        padding: 10px 16px;
        background-color: var(--c-search-footer-background);
        color: var(--c-search-secondary-text);
        font-size: 12px;
    }
</style>


<script lang="ts">
    import search from "../../assets/carbon--search.svg?raw";
</script>