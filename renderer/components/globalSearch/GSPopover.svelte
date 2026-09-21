<div class="search-input">
    <span class="search-icon">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html search}
    </span>
    <input
        placeholder="搜索…"
        autocomplete="off"
        spellcheck={false}
    />
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
        border-bottom: 1px solid var(--color-search-divider);
    }
    .search-input:focus-within {
        border-bottom-color: var(--color-accent);
    }
    .search-icon {
        display: flex;
        width: 20px;
        height: 20px;
        flex-shrink: 0;
        color: var(--color-search-icon);
    }
    .search-icon :global(svg) {
        width: 100%;
        height: 100%;
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
        color: var(--color-search-placeholder);
    }
    footer {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        flex-shrink: 0;
        padding: 10px 16px;
        background-color: var(--color-search-footer-background);
        color: var(--color-search-secondary-text);
        font-size: 11px;
    }
</style>


<script lang="ts">
    import search from "../../assets/carbon--search.svg?raw";
</script>